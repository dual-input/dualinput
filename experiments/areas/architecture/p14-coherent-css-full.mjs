/*
 * p14: all of CSS against Coherent GT, so the Coherent GT check can pass only
 * what the engine draws rather than fail only what p13 happened to try.
 *
 *   node experiments/areas/architecture/p14-coherent-css-full.mjs --baseline
 *   node experiments/areas/architecture/p14-coherent-css-full.mjs
 *
 * The catalog comes from MDN's mdn-data 2.37.2: every property, with each
 * keyword its syntax names; every function, with a sample written here; every
 * unit; every selector; every at-rule; and the media features, listed here
 * since mdn-data has none. Then about 60 layout cases, measured, because the
 * engine can parse a declaration it doesn't lay out, as column-gap showed in p13.
 *
 * --baseline serves the same page code on 127.0.0.1 for current Chromium, here
 * the Claude app's browser pane, which posts its results back. The run in the
 * sim, at the main menu, through the inspector in mainUi, the EFB's document,
 * and the toolbar's, then reports only what Chromium keeps and Coherent GT
 * drops, so a sample of ours that no engine reads isn't counted against the
 * sim, and a layout case passes when it measures what Chromium measured.
 *
 * Each run adds one hidden element and one style element to each page and
 * removes both before it returns, and nothing touches the pilot's input.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { join } from "node:path"

import { Inspector, listPages } from "../../tools/inspector.mjs"
import { REPO, repoRelative, resultFile, stamp } from "../../tools/results.mjs"

const require = createRequire(import.meta.url)
const MDN = (name) => require(`mdn-data/css/${name}.json`)
const MDN_VERSION = require("mdn-data/package.json").version

// ---------------------------------------------------------------- the catalog

const properties = MDN("properties")
const syntaxes = MDN("syntaxes")

// The bare keywords a syntax allows, following `<'other-property'>` and
// `<named-syntax>` references a few levels down; words that only join a
// grammar, such as `at` in a position, are dropped, though a sample no engine
// reads would fall out against the baseline anyway.
const JOINERS = new Set(["at", "of", "from", "to", "by", "in", "and", "or", "not", "only", "round", "with", "as", "on", "using"])
function keywordsOf(syntax, depth = 0, seen = new Set()) {
  const out = new Set()
  if (!syntax || depth > 3) return out
  for (const m of syntax.matchAll(/<'([a-z-]+)'>/g)) {
    if (seen.has(`'${m[1]}`)) continue
    seen.add(`'${m[1]}`)
    for (const k of keywordsOf(properties[m[1]]?.syntax, depth + 1, seen)) out.add(k)
  }
  for (const m of syntax.matchAll(/<([a-z-]+)(?: \[[^\]]*\])?>/g)) {
    if (seen.has(m[1]) || !syntaxes[m[1]]) continue
    seen.add(m[1])
    for (const k of keywordsOf(syntaxes[m[1]].syntax, depth + 1, seen)) out.add(k)
  }
  const bare = syntax
    .replace(/<[^>]*>/g, " ")
    .replace(/'[^']*'/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/[a-z-]+\(/g, " ( ")
  for (const t of bare.split(/[\s|&\[\]{}(),?*+#!\/]+/)) {
    if (/^-?[a-z][a-z0-9-]*$/.test(t) && !JOINERS.has(t)) out.add(t)
  }
  return out
}

const PROPERTIES = Object.entries(properties)
  .filter(([name]) => !name.startsWith("-ms-") && !name.startsWith("-moz-"))
  .map(([name, p]) => ({ name, status: p.status, keywords: [...keywordsOf(p.syntax)].slice(0, 40) }))

// Each function's sample, as [property, value], or [property, value, "before"]
// for one that works only in `content` on a ::before. A function with no
// sample here is listed in the report as untested.
const FUNCTION_SAMPLES = {
  "abs()": [["width", "abs(-10px)"]],
  "acos()": [["transform", "rotate(acos(0.5))"]],
  "alpha()": [["color", "alpha(from red / 0.5)"]],
  "anchor()": [["top", "anchor(--p14 bottom)"]],
  "anchor-size()": [["width", "anchor-size(--p14 width)"]],
  "asin()": [["transform", "rotate(asin(0.5))"]],
  "atan()": [["transform", "rotate(atan(1))"]],
  "atan2()": [["transform", "rotate(atan2(1, 1))"]],
  "attr()": [["content", "attr(data-x)", "before"]],
  "blur()": [["filter", "blur(2px)"]],
  "brightness()": [["filter", "brightness(0.5)"]],
  "calc()": [["width", "calc(1px + 2px)"]],
  "calc-size()": [["height", "calc-size(auto, size + 1px)"]],
  "circle()": [["clip-path", "circle(50%)"], ["-webkit-clip-path", "circle(50%)"], ["shape-outside", "circle(50%)"]],
  "clamp()": [["width", "clamp(1px, 2px, 3px)"]],
  "color()": [["color", "color(srgb 1 0 0)"]],
  "color-mix()": [["color", "color-mix(in srgb, red 50%, blue)"]],
  "conic-gradient()": [["background-image", "conic-gradient(red, blue)"]],
  "contrast()": [["filter", "contrast(0.5)"]],
  "cos()": [["width", "calc(cos(0) * 10px)"]],
  "counter()": [["content", "counter(p14)", "before"]],
  "counters()": [["content", "counters(p14, \".\")", "before"]],
  "cross-fade()": [["background-image", "cross-fade(linear-gradient(red, red) 50%, linear-gradient(blue, blue))"], ["background-image", "-webkit-cross-fade(linear-gradient(red, red), linear-gradient(blue, blue), 50%)"]],
  "cubic-bezier()": [["transition-timing-function", "cubic-bezier(0.1, 0.2, 0.3, 0.4)"]],
  "drop-shadow()": [["filter", "drop-shadow(0 1px 2px black)"]],
  "element()": [["background-image", "element(#p14)"], ["background-image", "-moz-element(#p14)"]],
  "ellipse()": [["clip-path", "ellipse(50% 40%)"], ["-webkit-clip-path", "ellipse(50% 40%)"]],
  "env()": [["width", "env(safe-area-inset-left, 1px)"]],
  "exp()": [["width", "calc(exp(1) * 1px)"]],
  "fit-content()": [["grid-template-columns", "fit-content(10px)"], ["width", "fit-content(10px)"]],
  "grayscale()": [["filter", "grayscale(1)"]],
  "hsl()": [["color", "hsl(120, 50%, 50%)"]],
  "hsla()": [["color", "hsla(120, 50%, 50%, 0.5)"]],
  "hue-rotate()": [["filter", "hue-rotate(90deg)"]],
  "hwb()": [["color", "hwb(120 30% 30%)"]],
  "hypot()": [["width", "hypot(3px, 4px)"]],
  "image()": [["background-image", "image(red)"]],
  "image-set()": [["background-image", "image-set(\"p14.png\" 1x)"], ["background-image", "-webkit-image-set(url(p14.png) 1x)"]],
  "inset()": [["clip-path", "inset(1px)"], ["-webkit-clip-path", "inset(1px)"]],
  "invert()": [["filter", "invert(1)"]],
  "lab()": [["color", "lab(50 20 30)"]],
  "lch()": [["color", "lch(50 30 120)"]],
  "leader()": [["content", "leader(dotted)", "before"]],
  "light-dark()": [["color", "light-dark(white, black)"]],
  "linear()": [["transition-timing-function", "linear(0, 0.5, 1)"]],
  "linear-gradient()": [["background-image", "linear-gradient(red, blue)"], ["background-image", "linear-gradient(to right, red 10%, blue)"], ["background-image", "linear-gradient(45deg, red, blue)"], ["background-image", "-webkit-linear-gradient(red, blue)"]],
  "log()": [["width", "calc(log(10) * 1px)"]],
  "matrix()": [["transform", "matrix(1, 0, 0, 1, 0, 0)"]],
  "matrix3d()": [["transform", "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)"]],
  "max()": [["width", "max(1px, 2px)"]],
  "min()": [["width", "min(1px, 2px)"]],
  "minmax()": [["grid-template-columns", "minmax(10px, 1fr)"]],
  "mod()": [["width", "mod(7px, 3px)"]],
  "oklab()": [["color", "oklab(0.5 0.1 0.1)"]],
  "oklch()": [["color", "oklch(0.5 0.1 120)"]],
  "opacity()": [["filter", "opacity(0.5)"]],
  "paint()": [["background-image", "paint(p14)"]],
  "palette-mix()": [["font-palette", "palette-mix(in lch, light, dark)"]],
  "param()": [["link-parameters", "param(--p14, red)"]],
  "path()": [["clip-path", "path(\"M0 0 L10 0 L10 10 Z\")"], ["offset-path", "path(\"M0 0 L10 10\")"]],
  "perspective()": [["transform", "perspective(100px)"]],
  "polygon()": [["clip-path", "polygon(0 0, 10px 0, 10px 10px)"], ["-webkit-clip-path", "polygon(0 0, 10px 0, 10px 10px)"]],
  "pow()": [["width", "calc(pow(2, 3) * 1px)"]],
  "radial-gradient()": [["background-image", "radial-gradient(red, blue)"], ["background-image", "radial-gradient(circle at center, red, blue)"]],
  "ray()": [["offset-path", "ray(45deg)"]],
  "rect()": [["clip-path", "rect(0 10px 10px 0)"], ["clip", "rect(0, 10px, 10px, 0)"]],
  "rem()": [["width", "rem(7px, 3px)"]],
  "repeating-conic-gradient()": [["background-image", "repeating-conic-gradient(red 0deg, red 10deg, blue 10deg, blue 20deg)"]],
  "repeating-linear-gradient()": [["background-image", "repeating-linear-gradient(red, red 10px, blue 10px, blue 20px)"]],
  "repeating-radial-gradient()": [["background-image", "repeating-radial-gradient(red, red 10px, blue 10px, blue 20px)"]],
  "rgb()": [["color", "rgb(1, 2, 3)"]],
  "rgba()": [["color", "rgba(1, 2, 3, 0.5)"]],
  "rotate()": [["transform", "rotate(10deg)"]],
  "rotate3d()": [["transform", "rotate3d(1, 0, 0, 10deg)"]],
  "rotateX()": [["transform", "rotateX(10deg)"]],
  "rotateY()": [["transform", "rotateY(10deg)"]],
  "rotateZ()": [["transform", "rotateZ(10deg)"]],
  "round()": [["width", "round(nearest, 7px, 3px)"]],
  "saturate()": [["filter", "saturate(2)"]],
  "scale()": [["transform", "scale(2)"]],
  "scale3d()": [["transform", "scale3d(1, 2, 1)"]],
  "scaleX()": [["transform", "scaleX(2)"]],
  "scaleY()": [["transform", "scaleY(2)"]],
  "scaleZ()": [["transform", "scaleZ(2)"]],
  "scroll()": [["animation-timeline", "scroll()"]],
  "sepia()": [["filter", "sepia(1)"]],
  "sign()": [["width", "calc(sign(-1) * -1px)"]],
  "sin()": [["width", "calc(sin(0) * 1px + 1px)"]],
  "skew()": [["transform", "skew(10deg)"]],
  "skewX()": [["transform", "skewX(10deg)"]],
  "skewY()": [["transform", "skewY(10deg)"]],
  "sqrt()": [["width", "calc(sqrt(4) * 1px)"]],
  "steps()": [["transition-timing-function", "steps(4, end)"]],
  "symbols()": [["list-style-type", "symbols(cyclic \"*\")"]],
  "tan()": [["width", "calc(tan(0) * 1px + 1px)"]],
  "target-counter()": [["content", "target-counter(url(#p14), page)", "before"]],
  "target-counters()": [["content", "target-counters(url(#p14), page, \".\")", "before"]],
  "target-text()": [["content", "target-text(url(#p14))", "before"]],
  "translate()": [["transform", "translate(1px, 2px)"]],
  "translate3d()": [["transform", "translate3d(1px, 2px, 3px)"]],
  "translateX()": [["transform", "translateX(1px)"]],
  "translateY()": [["transform", "translateY(1px)"]],
  "translateZ()": [["transform", "translateZ(1px)"]],
  "var()": [["width", "var(--p14, 1px)"]],
  "view()": [["animation-timeline", "view()"]],
  "xywh()": [["clip-path", "xywh(0 0 10px 10px)"]],
}
// layer() appears only in an @import, which the at-rules test.
const FUNCTION_ELSEWHERE = { "layer()": "@import with layer()" }

// Forms beyond one sample a function, as the color syntaxes p13 split on.
const VALUE_FORMS = [
  ["color", "#123"], ["color", "#1234"], ["color", "#112233"], ["color", "#11223344"],
  ["color", "rebeccapurple"], ["color", "transparent"], ["color", "currentcolor"],
  ["color", "rgb(1 2 3)"], ["color", "rgb(1 2 3 / 0.5)"], ["color", "rgb(1 2 3 / 50%)"], ["color", "rgb(10%, 20%, 30%)"],
  ["color", "rgba(1, 2, 3, 50%)"], ["color", "hsl(120deg, 50%, 50%)"], ["color", "hsl(120 50% 50%)"], ["color", "hsl(120 50% 50% / 0.5)"],
  ["color", "rgb(from red r g b)"], ["color", "Canvas"], ["color", "CanvasText"], ["color", "ButtonFace"], ["color", "Highlight"],
  ["color", "-webkit-focus-ring-color"],
  ["color", "initial"], ["color", "inherit"], ["color", "unset"], ["color", "revert"], ["color", "revert-layer"],
  ["width", "var(--p14a, var(--p14b, 1px))"], ["margin", "var(--p14, 1px) 2px"], ["width", "1px !important"],
  ["width", "-webkit-calc(1px + 1px)"], ["width", "calc(100% - 2 * 3px)"], ["width", "calc(1px * (2 + 3))"],
  ["width", "-webkit-fit-content"], ["width", "fit-content"], ["width", "max-content"], ["width", "min-content"], ["width", "stretch"], ["width", "-webkit-fill-available"],
  ["background-image", "url(p14.png)"], ["background-image", "url(p14.png), linear-gradient(red, blue)"],
  ["background-image", "-webkit-gradient(linear, left top, left bottom, from(red), to(blue))"],
  ["background", "linear-gradient(red, blue) center / cover no-repeat"],
  ["transition", "opacity 150ms ease, transform 0.2s ease-out 50ms"],
  ["transition", "all 150ms"], ["transition-behavior", "allow-discrete"],
  ["font", "600 12px/1.5 Roboto-Regular, sans-serif"],
  ["font-family", "\"Roboto Mono\", monospace"],
  ["border", "1px solid rgba(255, 255, 255, 0.1)"],
  ["border-radius", "4px 8px / 2px"],
  ["box-shadow", "0 0 0 1px red, 0 1px 2px rgba(0, 0, 0, 0.5)"],
  ["outline", "2px solid red"], ["outline", "2px auto red"],
  ["grid-template-columns", "repeat(auto-fill, minmax(10px, 1fr))"], ["grid-template-columns", "repeat(auto-fit, 10px)"],
  ["grid-template-columns", "[a] 10px [b] 20px"], ["grid-template-columns", "subgrid"], ["grid-template-columns", "masonry"],
  ["grid-template-areas", "\"a b\" \"c d\""], ["grid-area", "1 / 1 / 2 / 3"], ["grid-column", "span 2"], ["grid-column", "1 / -1"],
  ["flex", "1 1 0%"], ["flex", "1"], ["flex", "none"], ["flex-flow", "row wrap"],
  ["inset", "0"], ["inset-inline", "0"], ["margin-block", "1px"],
  ["will-change", "transform, opacity"],
]

const UNITS = [
  ...["px", "em", "rem", "ex", "ch", "cap", "ic", "lh", "rlh", "rex", "rch", "ric", "rcap",
    "vw", "vh", "vmin", "vmax", "vi", "vb", "svw", "svh", "lvw", "lvh", "dvw", "dvh", "svi", "svb", "dvi", "dvb",
    "cqw", "cqh", "cqi", "cqb", "cqmin", "cqmax", "cm", "mm", "Q", "in", "pt", "pc", "%"].map((u) => ["width", `1${u}`, u]),
  ...["deg", "grad", "rad", "turn"].map((u) => ["transform", `rotate(1${u})`, u]),
  ...["s", "ms"].map((u) => ["transition-duration", `1${u}`, u]),
  ["grid-template-columns", "1fr", "fr"],
  ...["dpi", "dpcm", "dppx", "x"].map((u) => ["@media", `(min-resolution: 1${u})`, u]),
]
// mdn-data lists these; the length units it lacks are listed by hand above.
const MDN_UNITS = Object.keys(MDN("units"))

// Each selector mdn-data lists, as a selector that holds it.
const SELECTOR_ARGS = {
  ":active-view-transition-type()": ":active-view-transition-type(p14)", ":dir()": ":dir(ltr)", ":has()": ":has(.y)",
  ":host()": ":host(.y)", ":host-context()": ":host-context(.y)", ":is()": ":is(.y)", ":lang()": ":lang(en)",
  ":not()": ":not(.y)", ":nth-child()": ":nth-child(2n+1)", ":nth-last-child()": ":nth-last-child(2)",
  ":nth-last-of-type()": ":nth-last-of-type(2)", ":nth-of-type()": ":nth-of-type(2)", ":state()": ":state(p14)",
  ":where()": ":where(.y)", "::cue()": "::cue(b)", "::cue-region()": "::cue-region(b)", "::highlight()": "::highlight(p14)",
  "::part()": "::part(p14)", "::picker()": "::picker(select)", "::slotted()": "::slotted(span)",
  "::view-transition-group()": "::view-transition-group(p14)", "::view-transition-image-pair()": "::view-transition-image-pair(p14)",
  "::view-transition-new()": "::view-transition-new(p14)", "::view-transition-old()": "::view-transition-old(p14)",
}
const SELECTOR_FORMS = {
  "Type selectors": ["div"], "Class selectors": [".y"], "ID selectors": ["#p14"], "Universal selectors": ["*"],
  "Attribute selectors": ["[data-a]", "[data-a=b]", "[data-a~=b]", "[data-a|=b]", "[data-a^=b]", "[data-a$=b]", "[data-a*=b]", "[data-a=b i]", "[data-a=b s]"],
  "Nesting selector": ["&"], "Selector list": [".y, .z"], "Next-sibling combinator": [".y + .z"],
  "Subsequent-sibling combinator": [".y ~ .z"], "Child combinator": [".y > .z"], "Descendant combinator": [".y .z"],
  "Column combinator": [".y || .z"], "Namespace separator": ["*|*"],
  "Pseudo-classes": [], "Pseudo-elements": [],
}
const SELECTOR_EXTRAS = [":nth-child(2 of .y)", ":not(.y, .z)", ":not(.y .z)", ":is(.y, :hover)", ":-webkit-any(.y)", ":matches(.y)", "::-webkit-input-placeholder", ":-webkit-autofill", ":hover", ":focus"]
const SELECTORS = []
for (const name of Object.keys(MDN("selectors"))) {
  if (SELECTOR_FORMS[name]) for (const sel of SELECTOR_FORMS[name]) SELECTORS.push({ name, sel: sel === "&" ? "&" : `.x ${sel}`.replace(".x &", "&") })
  else if (name.startsWith(":")) SELECTORS.push({ name, sel: `.x${SELECTOR_ARGS[name] ?? name}` })
}
for (const sel of SELECTOR_EXTRAS) SELECTORS.push({ name: sel, sel: `.x${sel}`, extra: true })

// Each at-rule mdn-data lists, as a sheet of its own, since @charset,
// @import, and @namespace must come first.
const AT_RULES = [
  ["@charset", "@charset \"utf-8\";"],
  ["@counter-style", "@counter-style p14 { system: cyclic; symbols: \"*\"; }"],
  ["@container", "@container (min-width: 1px) { .x { z-index: 1 } }"],
  ["@document", "@document url-prefix() { .x { z-index: 1 } }"],
  ["@font-face", "@font-face { font-family: p14; src: local(Arial); }"],
  ["@font-feature-values", "@font-feature-values p14 { @styleset { nice: 12; } }"],
  ["@font-palette-values", "@font-palette-values --p14 { font-family: Roboto-Regular; }"],
  ["@import", "@import url(\"data:text/css,.x{z-index:1}\");"],
  ["@import with layer()", "@import url(\"data:text/css,.x{z-index:1}\") layer(p14);"],
  ["@import with supports()", "@import url(\"data:text/css,.x{z-index:1}\") supports(display: grid);"],
  ["@keyframes", "@keyframes p14 { from { opacity: 0 } to { opacity: 1 } }"],
  ["@-webkit-keyframes", "@-webkit-keyframes p14 { from { opacity: 0 } to { opacity: 1 } }"],
  ["@layer", "@layer p14 { .x { z-index: 1 } }"],
  ["@layer statement", "@layer p14a, p14b;"],
  ["@media", "@media screen { .x { z-index: 1 } }"],
  ["@namespace", "@namespace svg url(http://www.w3.org/2000/svg);"],
  ["@page", "@page { margin: 1cm }"],
  ["@position-try", "@position-try --p14 { top: 0 }"],
  ["@property", "@property --p14 { syntax: \"<length>\"; inherits: false; initial-value: 0px; }"],
  ["@scope", "@scope (.x) { .y { z-index: 1 } }"],
  ["@starting-style", "@starting-style { .x { opacity: 0 } }"],
  ["@supports", "@supports (display: grid) { .x { z-index: 1 } }"],
  ["@supports not", "@supports not (display: p14) { .x { z-index: 1 } }"],
  ["@supports selector()", "@supports selector(:has(a)) { .x { z-index: 1 } }"],
  ["@view-transition", "@view-transition { navigation: auto; }"],
  ["nesting with &", ".x { & .y { z-index: 1 } }"],
  ["nesting without &", ".x { .y { z-index: 1 } }"],
  ["nested @media", ".x { @media (min-width: 1px) { z-index: 1 } }"],
]

// mdn-data lists no media features, so these come from Media Queries 4 and 5.
const MEDIA = [
  "all", "screen", "print", "speech", "only screen", "not print", "not all and (min-width: 1px)",
  "(width: 100px)", "(min-width: 1px)", "(max-width: 99999px)", "(height: 100px)", "(min-height: 1px)",
  "(aspect-ratio: 16/9)", "(min-aspect-ratio: 1/1)", "(orientation: landscape)",
  "(resolution: 1dppx)", "(-webkit-min-device-pixel-ratio: 1)", "(-webkit-device-pixel-ratio: 1)",
  "(device-width: 100px)", "(device-aspect-ratio: 16/9)", "(color)", "(min-color: 1)", "(color-index)", "(monochrome)",
  "(color-gamut: srgb)", "(dynamic-range: standard)", "(video-dynamic-range: standard)",
  "(hover: hover)", "(hover: none)", "(any-hover: hover)", "(pointer: fine)", "(pointer: none)", "(any-pointer: fine)",
  "(prefers-color-scheme: dark)", "(prefers-contrast: more)", "(prefers-reduced-motion: reduce)", "(prefers-reduced-motion: no-preference)",
  "(prefers-reduced-transparency: reduce)", "(prefers-reduced-data: reduce)", "(forced-colors: active)", "(inverted-colors: none)",
  "(scripting: enabled)", "(update: fast)", "(overflow-block: scroll)", "(overflow-inline: scroll)", "(grid: 0)", "(scan: progressive)",
  "(display-mode: browser)",
  "(min-width: 1px) and (max-width: 99999px)", "(min-width: 1px), print", "(width >= 1px)", "(1px <= width <= 99999px)",
  "(not (hover: hover))", "((min-width: 1px) or (hover: hover))", "(min-width: calc(1px + 1px))", "(min-width: 1em)",
]

// Layout, measured: CSS under #H, the host; the elements; and what to read,
// as [selector, what], where what is x, y, w, h, or a computed property.
const PAB = "<div class=p><div class=a></div><div class=b></div></div>"
const P3 = "<div class=p><div class=a></div><div class=b></div><div class=c></div></div>"
const PA = "<div class=p><div class=a></div></div>"
const BOX = "#H .p>div{width:10px;height:10px}"
const LAYOUT = [
  ["spacing", "gap in a flex row", `#H .p{display:flex;gap:6px;width:100px} ${BOX}`, PAB, [[".b", "x"]]],
  ["spacing", "row-gap in a wrapping flex row", `#H .p{display:flex;flex-wrap:wrap;row-gap:5px;width:15px} ${BOX}`, PAB, [[".b", "y"]]],
  ["spacing", "gap in a grid", `#H .p{display:grid;grid-template-columns:10px 10px;gap:4px} ${BOX}`, PAB, [[".b", "x"]]],
  ["spacing", "grid-gap", `#H .p{display:grid;grid-template-columns:10px 10px;grid-gap:4px} ${BOX}`, PAB, [[".b", "x"]]],
  ["spacing", "grid-row-gap", `#H .p{display:grid;grid-template-columns:10px;grid-row-gap:4px} ${BOX}`, PAB, [[".b", "y"]]],
  ["spacing", "grid-gap with fr tracks", "#H .p{display:grid;grid-template-columns:1fr 1fr;grid-gap:10px;width:110px} #H .p>div{height:5px}", PAB, [[".b", "x"], [".a", "w"]]],
  ["spacing", "margin-left: auto in a flex row", `#H .p{display:flex;width:100px} ${BOX} #H .b{margin-left:auto}`, PAB, [[".b", "x"]]],
  ["spacing", "margin: 0 auto on a block", "#H .a{width:10px;height:1px;margin:0 auto}", "<div class=a></div>", [[".a", "x"]]],
  ["spacing", "a negative margin", "#H .a{width:10px;height:1px;margin-left:-5px}", "<div class=a></div>", [[".a", "x"]]],
  ["spacing", "a sibling margin through :not(:first-child)", `#H .p{display:flex} ${BOX} #H .p>div:not(:first-child){margin-left:6px}`, P3, [[".b", "x"], [".c", "x"]]],
  ["spacing", "a sibling margin through + *", `#H .p{display:flex} ${BOX} #H .p>*+*{margin-left:6px}`, P3, [[".b", "x"], [".c", "x"]]],
  ["flex", "flex-wrap: wrap", `#H .p{display:flex;flex-wrap:wrap;width:15px} ${BOX}`, PAB, [[".b", "y"]]],
  ["flex", "flex-direction: column", `#H .p{display:flex;flex-direction:column} ${BOX}`, PAB, [[".b", "x"], [".b", "y"]]],
  ["flex", "flex-direction: row-reverse", `#H .p{display:flex;flex-direction:row-reverse;width:100px} ${BOX}`, PAB, [[".a", "x"]]],
  ["flex", "flex-direction: column-reverse", `#H .p{display:flex;flex-direction:column-reverse} ${BOX}`, PAB, [[".a", "y"]]],
  ["flex", "order", `#H .p{display:flex} ${BOX} #H .a{order:2}`, PAB, [[".a", "x"]]],
  ["flex", "justify-content: space-between", `#H .p{display:flex;justify-content:space-between;width:100px} ${BOX}`, PAB, [[".b", "x"]]],
  ["flex", "justify-content: space-around", `#H .p{display:flex;justify-content:space-around;width:100px} ${BOX}`, PAB, [[".a", "x"]]],
  ["flex", "justify-content: space-evenly", `#H .p{display:flex;justify-content:space-evenly;width:100px} ${BOX}`, PAB, [[".a", "x"]]],
  ["flex", "justify-content: center", `#H .p{display:flex;justify-content:center;width:100px} ${BOX}`, PAB, [[".a", "x"]]],
  ["flex", "justify-content: flex-end", `#H .p{display:flex;justify-content:flex-end;width:100px} ${BOX}`, PAB, [[".a", "x"]]],
  ["flex", "justify-content: end", `#H .p{display:flex;justify-content:end;width:100px} ${BOX}`, PAB, [[".a", "x"]]],
  ["flex", "align-items: center", `#H .p{display:flex;align-items:center;height:100px} ${BOX}`, PAB, [[".a", "y"]]],
  ["flex", "align-items: flex-end", `#H .p{display:flex;align-items:flex-end;height:100px} ${BOX}`, PAB, [[".a", "y"]]],
  ["flex", "align-items: stretch, by default", "#H .p{display:flex;height:50px} #H .a{width:10px}", PA, [[".a", "h"]]],
  ["flex", "align-self: flex-end", `#H .p{display:flex;height:100px} ${BOX} #H .b{align-self:flex-end}`, PAB, [[".b", "y"]]],
  ["flex", "align-content: space-between", `#H .p{display:flex;flex-wrap:wrap;align-content:space-between;width:15px;height:100px} ${BOX}`, PAB, [[".b", "y"]]],
  ["flex", "flex: 1 1 0 splits evenly", "#H .p{display:flex;width:100px} #H .p>div{flex:1 1 0;height:5px} #H .a{padding-left:20px}", PAB, [[".a", "w"], [".b", "x"]]],
  ["flex", "flex-shrink: 0", "#H .p{display:flex;width:50px} #H .p>div{width:40px;height:5px} #H .a{flex-shrink:0}", PAB, [[".a", "w"], [".b", "w"]]],
  ["flex", "flex: none", "#H .p{display:flex;width:50px} #H .p>div{width:40px;height:5px} #H .a{flex:none}", PAB, [[".a", "w"]]],
  ["flex", "min-width: 0 lets an item shrink below its content", "#H .p{display:flex;width:50px} #H .a{min-width:0;flex:1} #H .a>i{display:block;width:100px;height:1px} #H .b{width:10px;height:1px}", "<div class=p><div class=a><i></i></div><div class=b></div></div>", [[".a", "w"]]],
  ["flex", "direction: rtl in a flex row", `#H .p{display:flex;direction:rtl;width:100px} ${BOX}`, PAB, [[".a", "x"]]],
  ["grid", "grid-template-areas", `#H .p{display:grid;grid-template-columns:10px 20px;grid-template-areas:"x y"} ${BOX} #H .a{grid-area:y}`, PAB, [[".a", "x"]]],
  ["grid", "grid-auto-flow: column", `#H .p{display:grid;grid-auto-flow:column;grid-auto-columns:10px} ${BOX}`, PAB, [[".b", "x"]]],
  ["grid", "grid-auto-flow: row dense", `#H .p{display:grid;grid-template-columns:10px 10px;grid-auto-flow:row dense} ${BOX} #H .a{grid-column:span 2}`, P3, [[".c", "x"], [".c", "y"]]],
  ["grid", "repeat(auto-fill, minmax())", `#H .p{display:grid;grid-template-columns:repeat(auto-fill,minmax(10px,1fr));width:100px} #H .p>div{height:5px}`, PAB, [[".b", "x"]]],
  ["grid", "repeat(auto-fit, minmax())", `#H .p{display:grid;grid-template-columns:repeat(auto-fit,minmax(10px,1fr));width:100px} #H .p>div{height:5px}`, PAB, [[".b", "x"], [".a", "w"]]],
  ["grid", "fit-content() track", "#H .p{display:grid;grid-template-columns:fit-content(30px) 10px;width:100px} #H .a>i{display:block;width:100px;height:1px}", "<div class=p><div class=a><i></i></div><div class=b></div></div>", [[".b", "x"]]],
  ["grid", "grid-column: span 2", `#H .p{display:grid;grid-template-columns:10px 10px 10px} ${BOX} #H .a{grid-column:span 2}`, PAB, [[".b", "x"]]],
  ["grid", "grid-row: 2 / 3", `#H .p{display:grid;grid-template-columns:10px} ${BOX} #H .a{grid-row:2 / 3}`, PAB, [[".a", "y"]]],
  ["grid", "grid-column: -2", `#H .p{display:grid;grid-template-columns:10px 10px 10px} ${BOX} #H .a{grid-column:-2}`, PAB, [[".a", "x"]]],
  ["grid", "named lines", `#H .p{display:grid;grid-template-columns:[x] 10px [y] 20px} ${BOX} #H .a{grid-column-start:y}`, PAB, [[".a", "x"]]],
  ["grid", "justify-items: center", "#H .p{display:grid;grid-template-columns:100px;justify-items:center} #H .a{width:10px;height:10px}", PA, [[".a", "x"]]],
  ["grid", "justify-self: end", "#H .p{display:grid;grid-template-columns:100px} #H .a{width:10px;height:10px;justify-self:end}", PA, [[".a", "x"]]],
  ["grid", "place-self: center", "#H .p{display:grid;grid-template-columns:100px;grid-template-rows:100px} #H .a{width:10px;height:10px;place-self:center}", PA, [[".a", "x"], [".a", "y"]]],
  ["grid", "place-content: center", "#H .p{display:grid;grid-template-columns:10px;width:100px;height:100px;place-content:center} #H .a{height:10px}", PA, [[".a", "x"], [".a", "y"]]],
  ["grid", "align-items: end", "#H .p{display:grid;grid-template-rows:100px} #H .a{width:10px;height:10px} #H .p{align-items:end}", PA, [[".a", "y"]]],
  ["grid", "grid-auto-rows", `#H .p{display:grid;grid-auto-rows:7px} #H .p>div{width:10px}`, PAB, [[".b", "y"]]],
  ["grid", "subgrid", "#H .p{display:grid;grid-template-columns:10px 20px} #H .q{grid-column:1 / 3;display:grid;grid-template-columns:subgrid} #H .q>div{height:5px}", "<div class=p><div class=q><div class=a></div><div class=b></div></div></div>", [[".b", "x"]]],
  ["grid", "grid-template shorthand", `#H .p{display:grid;grid-template:10px 10px / 10px 30px} ${BOX}`, PAB, [[".b", "x"]]],
  ["position", "absolute with right and bottom", "#H .p{position:relative;width:100px;height:100px} #H .a{position:absolute;right:5px;bottom:5px;width:10px;height:10px}", PA, [[".a", "x"], [".a", "y"]]],
  ["position", "absolute with a percent", "#H .p{position:relative;width:100px;height:100px} #H .a{position:absolute;left:50%;top:25%;width:10px;height:10px}", PA, [[".a", "x"], [".a", "y"]]],
  ["position", "relative offsets", "#H .a{position:relative;left:5px;top:3px;width:10px;height:10px}", "<div class=a></div>", [[".a", "x"], [".a", "y"]]],
  ["position", "float: right", "#H .p{width:100px} #H .a{float:right;width:10px;height:10px}", PA, [[".a", "x"]]],
  ["position", "position: fixed, computed", "#H .a{position:fixed}", "<div class=a></div>", [[".a", "position"]]],
  ["position", "z-index, computed", "#H .a{position:relative;z-index:3}", "<div class=a></div>", [[".a", "z-index"]]],
  ["display", "inline-block in a row", "#H .p>div{display:inline-block;width:10px;height:10px}", PAB, [[".b", "x"]]],
  ["display", "table and table-cell", "#H .p{display:table;width:100px} #H .p>div{display:table-cell;height:5px} #H .a{width:30px}", PAB, [[".b", "x"]]],
  ["display", "display: none", "#H .a{display:none;width:10px}", "<div class=a></div>", [[".a", "w"]]],
  ["display", "display: list-item, computed", "#H .a{display:list-item}", "<div class=a></div>", [[".a", "display"]]],
  ["display", "columns: 2", "#H .p{columns:2;column-gap:0;width:100px} #H .p>div{height:10px}", PAB, [[".b", "x"], [".b", "y"]]],
  ["display", "-webkit-box with -webkit-box-flex", "#H .p{display:-webkit-box;width:100px} #H .p>div{height:5px} #H .a{-webkit-box-flex:1}", PAB, [[".a", "w"]]],
  ["sizing", "width: fit-content", "#H .p{width:fit-content} #H .p>div{width:10px;height:1px}", PA, [[".p", "w"]]],
  ["sizing", "width: -webkit-fit-content", "#H .p{width:-webkit-fit-content} #H .p>div{width:10px;height:1px}", PA, [[".p", "w"]]],
  ["sizing", "width: max-content", "#H .p{width:max-content} #H .p>div{width:10px;height:1px}", PA, [[".p", "w"]]],
  ["sizing", "max-width below width", "#H .a{width:50px;max-width:20px;height:1px}", "<div class=a></div>", [[".a", "w"]]],
  ["sizing", "min-height above height", "#H .a{height:5px;min-height:20px}", "<div class=a></div>", [[".a", "h"]]],
  ["sizing", "a percent width", "#H .p{width:100px} #H .a{width:50%;height:1px}", PA, [[".a", "w"]]],
  ["sizing", "a percent height", "#H .p{height:100px} #H .a{height:50%}", PA, [[".a", "h"]]],
  ["sizing", "content-box with padding and a border", "#H .a{width:20px;padding:5px;border:1px solid red;height:1px}", "<div class=a></div>", [[".a", "w"]]],
  ["text", "text-align: center on an inline-block", "#H .p{width:100px;text-align:center} #H .a{display:inline-block;width:10px;height:10px}", PA, [[".a", "x"]]],
  ["text", "text-align: end", "#H .p{width:100px;text-align:end} #H .a{display:inline-block;width:10px;height:10px}", PA, [[".a", "x"]]],
  ["text", "text-align: right", "#H .p{width:100px;text-align:right} #H .a{display:inline-block;width:10px;height:10px}", PA, [[".a", "x"]]],
  ["text", "writing-mode: vertical-rl", "#H .p{writing-mode:vertical-rl;height:100px} #H .p>div{width:10px;height:10px}", PAB, [[".a", "x"], [".b", "x"]]],
  ["transforms", "translateX(50%) of its own width", "#H .a{width:20px;height:1px;transform:translateX(50%)}", "<div class=a></div>", [[".a", "x"]]],
  ["transforms", "scale(2) on the box", "#H .a{width:10px;height:10px;transform:scale(2)}", "<div class=a></div>", [[".a", "w"]]],
  ["transforms", "rotate(90deg) on the box", "#H .a{width:10px;height:20px;transform:rotate(90deg)}", "<div class=a></div>", [[".a", "w"]]],
  ["transforms", "transform-origin with scale", "#H .a{width:10px;height:10px;transform-origin:0 0;transform:scale(2)}", "<div class=a></div>", [[".a", "x"]]],
  ["overflow", "overflow: hidden keeps its box", "#H .a{width:10px;height:10px;overflow:hidden} #H .a>i{display:block;width:50px;height:50px}", "<div class=a><i></i></div>", [[".a", "w"], [".a", "overflow-x"]]],
  ["overflow", "overflow: clip, computed", "#H .a{overflow:clip}", "<div class=a></div>", [[".a", "overflow-x"]]],
  ["overflow", "text-overflow: ellipsis, computed", "#H .a{text-overflow:ellipsis;overflow:hidden;white-space:nowrap}", "<div class=a></div>", [[".a", "text-overflow"]]],
]

const CATALOG = { properties: PROPERTIES, functions: [], values: VALUE_FORMS, units: UNITS, selectors: SELECTORS, atRules: AT_RULES, media: MEDIA, layout: LAYOUT }
const UNTESTED_FUNCTIONS = []
for (const name of Object.keys(MDN("functions"))) {
  if (FUNCTION_SAMPLES[name]) for (const [prop, value, pseudo] of FUNCTION_SAMPLES[name]) CATALOG.functions.push({ name, prop, value, pseudo })
  else if (!FUNCTION_ELSEWHERE[name]) UNTESTED_FUNCTIONS.push(name)
}

// ---------------------------------------------------------------- the page code

// Runs in each page, so it's written in syntax Coherent GT parses: var,
// function expressions, no arrows, no template literals (CLAUDE.md, "Before
// writing code that runs in a panel"). Every test asks the CSSOM what a rule
// kept, since the engine drops what it can't read without an error.
function pageCheck(catalog, part) {
  var ID = "dualinput-p14-host"
  var out = { ua: navigator.userAgent, engine: {}, properties: [], functions: [], values: [], units: [], selectors: [], atRules: [], media: [], layout: [] }
  var doProperties = part !== "rest", doRest = part !== "properties"
  var host = document.createElement("div")
  host.id = ID
  host.setAttribute("style", "position:absolute;left:0;top:0;width:400px;height:400px;visibility:hidden;pointer-events:none;")
  ;(document.body || document.documentElement).appendChild(host)
  var style = document.createElement("style")
  ;(document.head || document.documentElement).appendChild(style)

  function sheetOf(el) {
    if (el.sheet) return el.sheet
    for (var i = 0; i < document.styleSheets.length; i++) if (document.styleSheets[i].ownerNode === el) return document.styleSheets[i]
    return null
  }
  function parse(text) {
    style.textContent = text
    var s = sheetOf(style)
    return s ? s.cssRules : []
  }
  function supports(prop, value) {
    try { return typeof CSS !== "undefined" && CSS.supports ? CSS.supports(prop, value) : null } catch (e) { return null }
  }
  function kept(rule, prop) {
    if (!rule || !rule.style) return ""
    var v = rule.style.getPropertyValue(prop)
    if (v) return v
    return rule.style.length > 0 ? "(longhands)" : ""
  }

  // The engine's own lists: what its computed style and its style object name.
  var computed = getComputedStyle(host)
  var names = []
  for (var c = 0; c < computed.length; c++) names.push(computed[c])
  var styleKeys = []
  for (var key in host.style) {
    if (typeof host.style[key] === "string" && !/^\d+$/.test(key)) styleKeys.push(key.replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase() }).replace(/^webkit-/, "-webkit-"))
  }
  out.engine = { computed: names, styleKeys: styleKeys }

  // Properties: each with `inherit`, then each keyword its syntax names, one
  // rule each, so a dropped declaration leaves its rule empty in place.
  var props = doProperties ? catalog.properties : []
  var text = []
  for (var p = 0; p < props.length; p++) text.push(".i" + p + "{" + props[p].name + ":inherit}")
  var rules = parse(text.join("\n"))
  var webkitTry = []
  for (p = 0; p < props.length; p++) {
    var r = { name: props[p].name, inherit: kept(rules[p], props[p].name), supports: supports(props[p].name, "inherit"), keywords: {} }
    if (!r.inherit && props[p].name.indexOf("-webkit-") !== 0) webkitTry.push(p)
    out.properties.push(r)
  }
  text = []
  for (var w = 0; w < webkitTry.length; w++) text.push(".w" + w + "{-webkit-" + props[webkitTry[w]].name + ":inherit}")
  rules = parse(text.join("\n"))
  for (w = 0; w < webkitTry.length; w++) out.properties[webkitTry[w]].webkit = kept(rules[w], "-webkit-" + props[webkitTry[w]].name)
  text = []
  var index = []
  for (p = 0; p < props.length; p++) {
    for (var k = 0; k < props[p].keywords.length; k++) {
      text.push(".k" + index.length + "{" + props[p].name + ":" + props[p].keywords[k] + "}")
      index.push([p, props[p].keywords[k]])
    }
  }
  rules = parse(text.join("\n"))
  for (var n = 0; n < index.length; n++) out.properties[index[n][0]].keywords[index[n][1]] = kept(rules[n], props[index[n][0]].name)
  if (!doRest) return finish()

  // Functions, value forms, and units, each as one declaration of a rule.
  function declarations(list, read) {
    var t = []
    for (var i = 0; i < list.length; i++) t.push(read(list[i], i))
    return parse(t.join("\n"))
  }
  var fns = catalog.functions
  rules = declarations(fns, function (f, i) { return ".f" + i + (f.pseudo ? "::before" : "") + "{" + f.prop + ":" + f.value + "}" })
  for (var f = 0; f < fns.length; f++) out.functions.push({ name: fns[f].name, prop: fns[f].prop, value: fns[f].value, kept: kept(rules[f], fns[f].prop), supports: fns[f].pseudo ? null : supports(fns[f].prop, fns[f].value) })
  var vals = catalog.values
  rules = declarations(vals, function (v, i) { return ".v" + i + "{" + v[0] + ":" + v[1] + "}" })
  for (var v = 0; v < vals.length; v++) out.values.push({ prop: vals[v][0], value: vals[v][1], kept: kept(rules[v], vals[v][0]) })
  var units = catalog.units
  for (var u = 0; u < units.length; u++) {
    if (units[u][0] === "@media") {
      var mq = window.matchMedia(units[u][1])
      out.units.push({ unit: units[u][2], value: units[u][1], kept: mq.media !== "not all" ? mq.media : "" })
    } else {
      rules = parse(".u{" + units[u][0] + ":" + units[u][1] + "}")
      out.units.push({ unit: units[u][2], value: units[u][1], kept: kept(rules[0], units[u][0]) })
    }
  }

  // Selectors: a list with one part the engine can't read drops the whole
  // rule, so each selector has a rule of its own, found again by its z-index.
  var sels = catalog.selectors
  rules = declarations(sels, function (s, i) { return s.sel + "{z-index:" + (i + 1) + "}" })
  var found = {}
  for (var q = 0; q < rules.length; q++) {
    if (rules[q].style) found[rules[q].style.getPropertyValue("z-index")] = rules[q].selectorText
  }
  for (var s2 = 0; s2 < sels.length; s2++) out.selectors.push({ name: sels[s2].name, sel: sels[s2].sel, kept: found[String(s2 + 1)] || "" })

  // At-rules, each in a sheet of its own.
  var ats = catalog.atRules
  for (var a = 0; a < ats.length; a++) {
    rules = parse(ats[a][1])
    var first = rules[0]
    out.atRules.push({ name: ats[a][0], count: rules.length, type: first ? first.type : null, text: first ? String(first.cssText).slice(0, 160) : "", inner: first && first.cssRules ? first.cssRules.length : null })
  }

  // Media queries: "not all" means the engine didn't read the query.
  for (var m = 0; m < catalog.media.length; m++) {
    try {
      var mm = window.matchMedia(catalog.media[m])
      out.media.push({ query: catalog.media[m], parsed: mm.media, matches: mm.matches })
    } catch (e) { out.media.push({ query: catalog.media[m], error: String(e) }) }
  }

  // Layout, measured against the host.
  for (var l = 0; l < catalog.layout.length; l++) {
    var t2 = catalog.layout[l]
    var res = { group: t2[0], name: t2[1], values: [] }
    try {
      parse(t2[2].split("#H").join("#" + ID))
      host.innerHTML = t2[3]
      var hr = host.getBoundingClientRect()
      for (var g = 0; g < t2[4].length; g++) {
        var el = host.querySelector(t2[4][g][0]), what = t2[4][g][1], value
        if (what === "x" || what === "y" || what === "w" || what === "h") {
          var br = el.getBoundingClientRect()
          value = Math.round((what === "x" ? br.left - hr.left : what === "y" ? br.top - hr.top : what === "w" ? br.width : br.height) * 100) / 100
        } else value = getComputedStyle(el).getPropertyValue(what)
        res.values.push(value)
      }
    } catch (e) { res.error = String(e).slice(0, 160) }
    out.layout.push(res)
  }
  return finish()

  function finish() {
    host.parentNode.removeChild(host)
    style.parentNode.removeChild(style)
    return JSON.stringify(out)
  }
}

// ---------------------------------------------------------------- the runs

const AREA = "architecture"
const NAME = "p14-coherent-css-full"
// Two calls, so no one message through the inspector carries every answer.
const pageSource = (part) => `(${pageCheck.toString()})(${JSON.stringify(CATALOG)}, ${JSON.stringify(part)})`
function merge(a, b) {
  return { ...b, properties: a.properties }
}

if (process.argv.includes("--count")) {
  console.log(catalogCounts(), `untested functions: ${UNTESTED_FUNCTIONS.join(", ") || "none"}`)
  process.exit(0)
}

function save(ext, body, when) {
  const file = resultFile(AREA, NAME + (ext === "baseline" ? "-chromium" : ""), ext === "txt" ? "txt" : "json", when)
  writeFileSync(file, body.endsWith("\n") ? body : body + "\n")
  return file
}

if (process.argv.includes("--baseline")) {
  const page = `<!doctype html><meta charset=utf-8><title>p14 baseline</title><body><p id=status>running</p><script>
    var result = JSON.stringify({ properties: JSON.parse(${pageSource("properties")}).properties, rest: JSON.parse(${pageSource("rest")}) });
    fetch("/result", { method: "POST", body: result }).then(function () { document.getElementById("status").textContent = "saved" })
  </script>`
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/result") {
      let body = ""
      req.on("data", (d) => (body += d))
      req.on("end", () => {
        const both = JSON.parse(body)
        const file = save("baseline", JSON.stringify({ mdn: MDN_VERSION, catalog: catalogCounts(), result: merge(both, both.rest) }))
        console.log(`saved ${repoRelative(file)}`)
        res.end("ok")
        server.close()
      })
      return
    }
    res.setHeader("content-type", "text/html; charset=utf-8")
    res.end(page)
  })
  server.listen(0, "127.0.0.1", () => console.log(`open http://127.0.0.1:${server.address().port}/ in current Chromium`))
} else {
  const baseline = latestBaseline()
  const pages = await listPages()
  const pick = (re) => pages.find((p) => re.test(String(p.title)))
  const docs = [["mainUi", pick(/^mainUi$/)], ["EFB", pick(/^Electronic Flight Bag$/)], ["toolbar", pick(/^Toolbar$/)]]
  const runs = []
  for (const [label, page] of docs) {
    if (!page) { runs.push({ label, missing: true }); continue }
    const insp = new Inspector(page.id)
    try {
      await insp.open()
      const props = JSON.parse(await insp.evaluate(pageSource("properties")))
      runs.push({ label, result: merge(props, JSON.parse(await insp.evaluate(pageSource("rest")))) })
    } catch (e) {
      runs.push({ label, error: e.message })
    } finally {
      insp.close()
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  const when = stamp()
  const json = save("json", JSON.stringify({ mdn: MDN_VERSION, baseline: baseline ? baseline.file : null, catalog: catalogCounts(), runs }), when)
  const text = report(runs, baseline)
  console.log(text)
  console.log(`saved ${repoRelative(save("txt", text, when))} and ${repoRelative(json)}`)
}

function catalogCounts() {
  return {
    properties: PROPERTIES.length,
    keywords: PROPERTIES.reduce((n, p) => n + p.keywords.length, 0),
    functions: CATALOG.functions.length,
    values: VALUE_FORMS.length,
    units: UNITS.length,
    selectors: SELECTORS.length,
    atRules: AT_RULES.length,
    media: MEDIA.length,
    layout: LAYOUT.length,
  }
}

function latestBaseline() {
  const dir = join(REPO, "experiments", "areas", AREA, "results")
  const files = readdirSync(dir).filter((f) => f.startsWith(`${NAME}-chromium-`)).sort()
  if (!files.length) return null
  const file = join(dir, files[files.length - 1])
  return { file: repoRelative(file), ...JSON.parse(readFileSync(file, "utf8")) }
}

// ---------------------------------------------------------------- the report

function report(runs, baseline) {
  const ran = runs.filter((r) => r.result)
  const base = baseline?.result
  const lines = [
    `${NAME}, ${new Date().toISOString()}, mdn-data ${MDN_VERSION}`,
    `Documents: ${runs.map((r) => (r.missing ? `${r.label} (not found)` : r.error ? `${r.label} (failed: ${r.error})` : r.label)).join("; ")}`,
    `Coherent GT: ${[...new Set(ran.map((r) => r.result.ua))].join(" | ")}`,
    `Baseline: ${base ? `${baseline.file}, ${base.ua}` : "none, so every item is reported against no reference"}`,
    `Catalog: ${Object.entries(catalogCounts()).map(([k, v]) => `${v} ${k}`).join(", ")}`,
    "",
    "Each list names what the baseline keeps and Coherent GT drops, in every document unless a document is named.",
    "Items both drop are counted, not listed: a sample no engine reads, or a property only another engine has.",
  ]
  if (baseline && JSON.stringify(baseline.catalog) !== JSON.stringify(catalogCounts())) {
    lines.push("The baseline was taken against another catalog, so its answers don't line up: run --baseline again.")
  }
  if (!ran.length) return lines.join("\n")

  // An item's answer in each document, against the baseline's.
  function verdicts(get, keep) {
    const dropped = [], both = [], docOnly = []
    const items = get(ran[0].result)
    for (let i = 0; i < items.length; i++) {
      const inBase = base ? keep(get(base)[i]) : true
      const each = ran.map((r) => keep(get(r.result)[i]))
      if (each.every(Boolean)) continue
      if (!inBase) { both.push(i); continue }
      if (each.every((x) => !x)) dropped.push(i)
      else docOnly.push([i, ran.filter((r, j) => !each[j]).map((r) => r.label)])
    }
    return { dropped, both, docOnly, total: items.length }
  }
  function section(title, get, keep, label) {
    const v = verdicts(get, keep)
    const items = get(ran[0].result)
    lines.push("", `${title}: ${v.total - v.dropped.length - v.both.length - v.docOnly.length} kept, ${v.dropped.length} dropped by Coherent GT alone, ${v.docOnly.length} dropped in some documents, ${v.both.length} dropped by both`)
    for (const i of v.dropped) lines.push(`  ${label(items[i])}`)
    for (const [i, docs] of v.docOnly) lines.push(`  ${label(items[i])}  (dropped in ${docs.join(", ")})`)
  }

  const props = (r) => r.properties
  section("Properties, set to inherit", props, (p) => !!p.inherit, (p) => `${p.name}${p.webkit ? `  (-webkit-${p.name} kept)` : ""}`)

  // Keywords only of properties both engines know, so a dropped property isn't counted twice.
  const knownBoth = ran[0].result.properties.map((p, i) => !!p.inherit && (!base || !!base.properties[i].inherit))
  const kw = []
  ran[0].result.properties.forEach((p, i) => { if (knownBoth[i]) for (const k of Object.keys(p.keywords)) kw.push([i, k]) })
  section("Keywords of properties both know", (r) => kw.map(([i, k]) => ({ name: r.properties[i].name, k, v: r.properties[i].keywords[k] })), (x) => !!x.v, (x) => `${x.name}: ${x.k}`)

  section("Functions", (r) => r.functions, (f) => !!f.kept, (f) => `${f.name} in ${f.prop}: ${f.value}`)
  if (UNTESTED_FUNCTIONS.length) lines.push(`  untested, with no sample: ${UNTESTED_FUNCTIONS.join(", ")}`)
  section("Value forms", (r) => r.values, (v) => !!v.kept, (v) => `${v.prop}: ${v.value}`)
  section("Units", (r) => r.units, (u) => !!u.kept, (u) => `${u.unit} (${u.value})`)
  const mdnUnitsMissing = MDN_UNITS.filter((u) => !UNITS.some((x) => x[2] === u))
  if (mdnUnitsMissing.length) lines.push(`  untested, with no property to hold them: ${mdnUnitsMissing.join(", ")}`)
  section("Selectors", (r) => r.selectors, (s) => !!s.kept, (s) => `${s.sel}${s.extra ? "  (not in mdn-data)" : ""}`)
  // An engine without nesting keeps `.x { ... }` with nothing inside, so a rule
  // whose block holds a rule counts only when that inner rule is there.
  const HOLDS_A_RULE = new Set(["@container", "@document", "@layer", "@media", "@scope", "@starting-style", "@supports", "@supports not", "@supports selector()", "nesting with &", "nesting without &", "nested @media"])
  section("At-rules", (r) => r.atRules, (a) => a.count > 0 && (!HOLDS_A_RULE.has(a.name) || a.inner > 0), (a) => a.name)
  section("Media queries", (r) => r.media, (m) => m.parsed && m.parsed !== "not all", (m) => m.query)

  // Layout passes when it measures what the baseline measured.
  const same = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.6 : String(a) === String(b))
  lines.push("", "Layout, against the baseline's measurements:")
  let failed = 0
  for (let i = 0; i < LAYOUT.length; i++) {
    const want = base ? base.layout[i].values : null
    const got = ran.map((r) => r.result.layout[i])
    const ok = got.map((g) => !g.error && want && g.values.length === want.length && g.values.every((x, j) => same(x, want[j])))
    if (ok.every(Boolean)) continue
    failed++
    lines.push(`  ✗ ${LAYOUT[i][0]}, ${LAYOUT[i][1]}: baseline ${JSON.stringify(want)}, ${ran.map((r, j) => `${r.label} ${got[j].error ?? JSON.stringify(got[j].values)}`).join("; ")}`)
  }
  lines.push(`  ${LAYOUT.length - failed} of ${LAYOUT.length} measured as the baseline did`)

  lines.push("", "Media queries that parse, and whether each matched:")
  for (const r of ran) lines.push(`  ${r.label}: ${r.result.media.filter((m) => m.parsed && m.parsed !== "not all").map((m) => `${m.query} ${m.matches ? "yes" : "no"}`).join("; ")}`)

  // What the engine names that mdn-data doesn't, such as its -webkit- properties.
  const mdnNames = new Set(Object.keys(properties))
  for (const r of ran) {
    const own = [...new Set([...r.result.engine.computed, ...r.result.engine.styleKeys])].filter((n) => !mdnNames.has(n)).sort()
    lines.push("", `${r.label} names ${r.result.engine.computed.length} computed properties; these ${own.length} aren't in mdn-data: ${own.join(", ")}`)
  }
  return lines.join("\n")
}
