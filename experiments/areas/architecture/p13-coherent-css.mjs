/*
 * p13: which CSS does Coherent GT take, so we know whether the EFB app and the
 * banner can share the desktop app's styling, which shadcn on Base UI with
 * Tailwind 4 builds? Tailwind 4 needs Chrome 111 or Safari 16.4 level CSS
 * (documented, https://tailwindcss.com/docs/compatibility), and Coherent GT's
 * makers last compared it to Safari 10.1 (record/areas/architecture/coherent-gt.md).
 *
 *   node experiments/areas/architecture/p13-coherent-css.mjs
 *
 * With the sim at the main menu, through the inspector, needing nothing from
 * the pilot. In mainUi, the EFB's document, and the toolbar's, it:
 *
 *   1. lays out small hidden elements under a stylesheet of its own and
 *      measures what each rule did, since a rule the engine can't read is
 *      dropped without an error, and CSS.supports can disagree with layout;
 *   2. reads each color syntax back through getComputedStyle, against a color
 *      a less specific rule set first, so a dropped declaration shows;
 *   3. asks CSS.supports beside each measurement, and matchMedia for the
 *      media features Tailwind's variants use;
 *   4. lists the @font-face rules the page's own stylesheets hold, which says
 *      which faces and font formats the sim ships with its pages.
 *
 * It adds one hidden element and one style element to each page and removes
 * both before it returns, and nothing touches the pilot's input.
 */

import { Inspector, listPages } from "../../tools/inspector.mjs"
import { repoRelative, saveResult } from "../../tools/results.mjs"

// Runs in each page, so it's written in syntax Coherent GT parses: var,
// function expressions, no arrows, no template literals (CLAUDE.md, "Before
// writing code that runs in a panel").
function pageCheck() {
  var ID = "dualinput-p13-host"
  var out = { ua: navigator.userAgent, context: {}, tests: [], media: [], fonts: [], fontsApi: null }
  var host = document.createElement("div")
  host.id = ID
  host.setAttribute("style", "position:absolute;left:0;top:0;width:400px;height:400px;visibility:hidden;pointer-events:none;")
  ;(document.body || document.documentElement).appendChild(host)
  var sheet = document.createElement("style")
  ;(document.head || document.documentElement).appendChild(sheet)

  function q(sel) { return host.querySelector(sel) }
  function round(n) { return Math.round(n * 100) / 100 }
  function rect(sel) {
    var r = q(sel).getBoundingClientRect(), h = host.getBoundingClientRect()
    return { x: round(r.left - h.left), y: round(r.top - h.top), w: round(r.width), h: round(r.height) }
  }
  function cs(sel, prop) { return getComputedStyle(q(sel)).getPropertyValue(prop) }
  function supports(prop, value) {
    try { return typeof CSS !== "undefined" && CSS.supports ? CSS.supports(prop, value) : null } catch (e) { return "threw" }
  }
  function near(expect) { return function (v) { return Math.abs(Number(v) - expect) < 0.6 } }

  // One test: a stylesheet, the elements, what to read, and what it should be.
  function T(group, name, css, html, measure, expect, sup) {
    var r = { group: group, name: name }
    try {
      sheet.textContent = css.split("#H").join("#" + ID)
      host.innerHTML = html
      var v = measure()
      r.value = typeof v === "string" ? v : JSON.stringify(v)
      r.ok = expect === undefined ? null : typeof expect === "function" ? !!expect(v) : String(v) === String(expect)
    } catch (e) {
      r.error = String(e).slice(0, 160)
      r.ok = false
    }
    if (sup) r.supports = supports(sup[0], sup[1])
    out.tests.push(r)
  }
  var A = "<div class=a></div>"
  var PAB = "<div class=p><div class=a></div><div class=b></div></div>"
  function width(sel) { return function () { return rect(sel).w } }
  function left(sel) { return function () { return rect(sel).x } }
  function height(sel) { return function () { return rect(sel).h } }

  // Layout
  T("layout", "flex", "#H .p{display:flex;width:100px} #H .p>div{width:10px;height:10px}", PAB, left(".b"), near(10))
  T("layout", "flex gap", "#H .p{display:flex;gap:6px;width:100px} #H .p>div{width:10px;height:10px}", PAB, left(".b"), near(16), ["gap", "6px"])
  T("layout", "flex: 1", "#H .p{display:flex;width:100px} #H .a{width:20px;height:5px} #H .b{flex:1;height:5px}", PAB, width(".b"), near(80))
  T("layout", "inline-flex", "#H .a{display:inline-flex}", A, function () { return cs(".a", "display") }, "inline-flex")
  T("layout", "grid columns", "#H .p{display:grid;grid-template-columns:10px 20px;width:100px} #H .p>div{height:5px}", PAB, left(".b"), near(10), ["display", "grid"])
  T("layout", "grid gap", "#H .p{display:grid;grid-template-columns:10px 20px;gap:4px;width:100px} #H .p>div{height:5px}", PAB, left(".b"), near(14))
  // The sim's efb_os.css spaces its grids with grid-gap and never writes gap, so
  // these try the older names and the one-axis properties.
  T("layout", "grid-gap", "#H .p{display:grid;grid-template-columns:10px 20px;grid-gap:4px;width:100px} #H .p>div{height:5px}", PAB, left(".b"), near(14), ["grid-gap", "4px"])
  T("layout", "grid-column-gap", "#H .p{display:grid;grid-template-columns:10px 20px;grid-column-gap:4px;width:100px} #H .p>div{height:5px}", PAB, left(".b"), near(14), ["grid-column-gap", "4px"])
  T("layout", "column-gap in a grid", "#H .p{display:grid;grid-template-columns:10px 20px;column-gap:4px;width:100px} #H .p>div{height:5px}", PAB, left(".b"), near(14), ["column-gap", "4px"])
  T("layout", "column-gap in a flex row", "#H .p{display:flex;column-gap:6px;width:100px} #H .p>div{width:10px;height:10px}", PAB, left(".b"), near(16))
  T("layout", "position: -webkit-sticky", "#H .a{position:-webkit-sticky;top:0}", A, function () { return cs(".a", "position") }, function (v) { return v.indexOf("sticky") !== -1 })
  T("layout", "grid repeat(2, minmax(0, 1fr))", "#H .p{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100px} #H .p>div{height:5px}", PAB, left(".b"), near(50))
  T("layout", "grid place-items: center", "#H .p{display:grid;place-items:center;width:100px;height:100px} #H .a{width:10px;height:10px}", "<div class=p><div class=a></div></div>", left(".a"), near(45))
  T("layout", "aspect-ratio", "#H .a{width:40px;aspect-ratio:2/1}", A, height(".a"), near(20), ["aspect-ratio", "2 / 1"])
  T("layout", "inset", "#H .p{position:relative;width:100px;height:100px} #H .a{position:absolute;inset:5px}", "<div class=p><div class=a></div></div>", width(".a"), near(90), ["inset", "5px"])
  T("layout", "position: sticky", "#H .a{position:sticky;top:0}", A, function () { return cs(".a", "position") }, "sticky")
  T("layout", "margin-inline-start", "#H .a{margin-inline-start:7px;width:5px;height:5px}", A, left(".a"), near(7))
  T("layout", "padding-inline", "#H .a{width:10px;height:1px;padding-inline:5px}", A, width(".a"), near(20))
  T("layout", "padding-block", "#H .a{height:0;padding-block:3px}", A, height(".a"), near(6))
  T("layout", "box-sizing: border-box", "#H .a{box-sizing:border-box;width:20px;padding:5px}", A, width(".a"), near(20))
  T("layout", "display: contents", "#H .a{display:contents}", A, function () { return cs(".a", "display") }, "contents")
  T("layout", "display: flow-root", "#H .a{display:flow-root}", A, function () { return cs(".a", "display") }, "flow-root")

  // Values and units
  T("values", "calc()", "#H .a{width:calc(10px + 5px)}", A, width(".a"), near(15))
  T("values", "min()", "#H .a{width:min(10px, 20px)}", A, width(".a"), near(10), ["width", "min(10px, 20px)"])
  T("values", "max()", "#H .a{width:max(10px, 20px)}", A, width(".a"), near(20))
  T("values", "clamp()", "#H .a{width:clamp(5px, 50px, 12px)}", A, width(".a"), near(12))
  T("values", "rem (the value is 1rem in px)", "#H .a{width:1rem}", A, width(".a"), function (v) { return v > 0 })
  T("values", "em", "#H .a{font-size:10px;width:2em}", A, width(".a"), near(20))
  T("values", "vw (the value is 10vw in px)", "#H .a{width:10vw}", A, width(".a"), near(window.innerWidth / 10))
  T("values", "dvh", "#H .a{height:10dvh}", A, height(".a"), function (v) { return v > 0 }, ["height", "10dvh"])
  T("values", "container query units", "#H .p{container-type:inline-size;width:200px} #H .a{width:10cqw;height:1px}", "<div class=p><div class=a></div></div>", width(".a"), near(20))

  // Custom properties and at-rules
  T("variables", "var()", "#H .a{--w:13px;width:var(--w)}", A, width(".a"), near(13), ["--w", "13px"])
  T("variables", "var() fallback", "#H .a{width:var(--nope, 9px)}", A, width(".a"), near(9))
  T("variables", "var() inherited", "#H{--rw:11px} #H .a{width:var(--rw)}", A, width(".a"), near(11))
  T("variables", "calc(var() * 4)", "#H .a{--s:4px;width:calc(var(--s) * 4)}", A, width(".a"), near(16))
  T("at-rules", "@property", "@property --p13{syntax:'<length>';inherits:false;initial-value:11px} #H .a{width:var(--p13)}", A, width(".a"), near(11))
  T("at-rules", "@layer", "@layer x{#H .a{width:5px}}", A, width(".a"), near(5))
  T("at-rules", "@layer order", "@layer x, y; @layer y{#H .a{width:6px}} @layer x{#H .a{width:5px}}", A, width(".a"), near(6))
  T("at-rules", "@supports", "@supports (display:grid){#H .a{width:3px}}", A, width(".a"), near(3))
  T("at-rules", "@media (min-width)", "@media (min-width:1px){#H .a{width:8px}}", A, width(".a"), near(8))
  T("at-rules", "@media range syntax", "@media (width >= 1px){#H .a{width:8px}}", A, width(".a"), near(8))
  T("at-rules", "@container", "#H .p{container-type:inline-size;width:200px} @container (min-width: 150px){#H .a{width:7px}}", "<div class=p><div class=a></div></div>", width(".a"), near(7))
  T("at-rules", "@keyframes and animation", "@keyframes p13{from{opacity:0}to{opacity:1}} #H .a{animation:p13 1s}", A, function () { return cs(".a", "animation-name") }, "p13")
  T("at-rules", "nesting with &", "#H .p{& .a{width:8px}}", "<div class=p><div class=a></div></div>", width(".a"), near(8))
  T("at-rules", "nesting without &", "#H .p{.a{width:9px}}", "<div class=p><div class=a></div></div>", width(".a"), near(9))

  // Selectors: a selector list with one part the engine can't read drops the
  // whole rule, so each rule lists the selector under test beside a plain one.
  function S(name, sel, html) {
    T("selectors", name, "#H " + sel + ", #H .a{width:4px}", html || A, width(".a"), near(4))
  }
  T("selectors", ":is()", "#H :is(.p) .a{width:4px}", "<div class=p><div class=a></div></div>", width(".a"), near(4))
  T("selectors", ":where()", "#H :where(.p) .a{width:4px}", "<div class=p><div class=a></div></div>", width(".a"), near(4))
  T("selectors", ":not() with a list", "#H .a:not(.x, .y){width:4px}", A, width(".a"), near(4))
  T("selectors", ":has()", "#H .p:has(.a){width:50px}", "<div class=p><div class=a></div></div>", width(".p"), near(50))
  S(":focus-visible", ".a:focus-visible")
  S(":focus-within", ".a:focus-within")
  S("::placeholder", "input::placeholder")
  S("::-webkit-scrollbar", ".a::-webkit-scrollbar")
  S("::selection", ".a::selection")
  S("::marker", ".a::marker")
  T("selectors", "[data-state=open]", "#H [data-state=open]{width:4px}", "<div class=a data-state=open></div>", width(".a"), near(4))
  T("selectors", "::before with content", "#H .a{display:inline-block} #H .a::before{content:'';display:block;width:6px;height:6px}", A, width(".a"), near(6))

  // Colors: a dropped declaration leaves the color the first rule set.
  function C(value) {
    T("colors", value, "#H .c{color:rgb(9, 9, 9)} #H .c.v{color:" + value + "}", "<div class='c v'></div>",
      function () { return cs(".c", "color") }, function (v) { return v !== "rgb(9, 9, 9)" }, ["color", value])
  }
  C("#4fd3ea")
  C("#4fd3ea80")
  C("rgb(79, 211, 234)")
  C("rgb(79 211 234)")
  C("rgb(79 211 234 / 50%)")
  C("rgba(79, 211, 234, 0.5)")
  C("hsl(189, 79%, 61%)")
  C("hsl(189 79% 61%)")
  C("hwb(189 30% 8%)")
  C("oklch(0.8 0.12 210)")
  C("oklch(80% 0.12 210 / 0.5)")
  C("lab(78 -30 -20)")
  C("color(display-p3 0.3 0.8 0.9)")
  C("color-mix(in srgb, red 50%, blue)")
  C("color-mix(in oklab, red 50%, blue)")
  C("color-mix(in oklab, red 50%, transparent)")
  C("rgb(from red r g b / 50%)")
  C("light-dark(white, black)")
  C("currentColor")
  T("colors", "rgba(var() holding a triplet, 0.5), as efb_os.css writes", "#H .c{color:rgb(9, 9, 9)} #H .c.v{--t:1, 2, 3;color:rgba(var(--t), 0.5)}", "<div class='c v'></div>", function () { return cs(".c", "color") }, function (v) { return v.indexOf("1, 2, 3") !== -1 })
  T("colors", "var() holding a color","#H .c{color:rgb(9, 9, 9)} #H .c.v{--k:rgb(1, 2, 3);color:var(--k)}", "<div class='c v'></div>", function () { return cs(".c", "color") }, "rgb(1, 2, 3)")

  // Properties: each test reads the property back after setting a value that
  // isn't its default.
  function P(group, prop, value, read, expect) {
    T(group, prop + ": " + value, "#H .a{" + prop + ":" + value + "}", A,
      function () { return cs(".a", read || prop) }, expect, [prop, value])
  }
  P("effects", "opacity", "50%", null, "0.5")
  P("effects", "opacity", "0.5", null, "0.5")
  T("effects", "outline-offset under a solid outline", "#H .a{outline:1px solid red;outline-offset:2px}", A, function () { return cs(".a", "outline-offset") }, "2px")
  P("effects", "filter", "drop-shadow(0 1px 2px black)", null, function (v) { return v && v !== "none" })
  P("effects", "border-radius", "8px", "border-top-left-radius", "8px")
  P("effects", "box-shadow", "0 1px 2px rgba(0,0,0,0.5), inset 0 0 1px red", null, function (v) { return v && v !== "none" })
  P("effects", "outline-offset", "2px", null, "2px")
  P("effects", "filter", "blur(4px)", null, "blur(4px)")
  P("effects", "backdrop-filter", "blur(4px)", null, function (v) { return v && v !== "none" })
  P("effects", "-webkit-backdrop-filter", "blur(4px)", null, function (v) { return v && v !== "none" })
  P("effects", "mix-blend-mode", "multiply", null, "multiply")
  P("effects", "clip-path", "inset(2px)", null, function (v) { return v && v !== "none" })
  P("effects", "mask-image", "linear-gradient(black, transparent)", null, function (v) { return v && v !== "none" })
  P("effects", "-webkit-mask-image", "linear-gradient(black, transparent)", null, function (v) { return v && v !== "none" })
  P("effects", "background-image", "linear-gradient(red, blue)", null, function (v) { return v && v !== "none" })
  P("effects", "background-image", "radial-gradient(red, blue)", null, function (v) { return v && v !== "none" })
  P("effects", "background-image", "conic-gradient(red, blue)", null, function (v) { return v && v !== "none" })
  P("effects", "background-clip", "text", null, "text")
  P("effects", "-webkit-background-clip", "text", null, "text")
  T("transforms", "transform: translateX()", "#H .a{width:5px;height:5px;transform:translateX(10px)}", A, left(".a"), near(10))
  T("transforms", "translate property", "#H .a{width:5px;height:5px;translate:10px 0}", A, left(".a"), near(10), ["translate", "10px 0"])
  T("transforms", "scale property", "#H .a{width:10px;height:10px;scale:2}", A, width(".a"), near(20), ["scale", "2"])
  T("transforms", "rotate property", "#H .a{width:10px;height:20px;rotate:90deg}", A, width(".a"), near(20), ["rotate", "90deg"])
  P("motion", "transition", "opacity 150ms ease", "transition-duration", "0.15s")
  P("motion", "will-change", "transform", null, "transform")
  P("motion", "contain", "layout", null, "layout")
  P("text", "font-variant-numeric", "tabular-nums", null, "tabular-nums")
  P("text", "font-feature-settings", "\"tnum\"", null, function (v) { return v && v !== "normal" })
  P("text", "text-wrap", "balance", null, function (v) { return v && v.indexOf("balance") !== -1 })
  P("text", "letter-spacing", "0.1em", null, function (v) { return v && v !== "normal" })
  P("text", "text-overflow", "ellipsis", null, "ellipsis")
  P("text", "-webkit-line-clamp", "2", null, "2")
  P("text", "line-clamp", "2", null, "2")
  P("text", "text-underline-offset", "3px", null, "3px")
  P("text", "text-decoration-thickness", "2px", null, "2px")
  P("text", "overflow-wrap", "anywhere", null, "anywhere")
  P("text", "hyphens", "auto", null, "auto")
  P("forms", "accent-color", "red", null, function (v) { return v && v !== "auto" })
  P("forms", "appearance", "none", null, "none")
  P("forms", "-webkit-appearance", "none", null, "none")
  P("forms", "field-sizing", "content", null, "content")
  P("forms", "caret-color", "red", null, function (v) { return v && v !== "auto" })
  P("interaction", "user-select", "none", null, "none")
  P("interaction", "-webkit-user-select", "none", null, "none")
  P("interaction", "cursor", "pointer", null, "pointer")
  P("interaction", "scrollbar-width", "thin", null, "thin")
  P("interaction", "scrollbar-gutter", "stable", null, "stable")
  P("interaction", "overscroll-behavior", "contain", "overscroll-behavior-y", "contain")
  P("interaction", "touch-action", "none", null, "none")
  P("interaction", "color-scheme", "dark", null, "dark")
  P("interaction", "object-fit", "cover", null, "cover")

  // Media features, as Tailwind's variants use them; "not all" means the
  // engine didn't read the query.
  var MEDIA = ["(prefers-color-scheme: dark)", "(prefers-color-scheme: light)", "(prefers-reduced-motion: reduce)",
    "(hover: hover)", "(pointer: fine)", "(min-width: 1px)", "(width >= 1px)", "(min-resolution: 1dppx)", "(forced-colors: active)"]
  for (var m = 0; m < MEDIA.length; m++) {
    try {
      var mq = window.matchMedia(MEDIA[m])
      out.media.push({ query: MEDIA[m], parsed: mq.media, matches: mq.matches })
    } catch (e) { out.media.push({ query: MEDIA[m], error: String(e) }) }
  }

  // The faces the page's own stylesheets declare.
  for (var s = 0; s < document.styleSheets.length; s++) {
    var rules = null
    try { rules = document.styleSheets[s].cssRules } catch (e) { continue }
    if (!rules) continue
    for (var k = 0; k < rules.length; k++) {
      if (rules[k].type === 5) {
        out.fonts.push({
          family: rules[k].style.getPropertyValue("font-family"),
          weight: rules[k].style.getPropertyValue("font-weight"),
          style: rules[k].style.getPropertyValue("font-style"),
          src: rules[k].style.getPropertyValue("src").slice(0, 200)
        })
      }
    }
  }
  out.fontsApi = typeof document.fonts === "object" && document.fonts !== null
  out.context = {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    rootFontSize: getComputedStyle(document.documentElement).getPropertyValue("font-size"),
    bodyFontFamily: document.body ? getComputedStyle(document.body).getPropertyValue("font-family") : null
  }

  host.parentNode.removeChild(host)
  sheet.parentNode.removeChild(sheet)
  return JSON.stringify(out)
}

const pages = await listPages()
const pick = (re) => pages.find((p) => re.test(String(p.title)))
const docs = [
  ["mainUi", pick(/^mainUi$/)],
  ["EFB", pick(/^Electronic Flight Bag$/)],
  ["toolbar", pick(/^Toolbar$/)],
]

const results = []
for (const [label, page] of docs) {
  if (!page) { results.push({ label, missing: true }); continue }
  const insp = new Inspector(page.id)
  try {
    await insp.open()
    results.push({ label, title: page.title, check: JSON.parse(await insp.evaluate(`(${pageCheck.toString()})()`)) })
  } catch (e) {
    results.push({ label, title: page.title, error: e.message })
  } finally {
    insp.close()
    await new Promise((r) => setTimeout(r, 500))
  }
}

// ---------------------------------------------------------------- report

const ran = results.filter((r) => r.check)
const lines = [
  `p13-coherent-css, ${new Date().toISOString()}`,
  `Documents: ${results.map((r) => (r.missing ? `${r.label} (not found)` : r.error ? `${r.label} (failed: ${r.error})` : `${r.label} (${r.title})`)).join("; ")}`,
  `User agents: ${[...new Set(ran.map((r) => r.check.ua))].join(" | ")}`,
]
for (const r of ran) lines.push(`${r.label}: ${JSON.stringify(r.check.context)}`)
lines.push("", "Each test, by document: ✓ did what it should, ✗ didn't, then the value read back, and CSS.supports where asked (s:yes, s:no).")
const tests = ran[0]?.check.tests ?? []
let group = null
for (let i = 0; i < tests.length; i++) {
  if (tests[i].group !== group) { group = tests[i].group; lines.push("", `${group}:`) }
  const cells = ran.map((r) => {
    const t = r.check.tests[i]
    const mark = t.ok === true ? "✓" : t.ok === false ? "✗" : "·"
    const sup = t.supports === undefined ? "" : ` s:${t.supports === true ? "yes" : t.supports === false ? "no" : t.supports}`
    return `${mark} ${t.error ?? t.value}${sup}`
  })
  const same = cells.every((c) => c === cells[0])
  lines.push(`  ${tests[i].name}`)
  if (same) lines.push(`      every document: ${cells[0]}`)
  else ran.forEach((r, j) => lines.push(`      ${r.label}: ${cells[j]}`))
}
lines.push("", "Media queries (parsed as, matches):")
for (const r of ran) for (const m of r.check.media) lines.push(`  ${r.label}, ${m.query}: ${m.error ?? `${m.parsed}, ${m.matches}`}`)
lines.push("", "Faces the pages' stylesheets declare:")
for (const r of ran) {
  lines.push(`  ${r.label}: ${r.check.fonts.length} @font-face rules; document.fonts ${r.check.fontsApi ? "present" : "missing"}`)
  for (const f of r.check.fonts) lines.push(`    ${f.family} ${f.weight} ${f.style}: ${f.src}`)
}
const passed = (r) => r.check.tests.filter((t) => t.ok === true).length
lines.push("", `Passed: ${ran.map((r) => `${r.label} ${passed(r)} of ${r.check.tests.length}`).join("; ")}`)

const text = lines.join("\n")
console.log(text)
console.log(`saved ${repoRelative(saveResult("architecture", "p13-coherent-css", text))}`)
