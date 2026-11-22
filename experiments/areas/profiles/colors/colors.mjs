/*
 * A page for picking the profile extension's colors: sample.yaml, colored as VS Code colors it,
 * in a dark pane and a light pane, with a picker for each of the palette's color groups.
 *
 *   node experiments/areas/profiles/colors/colors.mjs
 *
 * then open colors.html beside it. The script runs the extension's grammar and VS Code's own
 * JavaScript grammar over the sample, through vscode-textmate and vscode-oniguruma, and finds
 * which of the manifest's palette rules colors each token, so the page shows what VS Code would.
 * Rerun it after changing the grammar, the sample, or the manifest's palettes.
 */

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

import oniguruma from "vscode-oniguruma"
import textmate from "vscode-textmate"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "..", "..", "..", "..")
const EXTENSION = path.join(ROOT, "src", "apps", "profile-extension")
const GRAMMAR = path.join(EXTENSION, "syntaxes", "dualinput-profile.tmLanguage.json")
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXTENSION, "package.json"), "utf8"))
const SAMPLE = fs.readFileSync(path.join(HERE, "sample.yaml"), "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "")

const defaults = MANIFEST.contributes.configurationDefaults["editor.tokenColorCustomizations"]
const PALETTES = { dark: defaults.textMateRules, light: defaults["[*Light*]"].textMateRules }

// What each group colors, by a scope only that group names.
const LABELS = [
  ["source.dualinput-profile", "Text: a script's own variables and functions, and anything else"],
  ["entity.name.tag.entry.dualinput-profile", "Entry keys, and the key after state. in a script"],
  ["entity.name.tag.block.dualinput-profile", "Block keys: maker, state, events…"],
  ["entity.name.tag.field.dualinput-profile", "Field keys: name, watch, write…"],
  ["entity.name.function.kind.dualinput-profile", "Name call kinds: L, A, B, K, H, instrument"],
  ["string.other.name.dualinput-profile", "Sim names inside a name call"],
  ["variable.parameter.argument.dualinput-profile", "Name call arguments: units, indexes"],
  ["support.function.builtin.dualinput-profile", "write, repeat, every"],
  ["meta.embedded.block.javascript.dualinput-profile string", "Values and strings, in the YAML and in a script"],
  ["constant.numeric.dualinput-profile", "Numbers, paces, words (none, true, shared…), and variant IDs"],
  ["meta.embedded.block.javascript.dualinput-profile keyword", "Script keywords: const, if, return"],
  ["variable.language.given.dualinput-profile", "state and value"],
  ["punctuation.separator.key-value.mapping.dualinput-profile", "Punctuation in the YAML and in a name call"],
  ["punctuation.accessor.dualinput-profile", "A script's brackets, braces, and operators"],
  ["markup.heading.section.dualinput-profile", "Section headings: # ═══"],
  ["markup.heading.subsection.dualinput-profile", "Subsection headings: # ──"],
  ["comment.line.number-sign.dualinput-profile", "Comments"],
]

function labelOf(rule) {
  return LABELS.find(([scope]) => rule.scope.includes(scope))?.[1] ?? rule.scope[0]
}

/** VS Code's JavaScript grammar, from the VS Code that `code` on the PATH runs, or the default install. */
function javascriptGrammar() {
  const roots = []
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) if (fs.existsSync(path.join(dir, "code.cmd"))) roots.push(path.dirname(dir))
  roots.push(path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code"))
  const tail = path.join("resources", "app", "extensions", "javascript", "syntaxes", "JavaScript.tmLanguage.json")
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const base of [root, ...fs.readdirSync(root).map((name) => path.join(root, name))]) {
      if (fs.existsSync(path.join(base, tail))) return path.join(base, tail)
    }
  }
  throw new Error("Found no VS Code install with its JavaScript grammar; put `code` on the PATH")
}

const require = createRequire(import.meta.url)
const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"))
await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength))
const javascript = javascriptGrammar()
const registry = new textmate.Registry({
  onigLib: Promise.resolve({ createOnigScanner: (sources) => new oniguruma.OnigScanner(sources), createOnigString: (text) => new oniguruma.OnigString(text) }),
  loadGrammar: async (scope) => {
    if (scope === "source.dualinput-profile") return textmate.parseRawGrammar(fs.readFileSync(GRAMMAR, "utf8"), GRAMMAR)
    if (scope === "source.js") return textmate.parseRawGrammar(fs.readFileSync(javascript, "utf8"), javascript)
    return null
  },
})
const grammar = await registry.loadGrammar("source.dualinput-profile")
const LINES = SAMPLE.split("\n")

/** Each line's tokens, with their scopes. */
function tokenize() {
  let stack = textmate.INITIAL
  return LINES.map((line) => {
    const result = grammar.tokenizeLine(line, stack)
    stack = result.ruleStack
    return result.tokens
  })
}

/**
 * The index of the palette rule that colors each character, or -1 where none does, found by giving
 * each rule a color of its own. vscode-textmate packs the color's index into a token's metadata at
 * bits 15 to 23.
 */
function groups(rules) {
  const sentinel = (at) => `#00${(at + 1).toString(16).padStart(4, "0")}`
  registry.setTheme({ settings: [{ settings: { foreground: "#ff00ff", background: "#000000" } }, ...rules.map((rule, at) => ({ scope: rule.scope, settings: { ...rule.settings, foreground: sentinel(at) } }))] })
  const colors = registry.getColorMap().map((color) => color?.toLowerCase())
  let stack = textmate.INITIAL
  return LINES.map((line) => {
    const result = grammar.tokenizeLine2(line, stack)
    stack = result.ruleStack
    const looks = []
    for (let at = 0; at < result.tokens.length; at += 2) {
      const color = colors[(result.tokens[at + 1] >>> 15) & 0x1ff]
      const end = at + 2 < result.tokens.length ? result.tokens[at + 2] : line.length
      const group = rules.findIndex((_, rule) => sentinel(rule) === color)
      for (let char = result.tokens[at]; char < end; char++) looks[char] = group
    }
    return looks
  })
}

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const tokens = tokenize()

/** The sample as HTML, each token a span of its palette group's class, with its scopes on hover. */
function code(palette) {
  const painted = groups(PALETTES[palette])
  return LINES.map((line, at) =>
    tokens[at]
      .map((token) => {
        const text = line.slice(token.startIndex, token.endIndex)
        const group = painted[at][token.startIndex] ?? -1
        const label = group === -1 ? "NO PALETTE RULE" : labelOf(PALETTES[palette][group])
        const scopes = token.scopes.slice(1).join("\n")
        return `<span class="g${group}" data-group="${group}" title="${escape(`${label}\n\n${scopes}`)}">${escape(text)}</span>`
      })
      .join(""),
  ).join("\n")
}

const fontStyle = (settings, word) => (settings.fontStyle ?? "").split(/\s+/).includes(word)
const groupsOf = (palette) =>
  PALETTES[palette].map((rule) => ({ color: rule.settings.foreground, bold: fontStyle(rule.settings, "bold"), italic: fontStyle(rule.settings, "italic") }))
const state = { labels: PALETTES.dark.map(labelOf), dark: groupsOf("dark"), light: groupsOf("light") }
if (PALETTES.dark.length !== PALETTES.light.length || PALETTES.dark.some((rule, at) => labelOf(rule) !== labelOf(PALETTES.light[at]))) {
  throw new Error("The dark and light palettes' groups don't line up, so the page can't pair them")
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Profile colors</title>
<style>
  :root { color-scheme: dark; --ui: #17191c; --ui-text: #d8dde2; --ui-line: #2c3036; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ui); color: var(--ui-text); font: 13px/1.4 system-ui, sans-serif; }
  header { display: flex; gap: 12px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--ui-line); flex-wrap: wrap; }
  header h1 { font-size: 14px; margin: 0 8px 0 0; }
  button, select { font: inherit; background: #23262b; color: var(--ui-text); border: 1px solid #3a3f46; border-radius: 4px; padding: 3px 8px; cursor: pointer; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .pane { min-width: 0; }
  .pane .bar { display: flex; gap: 8px; align-items: center; padding: 6px 12px; border-bottom: 1px solid var(--ui-line); }
  pre { margin: 0; padding: 12px 16px; font: 14px/1.5 "Cascadia Code", Consolas, monospace; overflow-x: auto; tab-size: 2; }
  .g-1 { color: #ff00ff !important; text-decoration: wavy underline; }
  pre span.picked { outline: 1px dashed currentColor; outline-offset: 1px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 4px 10px; border-bottom: 1px solid var(--ui-line); text-align: left; white-space: nowrap; }
  th { font-weight: 600; color: #9aa3ad; }
  td.label { white-space: normal; width: 40%; }
  tr.picked td { background: #262a30; }
  td code { font: 12px "Cascadia Code", Consolas, monospace; color: #9aa3ad; }
  input[type=color] { width: 36px; height: 22px; padding: 0; border: 1px solid #3a3f46; background: none; vertical-align: middle; cursor: pointer; }
  input.hex { width: 72px; font: 12px "Cascadia Code", Consolas, monospace; background: #23262b; color: var(--ui-text); border: 1px solid #3a3f46; border-radius: 3px; padding: 2px 4px; }
  label.toggle { margin-left: 6px; cursor: pointer; user-select: none; }
  .swatch { display: inline-block; padding: 1px 8px; border-radius: 3px; font: 13px "Cascadia Code", Consolas, monospace; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } td.label { width: auto; } }
</style>
</head>
<body>
<header>
  <h1>Profile colors</h1>
  <button id="copy">Copy palette</button>
  <button id="reset">Reset to the manifest's</button>
  <span id="note"></span>
</header>
<main>
  <section class="pane">
    <div class="bar">Dark
      <select id="dark-bg">
        <option value="#1f1f1f">Dark Modern</option><option value="#1e1e1e">Dark+</option><option value="#282c34">One Dark Pro</option>
        <option value="#0d1117">GitHub Dark</option><option value="#272822">Monokai</option>
      </select>
      <input type="color" id="dark-bg-custom" title="Any background">
    </div>
    <pre id="dark" class="dark">${code("dark")}</pre>
  </section>
  <section class="pane">
    <div class="bar">Light
      <select id="light-bg">
        <option value="#ffffff">Light Modern</option><option value="#f5f5f5">Quiet Light</option><option value="#fdf6e3">Solarized Light</option>
        <option value="#f3f3f3">Light+ sidebar gray</option>
      </select>
      <input type="color" id="light-bg-custom" title="Any background">
    </div>
    <pre id="light" class="light">${code("light")}</pre>
  </section>
</main>
<table>
  <thead><tr><th>Group</th><th>Dark</th><th>Light</th></tr></thead>
  <tbody id="groups"></tbody>
</table>
<style id="live"></style>
<script>
  const MANIFEST = ${JSON.stringify(state)}
  const state = structuredClone(MANIFEST)
  const live = document.getElementById("live")

  function css() {
    let text = ""
    for (const palette of ["dark", "light"]) {
      state[palette].forEach((group, at) => {
        text += "." + palette + " .g" + at + " { color: " + group.color + "; font-weight: " + (group.bold ? 700 : 400) + "; font-style: " + (group.italic ? "italic" : "normal") + "; }\\n"
      })
    }
    live.textContent = text
    for (const palette of ["dark", "light"]) {
      document.querySelectorAll("[data-swatch=" + palette + "]").forEach((swatch) => {
        const group = state[palette][swatch.dataset.at]
        swatch.style.color = group.color
        swatch.style.fontWeight = group.bold ? 700 : 400
        swatch.style.fontStyle = group.italic ? "italic" : "normal"
      })
    }
  }

  function controls(palette, at) {
    const group = state[palette][at]
    return '<input type="color" data-palette="' + palette + '" data-at="' + at + '" data-field="color" value="' + group.color + '">' +
      ' <input class="hex" data-palette="' + palette + '" data-at="' + at + '" data-field="hex" value="' + group.color + '">' +
      '<label class="toggle"><input type="checkbox" data-palette="' + palette + '" data-at="' + at + '" data-field="bold"' + (group.bold ? " checked" : "") + '> B</label>' +
      '<label class="toggle"><input type="checkbox" data-palette="' + palette + '" data-at="' + at + '" data-field="italic"' + (group.italic ? " checked" : "") + '> I</label>' +
      ' <span class="swatch" data-swatch="' + palette + '" data-at="' + at + '">Sample</span>'
  }

  function table() {
    document.getElementById("groups").innerHTML = state.labels.map((label, at) =>
      '<tr data-at="' + at + '"><td class="label">' + label + ' <code>g' + at + '</code></td><td>' + controls("dark", at) + '</td><td>' + controls("light", at) + '</td></tr>').join("")
    for (const palette of ["dark", "light"]) {
      document.querySelectorAll("[data-swatch=" + palette + "]").forEach((swatch) => { swatch.style.background = document.getElementById(palette).style.background })
    }
    css()
  }

  document.getElementById("groups").addEventListener("input", (event) => {
    const input = event.target
    const group = state[input.dataset.palette][input.dataset.at]
    if (input.dataset.field === "color") { group.color = input.value; input.parentElement.querySelector(".hex").value = input.value }
    if (input.dataset.field === "hex" && /^#[0-9a-fA-F]{6}$/.test(input.value)) { group.color = input.value.toLowerCase(); input.parentElement.querySelector("[data-field=color]").value = group.color }
    if (input.dataset.field === "bold" || input.dataset.field === "italic") group[input.dataset.field] = input.checked
    css()
  })

  for (const palette of ["dark", "light"]) {
    const pre = document.getElementById(palette)
    const select = document.getElementById(palette + "-bg")
    const custom = document.getElementById(palette + "-bg-custom")
    const paint = (color) => {
      pre.style.background = color
      custom.value = color
      document.querySelectorAll("[data-swatch=" + palette + "]").forEach((swatch) => { swatch.style.background = color })
    }
    select.addEventListener("change", () => paint(select.value))
    custom.addEventListener("input", () => paint(custom.value))
    paint(select.value)
    // Clicking a token picks its group's row in the table.
    pre.addEventListener("click", (event) => {
      const at = event.target.dataset?.group
      if (at === undefined || at === "-1") return
      document.querySelectorAll(".picked").forEach((one) => one.classList.remove("picked"))
      document.querySelectorAll('pre span[data-group="' + at + '"]').forEach((one) => one.classList.add("picked"))
      const row = document.querySelector('tr[data-at="' + at + '"]')
      row.classList.add("picked")
      row.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
  }

  /** The palette as the page holds it, by group, for copying back into the manifest. */
  window.palette = () => state.labels.map((label, at) => ({
    group: at, label,
    dark: { foreground: state.dark[at].color, fontStyle: [state.dark[at].bold && "bold", state.dark[at].italic && "italic"].filter(Boolean).join(" ") },
    light: { foreground: state.light[at].color, fontStyle: [state.light[at].bold && "bold", state.light[at].italic && "italic"].filter(Boolean).join(" ") },
  }))

  document.getElementById("copy").addEventListener("click", async () => {
    const text = JSON.stringify(window.palette(), null, 2)
    try { await navigator.clipboard.writeText(text); document.getElementById("note").textContent = "Copied" }
    catch { document.getElementById("note").textContent = "Couldn't reach the clipboard; the palette is in the console"; console.log(text) }
  })
  document.getElementById("reset").addEventListener("click", () => {
    for (const palette of ["dark", "light"]) state[palette] = structuredClone(MANIFEST[palette])
    table()
  })

  table()
</script>
</body>
</html>
`

fs.writeFileSync(path.join(HERE, "colors.html"), html)
const gaps = ["dark", "light"].flatMap((palette) => groups(PALETTES[palette]).flatMap((line, at) => (line.includes(-1) ? [`${palette}: line ${at + 1}`] : [])))
console.log(`Wrote ${path.join(HERE, "colors.html")}, with VS Code's JavaScript grammar from ${javascript}`)
console.log(gaps.length ? `Characters no palette rule colors, shown magenta: ${gaps.join(", ")}` : "Every character takes a palette rule")
