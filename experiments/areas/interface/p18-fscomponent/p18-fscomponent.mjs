/*
 * p18: whether one front end on the MSFS Avionics Framework can also be the
 * desktop app's, by running FSComponent outside the sim. It builds app.tsx the
 * way a sim bundle is built, ES2017 with the JSX going to
 * FSComponent.buildComponent, with Tailwind 3 tuned as p17 tuned it, twice:
 *   - "bundle" imports @microsoft/msfs-sdk as npm ships it, one 4 MB module;
 *   - "modules" imports only the SDK's own modules app.tsx names, which the
 *     package's source map carries in full, as 459 compiled ES modules.
 * For each, it runs the Coherent GT check on the bundle, since the same file has
 * to ship into the sim, counts how often the bundle names the sim's globals, and
 * opens the page in Edge, headless, with a fresh profile, since Edge is the
 * engine WebView2 embeds, then waits for the page's own checks to post back.
 *
 *   node experiments/areas/interface/p18-fscomponent/p18-fscomponent.mjs [--serve]
 *
 * --serve keeps serving after the report, so the browser pane can show
 * http://127.0.0.1:47818/modules/.
 */

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import autoprefixer from "autoprefixer"
import * as esbuild from "esbuild"
import postcss from "postcss"
import tailwind from "tailwindcss"

import { repoRelative, saveResult } from "../../../tools/results.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const OUT = path.join(HERE, "out")
const SDK = path.join(HERE, "node_modules/@microsoft/msfs-sdk")
const PORT = 47_818
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
const WAIT_MS = 20_000
const serve = process.argv.includes("--serve")

// What app.tsx imports from the SDK, so the modules variant can export just these.
const NAMES = ["ArraySubject", "DisplayComponent", "FSComponent", "MappedSubject", "Subject", "SubscribableArrayEventType"]

// The look's colors, as RGB triplets for p17's rgba(var(--x-rgb), alpha) form
// (record/areas/interface/decisions.md). Neutral grays and shadcn's dark tokens.
const TOKENS = {
  background: "#0a0a0a", foreground: "#fafafa",
  card: "#171717", "card-foreground": "#fafafa",
  popover: "#171717", "popover-foreground": "#fafafa",
  primary: "#74d4ff", "primary-foreground": "#171717",
  secondary: "#262626", "secondary-foreground": "#fafafa",
  muted: "#262626", "muted-foreground": "#a3a3a3",
  accent: "#262626", "accent-foreground": "#fafafa",
  destructive: "#ea7977", "destructive-foreground": "#171717",
  warning: "#f1be4d", "warning-foreground": "#171717",
  success: "#6fd58d", "success-foreground": "#171717",
  info: "#bdd7f5", "info-foreground": "#171717",
  border: "#2e2e2e", input: "#3a3a3a", ring: "#74d4ff",
}
const triplet = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")
const rootVars = `:root {\n${Object.entries(TOKENS).map(([k, v]) => `  --${k}-rgb: ${triplet(v)};`).join("\n")}\n  --radius: 10px;\n}\n`

const token = (name) => `rgba(var(--${name}-rgb), <alpha-value>)`
const colors = { transparent: "transparent", current: "currentColor", white: "rgba(255, 255, 255, <alpha-value>)", black: "rgba(0, 0, 0, <alpha-value>)" }
for (const name of Object.keys(TOKENS)) {
  if (name.endsWith("-foreground")) continue
  colors[name] = TOKENS[`${name}-foreground`] ? { DEFAULT: token(name), foreground: token(`${name}-foreground`) } : token(name)
}

// Writes the SDK's modules out of its source map, with an index exporting NAMES
// and a package.json marking them free of side effects, so esbuild drops every
// module app.tsx doesn't reach.
function extractModules() {
  const dir = path.join(OUT, "sdk-modules")
  const map = JSON.parse(fs.readFileSync(path.join(SDK, "msfssdk.js.map"), "utf8"))
  const owner = {}
  map.sources.forEach((source, i) => {
    const rel = source.replace(/^\.\.\/build\//, "")
    const code = map.sourcesContent[i]
    const file = path.join(dir, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, code)
    for (const name of NAMES) {
      if (new RegExp(`export (?:var|let|const|class|function|abstract class) ${name}\\b|export \\{[^}]*\\b${name}\\b`).test(code) && !owner[name]) owner[name] = "./" + rel.replace(/\.js$/, "")
    }
  })
  const missing = NAMES.filter((n) => !owner[n])
  if (missing.length) throw new Error(`no module exports ${missing.join(", ")}`)
  fs.writeFileSync(path.join(dir, "index.js"), NAMES.map((n) => `export { ${n} } from "${owner[n]}"`).join("\n") + "\n")
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ sideEffects: false }) + "\n")
  return { dir, count: map.sources.length, owner }
}

async function buildCss() {
  const config = {
    content: [path.join(HERE, "app.tsx")],
    theme: {
      colors,
      extend: {
        borderColor: { DEFAULT: token("border") },
        borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
        fontFamily: { sans: ["Geist", "Segoe UI", "sans-serif"], mono: ["Geist Mono", "Consolas", "monospace"] },
      },
    },
  }
  const css = await postcss([tailwind(config), autoprefixer({ overrideBrowserslist: ["chrome 49", "safari 10"] })])
    .process("@tailwind base;\n@tailwind components;\n@tailwind utilities;\n", { from: undefined })
  return rootVars + css.css
}

async function buildVariant(name, css, sdkIndex) {
  const dir = path.join(OUT, name)
  fs.mkdirSync(dir, { recursive: true })
  const redirect = {
    name: "sdk-modules",
    setup(b) { b.onResolve({ filter: /^@microsoft\/msfs-sdk$/ }, () => ({ path: sdkIndex })) },
  }
  const js = await esbuild.build({
    entryPoints: [path.join(HERE, "app.tsx")],
    bundle: true,
    format: "iife",
    target: "es2017",
    jsx: "transform",
    jsxFactory: "FSComponent.buildComponent",
    jsxFragment: "FSComponent.Fragment",
    sourcemap: "external",
    metafile: true,
    outfile: path.join(dir, "app.js"),
    plugins: sdkIndex ? [redirect] : [],
    logLevel: "warning",
  })
  fs.writeFileSync(path.join(dir, "app.css"), css)
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>p18 FSComponent, ${name}</title><link rel="stylesheet" href="app.css"></head>
<body class="bg-background"><div id="root"></div><script src="app.js"></script></body></html>
`)
  const out = Object.values(js.metafile.outputs).find((o) => o.entryPoint)
  const sdkBytes = Object.entries(out.inputs).filter(([file]) => /msfs-sdk|sdk-modules/.test(file)).reduce((n, [, i]) => n + i.bytesInOutput, 0)
  const sdkModules = Object.keys(out.inputs).filter((file) => /sdk-modules/.test(file)).length
  const code = fs.readFileSync(path.join(dir, "app.js"), "utf8")
  const count = (re) => (code.match(re) || []).length
  const check = spawnSync(process.execPath, ["tools/coherent-check/main.ts", path.join(dir, "app.js")], { cwd: ROOT, encoding: "utf8" })
  return {
    name,
    bundleKB: +(out.bytes / 1024).toFixed(1),
    sdkKB: +(sdkBytes / 1024).toFixed(1),
    sdkModules,
    cssKB: +(Buffer.byteLength(css) / 1024).toFixed(1),
    names: { SimVar: count(/\bSimVar\b/g), Coherent: count(/\bCoherent\b/g), BaseInstrument: count(/\bBaseInstrument\b/g) },
    check: { exit: check.status, output: (check.stdout + check.stderr).trim() },
  }
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".map": "application/json" }

function startServer(onResult) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
    if (req.method === "POST" && url.pathname.endsWith("/result")) {
      let body = ""
      req.on("data", (d) => (body += d))
      req.on("end", () => { res.writeHead(204, { "access-control-allow-origin": "*" }); res.end(); onResult(JSON.parse(body)) })
      return
    }
    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, "")
    let file = path.join(OUT, rel)
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html")
    if (!file.startsWith(OUT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "access-control-allow-origin": "*" })
    res.end(fs.readFileSync(file))
  })
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)))
}

// Opens one page in a headless Edge with a profile of its own, and waits for the
// page to post its result, or for WAIT_MS.
async function inEdge(page, waitFor) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "p18-edge-"))
  const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--user-data-dir=${profile}`, "--no-first-run", `http://127.0.0.1:${PORT}${page}`], { stdio: "ignore" })
  const result = await Promise.race([waitFor(page), new Promise((r) => setTimeout(() => r(null), WAIT_MS))])
  edge.kill()
  await new Promise((r) => edge.once("exit", r))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  return result
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  const css = await buildCss()
  const modules = extractModules()
  const variants = [await buildVariant("bundle", css, null), await buildVariant("modules", css, path.join(modules.dir, "index.js"))]

  const waiting = new Map()
  const server = await startServer((r) => { const done = waiting.get(r.page); if (done) done(r) })
  const waitFor = (page) => new Promise((resolve) => waiting.set(page, resolve))

  const lines = [`p18-fscomponent, ${new Date().toISOString()}`, ""]
  lines.push(`The SDK's source map carries ${modules.count} modules; the modules variant exports ${NAMES.map((n) => `${n} from ${modules.owner[n]}`).join(", ")}.`)
  for (const v of variants) {
    const r = await inEdge(`/${v.name}/`, waitFor)
    lines.push("", `${v.name}:`)
    lines.push(`  bundle ${v.bundleKB} KB, of which the SDK ${v.sdkKB} KB${v.sdkModules ? ` from ${v.sdkModules} of its modules` : ""}; CSS ${v.cssKB} KB`)
    lines.push(`  sim globals the bundle names: ${Object.entries(v.names).map(([k, n]) => `${k} ${n}`).join(", ")}`)
    lines.push(`  Coherent GT check: exit ${v.check.exit}${v.check.output ? `\n    ${v.check.output.split("\n").join("\n    ")}` : ", no findings"}`)
    if (!r) { lines.push(`  Edge: no result within ${WAIT_MS / 1000}s, so the page threw before its checks ran`); continue }
    lines.push(`  Edge: ${r.userAgent}`)
    lines.push(`  sim globals present: ${JSON.stringify(r.simGlobals)}`)
    for (const c of r.checks) lines.push(`    ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`)
    if (r.errors.length) lines.push(`  errors: ${r.errors.join(" | ")}`)
  }
  const text = lines.join("\n")
  const file = saveResult("interface", "p18-fscomponent", text)
  console.log(text)
  console.log(`saved ${repoRelative(file)}`)

  if (!serve) { server.close(); return }
  console.log(`serving http://127.0.0.1:${PORT}/modules/ until stopped`)
}

main().catch((e) => { console.error(e.stack ?? String(e)); process.exit(1) })
