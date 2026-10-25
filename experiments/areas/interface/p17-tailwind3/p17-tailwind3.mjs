/*
 * p17: what of Tailwind 3's output Coherent GT keeps, by p14's measurements, so we know
 * whether our pages in the sim, and the desktop app that would show the same bundle, can
 * be styled with Tailwind 3 rather than CSS written by hand.
 *
 *   node experiments/areas/interface/p17-tailwind3/p17-tailwind3.mjs
 *
 * No sim: it builds Tailwind 3.4.19 with tailwind.config.cjs beside it, then autoprefixer
 * for old WebKit, and grades every rule against p14's results from MSFS 2024 at the main menu:
 *
 *   1. shadcn Nova's components as content, unported, as the bench holds them;
 *   2. every utility Tailwind 3 makes, without variants, through a safelist of everything;
 *   3. each of Tailwind 3's variants on one utility.
 *
 * A declaration is kept, dropped, covered by a kept -webkit- twin in its rule, or untested
 * where p14 never tried its property, function, unit, keyword, selector, or media feature. Where a layout case found the engine parse a
 * value and ignore it, as with gap and justify-content: end, it counts as dropped.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import autoprefixer from "autoprefixer"
import postcss from "postcss"
import tailwindcss from "tailwindcss"

import { repoRelative, resultFile, stamp } from "../../../tools/results.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const config = require("./tailwind.config.cjs")
const ARCH = join(HERE, "..", "..", "architecture", "results")
const latest = (prefix) => join(ARCH, readdirSync(ARCH).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort().pop())
const P14 = JSON.parse(readFileSync(latest("p14-coherent-css-full-2026"), "utf8"))
const coherent = P14.runs.find((r) => r.result).result

// ---------------------------------------------------------------- p14's answers

const PROPS = new Map()
for (const p of coherent.properties) {
  PROPS.set(p.name, !!p.inherit)
  if (p.webkit) PROPS.set(`-webkit-${p.name}`, true)
}
for (const n of [...coherent.engine.computed, ...coherent.engine.styleKeys]) if (!PROPS.has(n)) PROPS.set(n, true)
const KEYWORDS = new Map(coherent.properties.map((p) => [p.name, p.keywords]))
const FUNCTIONS = new Map()
for (const f of coherent.functions) FUNCTIONS.set(f.name, (FUNCTIONS.get(f.name) ?? false) || !!f.kept)
// Kept by p14's value forms and layout cases, though mdn-data lists none of them as a function to sample.
for (const f of ["var()", "calc()", "url()", "rgba()", "rgb()", "hsl()", "hsla()", "linear-gradient()", "radial-gradient()", "cubic-bezier()", "repeat()"]) FUNCTIONS.set(f, true)
const UNITS = new Map(coherent.units.map((u) => [u.unit, !!u.kept]))
const PSEUDOS = new Map()
for (const s of coherent.selectors) {
  const m = s.sel.match(/(::?[a-zA-Z-]+)(\(.*\))?$/)
  if (m && s.name.startsWith(":")) PSEUDOS.set(m[1] + (m[2] ? "()" : ""), PSEUDOS.get(m[1] + (m[2] ? "()" : "")) || !!s.kept)
}
const MEDIA = new Map()
for (const m of coherent.media) {
  const f = m.query.match(/^\(([a-z-]+)/)
  if (f && !m.query.includes(" and ") && !m.query.includes(",")) MEDIA.set(f[1], m.parsed !== "not all")
}
const AT_RULES = new Map(coherent.atRules.map((a) => [a.name, a.count > 0]))
// Parsed and then ignored in layout, by p13's and p14's layout cases.
const IGNORED = new Map([["gap", "*"], ["row-gap", "*"], ["column-gap", "*"], ["justify-content", "end"], ["display", "contents"]])

// ---------------------------------------------------------------- grading

function gradeSelector(selector) {
  const plain = selector.replace(/\\./g, "x").replace(/\[[^\]]*\]/g, "[a]")
  for (const m of plain.matchAll(/(::?[a-zA-Z-]+)(\()?/g)) {
    const name = m[1] + (m[2] ? "()" : "")
    if (!PSEUDOS.has(name)) return { grade: "untested", why: `selector ${name}` }
    if (!PSEUDOS.get(name)) return { grade: "dropped", why: `selector ${name}` }
  }
  return null
}

function gradeAtRule(node) {
  if (node.name === "media") {
    if (/[<>]=?/.test(node.params)) return { grade: "dropped", why: "@media range syntax" }
    for (const m of node.params.matchAll(/\(\s*([a-z-]+)/g)) {
      const f = m[1].replace(/^(min|max)-/, "")
      const known = MEDIA.get(m[1]) ?? MEDIA.get(f) ?? MEDIA.get(`min-${f}`)
      if (known === undefined) return { grade: "untested", why: `@media (${m[1]})` }
      if (!known) return { grade: "dropped", why: `@media (${m[1]})` }
    }
    return null
  }
  const known = AT_RULES.get(`@${node.name}`)
  if (known === undefined) return { grade: "untested", why: `@${node.name}` }
  return known ? null : { grade: "dropped", why: `@${node.name}` }
}

function gradeDeclaration(prop, value) {
  if (prop.startsWith("--")) return null
  const known = PROPS.get(prop)
  if (known === undefined) return { grade: "untested", why: `property ${prop}` }
  if (!known) return { grade: "dropped", why: `property ${prop}` }
  const ignored = IGNORED.get(prop)
  if (ignored === "*" || ignored === value.trim()) return { grade: "dropped", why: `${prop}${ignored === "*" ? "" : `: ${ignored}`}, parsed and ignored` }
  const v = value.replace(/!important/, "").trim()
  for (const m of v.matchAll(/(rgba?|hsla?)\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
    if (!m[2].includes(",") || m[2].includes("/")) return { grade: "dropped", why: `${m[1]}() with spaces or a slash` }
  }
  for (const m of v.matchAll(/(?<![\w-])([a-zA-Z-]+)\(/g)) {
    const f = `${m[1]}()`
    if (!FUNCTIONS.has(f)) return { grade: "untested", why: `function ${f}` }
    if (!FUNCTIONS.get(f)) return { grade: "dropped", why: `function ${f}` }
  }
  for (const m of v.replace(/var\([^)]*\)/g, "").matchAll(/(?<![\w#-])-?\d*\.?\d+([a-zA-Z%]+)/g)) {
    const u = m[1]
    if (!UNITS.has(u)) return { grade: "untested", why: `unit ${u}` }
    if (!UNITS.get(u)) return { grade: "dropped", why: `unit ${u}` }
  }
  if (prop === "opacity" && v.endsWith("%")) return { grade: "dropped", why: "opacity as a percent" }
  const kw = KEYWORDS.get(prop)
  if (kw && /^[a-z-]+$/.test(v) && v in kw && !kw[v]) return { grade: "dropped", why: `${prop}: ${v}` }
  return null
}

// Every rule's selector, with what the engine does to each of its declarations. The engine
// drops a declaration, not its rule, so one dropped beside a kept -webkit- twin is covered.
function grade(css) {
  const out = []
  postcss.parse(css).walkRules((rule) => {
    let at = null
    for (let p = rule.parent; p && p.type !== "root"; p = p.parent) if (p.type === "atrule") at = at ?? gradeAtRule(p)
    if (rule.parent?.type === "atrule" && rule.parent.name === "keyframes") return
    const sel = gradeSelector(rule.selector)
    const decls = []
    rule.walkDecls((d) => decls.push({ selector: rule.selector, prop: d.prop, value: d.value, ...(at ?? sel ?? gradeDeclaration(d.prop, d.value) ?? { grade: "kept" }) }))
    for (const d of decls) {
      if (d.grade === "kept" || at || sel) continue
      const twin = d.prop.startsWith("-webkit-") ? d.prop.slice(8) : `-webkit-${d.prop}`
      if (decls.some((o) => o.prop === twin && o.grade === "kept")) Object.assign(d, { grade: "covered", why: `${d.why}, beside its kept ${twin}` })
    }
    out.push(...decls)
  })
  return out
}

// Autoprefixer, aimed at the browsers Coherent GT's user agent names, adds -webkit- twins
// such as -webkit-user-select, which the engine keeps where it drops the unprefixed form.
const PREFIX_FOR = ["chrome 49", "safari 10"]

async function build(content, extra = {}, prefix = true) {
  const plugins = [tailwindcss({ ...config, content, ...extra })]
  if (prefix) plugins.push(autoprefixer({ overrideBrowserslist: PREFIX_FOR }))
  const result = await postcss(plugins).process("@tailwind base;\n@tailwind components;\n@tailwind utilities;", { from: undefined })
  return result.css
}

// ---------------------------------------------------------------- the runs

const NOVA = join(HERE, "..", "bench", "src", "presets", "nova")
const novaFiles = readdirSync(NOVA).map((f) => join(NOVA, f))
const VARIANTS = ["hover", "focus", "focus-visible", "focus-within", "active", "visited", "disabled", "enabled", "checked", "indeterminate", "required", "invalid", "read-only", "placeholder-shown", "empty", "target", "first", "last", "only", "odd", "even", "first-of-type", "group-hover", "peer-checked", "placeholder", "file", "marker", "selection", "before", "after", "open", "aria-checked", "aria-[expanded=true]", "data-[state=open]", "has-[:checked]", "group-has-[:checked]", "supports-[display:grid]", "motion-safe", "motion-reduce", "contrast-more", "forced-colors", "dark", "print", "portrait", "landscape", "rtl", "ltr", "sm", "md", "lg", "xl", "2xl", "max-md", "min-[400px]", "*"]

const novaContent = [{ raw: novaFiles.map((f) => readFileSync(f, "utf8")).join("\n"), extension: "tsx" }]
const novaCss = await build(novaContent)
const allCss = await build([{ raw: "", extension: "html" }], { safelist: [{ pattern: /.*/ }] })
const allCssUnprefixed = await build([{ raw: "", extension: "html" }], { safelist: [{ pattern: /.*/ }] }, false)
const variantCss = await build([{ raw: VARIANTS.map((v) => `${v}:underline`).join(" "), extension: "html" }])

// Nova's class names, from the strings that list several, which class lists do and a
// component's name or an import's path don't, to tell which ones Tailwind 3 knows.
const escape = (c) => c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)
const novaClasses = new Set()
for (const f of novaFiles) {
  for (const m of readFileSync(f, "utf8").matchAll(/"([^"\n]* [^"\n]*)"/g)) for (const t of m[1].split(/\s+/)) if (/^[!a-z*@-][^\s]*$/.test(t) && /[-:]/.test(t)) novaClasses.add(t)
}
const unknownToV3 = [...novaClasses].filter((c) => !novaCss.includes(`.${escape(c)}`)).sort()

// ---------------------------------------------------------------- report

function summarize(title, graded, { classes = false } = {}) {
  const n = (g) => graded.filter((d) => d.grade === g).length
  const lines = [``, `${title}: ${graded.length} declarations, ${n("kept")} kept, ${n("covered")} covered by a -webkit- twin, ${n("dropped")} dropped, ${n("untested")} untested`]
  for (const grade of ["dropped", "untested"]) {
    const by = new Map()
    for (const d of graded.filter((x) => x.grade === grade)) {
      const k = d.why
      const sel = d.selector.replace(/\\/g, "")
      by.set(k, [...(by.get(k) ?? []), sel])
    }
    if (!by.size) continue
    lines.push(`  ${grade}:`)
    for (const [why, sels] of [...by].sort((a, b) => b[1].length - a[1].length)) {
      const uniq = [...new Set(sels)]
      lines.push(`    ${why}: ${uniq.length} rule${uniq.length === 1 ? "" : "s"}, such as ${uniq.slice(0, classes ? 8 : 5).join("  ")}`)
    }
  }
  return lines
}

const novaGraded = grade(novaCss)
const allGraded = grade(allCss)
const allUnprefixedGraded = grade(allCssUnprefixed)
const variantGraded = grade(variantCss)
const fixedByPrefix = allUnprefixedGraded.filter((d) => d.grade === "dropped").length - allGraded.filter((d) => d.grade === "dropped").length
const lines = [
  `p17-tailwind3, ${new Date().toISOString()}, tailwindcss ${require("tailwindcss/package.json").version}, autoprefixer ${require("autoprefixer/package.json").version} for ${PREFIX_FOR.join(" and ")}`,
  `Graded against ${repoRelative(latest("p14-coherent-css-full-2026"))}, Coherent GT at the main menu.`,
  `Builds: Nova's components ${(novaCss.length / 1024).toFixed(0)} KB, every utility ${(allCss.length / 1024).toFixed(0)} KB, variants ${(variantCss.length / 1024).toFixed(0)} KB.`,
  `Autoprefixer's -webkit- twins turned ${fixedByPrefix} dropped declarations of every utility into covered ones.`,
  ...summarize("1. shadcn Nova's components, unported", novaGraded, { classes: true }),
  ``,
  `  Nova's ${novaClasses.size} class names: ${novaClasses.size - unknownToV3.length} Tailwind 3 builds, ${unknownToV3.length} it doesn't know, which are Tailwind 4's alone or need porting:`,
  `    ${unknownToV3.join("  ")}`,
  ...summarize("2. Every utility Tailwind 3 makes, without variants", allGraded),
  ``,
  `3. Each variant on underline:`,
]
for (const v of VARIANTS) {
  const sel = variantGraded.filter((d) => d.selector.replace(/\\/g, "").includes(`${v}:underline`))
  const g = sel.length ? sel[0] : null
  lines.push(`  ${v.padEnd(26)} ${g ? `${g.grade}${g.why ? `, ${g.why}` : ""}` : "not built by Tailwind 3"}`)
}
const text = lines.join("\n")
console.log(text)
const when = stamp()
writeFileSync(resultFile("interface", "p17-tailwind3", "txt", when), text + "\n")
writeFileSync(resultFile("interface", "p17-tailwind3", "json", when), JSON.stringify({ nova: novaGraded, all: allGraded, variants: variantGraded, unknownToV3 }))
console.log(`saved experiments/areas/interface/results/p17-tailwind3-${when}.txt and .json`)
