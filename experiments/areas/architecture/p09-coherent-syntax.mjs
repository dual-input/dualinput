/*
 * p09: which syntax from ES2015 to ES2022 does Coherent GT parse, which
 * built-ins and web APIs does it have, and does TypeScript compiled to es2017
 * run in it (architecture plan, node 1.6.2)?
 *
 *   node experiments/areas/architecture/p09-coherent-syntax.mjs
 *
 * With the sim in a flight, through the inspector, needing nothing from the
 * pilot. In mainUi, the EFB's document, the toolbar's, one cockpit panel, and
 * our banner panel, which it opens through the toolbar's document and closes
 * again, it:
 *
 *   1. parses each syntax feature on its own, with new Function, so one that
 *      fails hides no other, and runs those it can, checking the value;
 *   2. checks each built-in and web API for presence, and whether
 *      Function.prototype.toString shows it as native code or as a script's
 *      fill-in;
 *   3. in the EFB's document and the cockpit panel, runs coherent/shared.ts,
 *      compiled three ways: tsc at es2017, esbuild at es2017, and esbuild at
 *      safari11, FlyByWire's target (record/areas/architecture/log.md,
 *      "2026-10-09: Coherent GT's makers last placed its engine near Safari
 *      10.1, ...").
 *
 * Install the compilers once with `npm ci` in types/. What it adds to a page
 * is a window global it deletes, and nothing touches the pilot's input.
 */

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { Inspector, listPages } from "../../tools/inspector.mjs"
import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const HERE = path.join(REPO, "experiments", "areas", "architecture")
const TYPES = path.join(HERE, "types")
const COHERENT = path.join(HERE, "coherent")
const BUILD = path.join(COHERENT, "build")
const PANEL_ID = "PANEL_CROSSCHECK_P05"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- what to test

// [id, edition, source, the value it returns as a string, or null to parse only]
const SYNTAX = [
  ["let and const", 2015, "let a = 1; const b = 2; return a + b;", "3"],
  ["arrow functions", 2015, "var f = (x) => x * 2; return f(2);", "4"],
  ["classes, getters, statics", 2015, "class A { constructor(x) { this.x = x; } get y() { return this.x + 1; } static s() { return 5; } } return new A(1).y + A.s();", "7"],
  ["extends and super", 2015, "class A { f() { return 1; } } class B extends A { f() { return super.f() + 1; } } return new B().f();", "2"],
  ["extending Error", 2015, "class E extends Error {} return new E('m') instanceof E;", "true"],
  ["template literals", 2015, "var x = 2; return `a${x}b`;", "a2b"],
  ["tagged templates", 2015, "function t(s, v) { return s.raw[0] + v + s[1]; } return t`a\\n${1}b`;", "a\\n1b"],
  ["destructuring with defaults", 2015, "var {a, b: [c, d = 4]} = {a: 1, b: [3]}; return a + c + d;", "8"],
  ["default parameters", 2015, "function f(a, b = 2) { return a + b; } return f(1);", "3"],
  ["rest parameters", 2015, "function f(...r) { return r.length; } return f(1, 2, 3);", "3"],
  ["spread in calls and arrays", 2015, "return Math.max(...[1, 5, 3]) + [...'ab'].length;", "7"],
  ["computed keys, shorthand, methods", 2015, "var k = 'x', v = 1; var o = {[k + 'y']: 2, v, m() { return 3; }}; return o.xy + o.v + o.m();", "6"],
  ["for-of", 2015, "var s = 0; for (const x of [1, 2, 3]) s += x; return s;", "6"],
  ["generators", 2015, "function* g() { yield 1; yield 2; } var s = 0; for (const x of g()) s += x; return s;", "3"],
  ["new.target", 2015, "var r; function F() { r = new.target === F; } new F(); return r;", "true"],
  ["super in object methods", 2015, "var p = {f() { return 1; }}; var o = {__proto__: p, f() { return super.f() + 1; }}; return o.f();", "2"],
  ["binary and octal literals", 2015, "return 0b101 + 0o7;", "12"],
  ["regex u and y flags", 2015, String.raw`return /\u{61}/u.test('a') && /a/y.sticky;`, "true"],
  ["exponent operator", 2016, "return 2 ** 10;", "1024"],
  ["async functions", 2017, "async function f() { return await 1; } return typeof f;", "function"],
  ["async arrows and methods", 2017, "var f = async (x) => await x; class A { async m() { return 1; } } return typeof f + typeof new A().m;", "functionfunction"],
  ["trailing commas in calls", 2017, "function f(a, b,) { return a + b; } return f(1, 2,);", "3"],
  ["object rest", 2018, "var {a, ...r} = {a: 1, b: 2, c: 3}; return Object.keys(r).join();", "b,c"],
  ["object spread", 2018, "var o = {...{a: 1}, b: 2}; return o.a + o.b;", "3"],
  ["for await", 2018, "async function f() { for await (const x of []) {} } return typeof f;", "function"],
  ["async generators", 2018, "async function* g() { yield 1; } return typeof g;", "function"],
  ["regex named groups", 2018, String.raw`return /(?<y>\d{4})/.exec('in 2026').groups.y;`, "2026"],
  ["regex lookbehind", 2018, String.raw`return /(?<=\$)\d+/.exec('cost $42')[0];`, "42"],
  ["regex s flag", 2018, String.raw`return /a.b/s.test('a\nb');`, "true"],
  ["regex unicode properties", 2018, String.raw`return /\p{L}/u.test('a');`, "true"],
  ["template literal revision", 2018, String.raw`function t(s) { return s[0] === undefined; } return t` + "`" + String.raw`\unicode` + "`;", "true"],
  ["optional catch binding", 2019, "try { throw 1; } catch { return 'caught'; }", "caught"],
  ["U+2028 in a string literal", 2019, "return '" + String.fromCharCode(0x2028) + "'.length;", "1"],
  ["optional chaining", 2020, "var o = null; return o?.x === undefined;", "true"],
  ["nullish coalescing", 2020, "return null ?? 5;", "5"],
  ["BigInt literals", 2020, "return typeof 10n;", "bigint"],
  ["dynamic import", 2020, "return typeof function () { return import('x'); };", null],
  ["logical assignment", 2021, "var a = null; a ??= 1; var b = 0; b ||= 2; var c = 1; c &&= 3; return a + b + c;", "6"],
  ["numeric separators", 2021, "return 1_000;", "1000"],
  ["class fields", 2022, "class A { x = 1; static y = 2; } return new A().x + A.y;", "3"],
  ["#private fields", 2022, "class A { #x = 1; g() { return this.#x; } } return new A().g();", "1"],
  ["#private methods", 2022, "class A { #m() { return 2; } g() { return this.#m(); } } return new A().g();", "2"],
  ["static blocks", 2022, "class A { static { A.z = 3; } } return A.z;", "3"],
  ["#x in obj", 2022, "class A { #x; static has(o) { return #x in o; } } return A.has(new A());", "true"],
  ["regex d flag", 2022, "return /a/d.exec('a').indices[0][0];", "0"],
]

// [path, edition]; a path ending in a property of a prototype is checked there.
const BUILTINS = [
  ["Promise", 2015], ["Map", 2015], ["Set", 2015], ["WeakMap", 2015], ["WeakSet", 2015], ["Symbol", 2015], ["Proxy", 2015], ["Reflect", 2015],
  ["Array.from", 2015], ["Array.prototype.find", 2015], ["Object.assign", 2015], ["String.prototype.startsWith", 2015], ["Number.isInteger", 2015], ["Math.trunc", 2015], ["Uint8Array", 2015],
  ["Array.prototype.includes", 2016],
  ["Object.values", 2017], ["Object.entries", 2017], ["Object.getOwnPropertyDescriptors", 2017], ["String.prototype.padStart", 2017], ["SharedArrayBuffer", 2017], ["Atomics", 2017],
  ["Promise.prototype.finally", 2018],
  ["Array.prototype.flat", 2019], ["Array.prototype.flatMap", 2019], ["Object.fromEntries", 2019], ["String.prototype.trimStart", 2019], ["Symbol.prototype.description", 2019],
  ["BigInt", 2020], ["globalThis", 2020], ["Promise.allSettled", 2020], ["String.prototype.matchAll", 2020],
  ["String.prototype.replaceAll", 2021], ["Promise.any", 2021], ["AggregateError", 2021], ["WeakRef", 2021], ["FinalizationRegistry", 2021],
  ["Array.prototype.at", 2022], ["Object.hasOwn", 2022], ["String.prototype.at", 2022],
  ["Array.prototype.findLast", 2023], ["Array.prototype.toSorted", 2023],
  ["Intl", null], ["Intl.DateTimeFormat", null], ["Intl.NumberFormat", null],
]

const WEB = [
  "ResizeObserver", "IntersectionObserver", "MutationObserver", "PointerEvent", "TouchEvent", "AbortController", "EventTarget", "CustomEvent",
  "queueMicrotask", "structuredClone", "requestAnimationFrame", "requestIdleCallback", "performance.now", "TextEncoder", "TextDecoder",
  "URL", "URLSearchParams", "fetch", "XMLHttpRequest", "WebSocket", "Blob", "FileReader", "DOMParser",
  "crypto.getRandomValues", "crypto.subtle", "customElements", "Element.prototype.attachShadow", "CSS.supports", "matchMedia",
  "Worker", "BroadcastChannel", "localStorage", "indexedDB",
]

// Runs in each page, so it's written in the syntax every one of them parses:
// var, function expressions, no arrows (CLAUDE.md, Before writing code that runs
// in a panel). JSON.stringify leaves U+2028 raw, which an engine before ES2019
// refuses in a string literal, and that would fail this whole script; escaped,
// it reaches new Function as the character the test needs.
const SYNTAX_JSON = JSON.stringify(SYNTAX).split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029")
const CHECK = `(function () {
  var syntax = ${SYNTAX_JSON}, builtins = ${JSON.stringify(BUILTINS)}, web = ${JSON.stringify(WEB)};
  var out = { ua: navigator.userAgent, syntax: {}, builtins: {}, web: {}, extra: {} };
  function resolve(p) {
    var parts = p.split("."), o = window, owner = null, key = null;
    for (var i = 0; i < parts.length; i++) {
      if (o === undefined || o === null) return { present: false };
      owner = o; key = parts[i];
      var d = null;
      try { d = Object.getOwnPropertyDescriptor(owner, key); } catch (e) {}
      if (d && d.get && !("value" in d)) { o = d.get; if (i === parts.length - 1) return { present: true, fn: d.get }; try { o = owner[key]; } catch (e) { return { present: true, fn: d.get }; } }
      else { try { o = owner[key]; } catch (e) { return { present: false, error: String(e) }; } }
    }
    return { present: o !== undefined, fn: o };
  }
  function native(fn) {
    if (typeof fn !== "function") return typeof fn === "object" && fn !== null ? "object" : null;
    try { return /\\[native code\\]/.test(Function.prototype.toString.call(fn)) ? "native" : "script"; } catch (e) { return "unreadable"; }
  }
  for (var i = 0; i < syntax.length; i++) {
    var t = syntax[i], r = { es: t[1] };
    try {
      var f = new Function(t[2]);
      r.parses = true;
      if (t[3] !== null) {
        try { var v = f(); r.value = String(v); r.ok = String(v) === t[3]; } catch (e) { r.runError = String(e).slice(0, 120); r.ok = false; }
      }
    } catch (e) { r.parses = false; r.error = String(e).slice(0, 120); }
    out.syntax[t[0]] = r;
  }
  for (var j = 0; j < builtins.length; j++) {
    var b = resolve(builtins[j][0]);
    out.builtins[builtins[j][0]] = { es: builtins[j][1], present: b.present, kind: b.present ? native(b.fn) : null };
  }
  for (var k = 0; k < web.length; k++) {
    var w = resolve(web[k]);
    out.web[web[k]] = { present: w.present, kind: w.present ? native(w.fn) : null };
  }
  try { out.extra.errorCause = new Error("a", { cause: 1 }).cause === 1; } catch (e) { out.extra.errorCause = String(e); }
  try { out.extra.sortStable = [5, 1, 4, 2, 3].map(function (x, i) { return { k: x % 2, i: i }; }).sort(function (a, b) { return a.k - b.k; }).map(function (o) { return o.i; }).join(""); } catch (e) { out.extra.sortStable = String(e); }
  return JSON.stringify(out);
})()`

// ---------------------------------------------------------------- compile

fs.rmSync(BUILD, { recursive: true, force: true })
fs.mkdirSync(BUILD, { recursive: true })
const TSC = path.join(TYPES, "node_modules", "typescript", "bin", "tsc")
const tsc = spawnSync(process.execPath, [TSC, path.join(COHERENT, "shared.ts"), "--target", "es2017", "--lib", "es2017,dom", "--outDir", path.join(BUILD, "tsc"), "--skipLibCheck"], { encoding: "utf8" })
const tscVersion = spawnSync(process.execPath, [TSC, "--version"], { encoding: "utf8" }).stdout.trim()
const esbuildModule = await import(new URL(`file:///${path.join(TYPES, "node_modules", "esbuild", "lib", "main.js").replace(/\\/g, "/")}`).href)
const esbuild = esbuildModule.default ?? esbuildModule
const variants = [["tsc es2017", path.join(BUILD, "tsc", "shared.js"), null]]
for (const target of ["es2017", "safari11"]) {
  const out = path.join(BUILD, `esbuild-${target}`, "shared.js")
  let refused = null
  try {
    await esbuild.build({ entryPoints: [path.join(COHERENT, "shared.ts")], bundle: true, format: "iife", target, outfile: out, logLevel: "silent" })
  } catch (e) {
    refused = (e.errors ?? []).map((x) => x.text).join("; ") || e.message
  }
  variants.push([`esbuild ${target}`, out, refused])
}
const compiled = variants.map(([name, file, refused]) => ({ name, file, refused, code: !refused && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null }))

// ---------------------------------------------------------------- run

async function inPage(page, expression) {
  const insp = new Inspector(page.id)
  try {
    await insp.open()
    return { ok: true, value: await insp.evaluate(expression) }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    insp.close()
  }
}

const pages = await listPages()
const pick = (re, field = "title") => pages.find((p) => re.test(String(p[field])))
const docs = [
  ["mainUi", pick(/^mainUi$/)],
  ["EFB", pick(/^Electronic Flight Bag$/)],
  ["toolbar", pick(/^Toolbar$/)],
  ["cockpit panel", pick(/^VCockpit\d+ - (GNS_DISABLED|KLN90B|AS5)/) ?? pick(/^VCockpit/)],
]
// Our banner has a page only while it's open, so the toolbar opens it first.
const toolbar = docs[2][1]
let opened = false
if (toolbar) {
  const r = await inPage(toolbar, `(function () { Coherent.call("TOOLBAR_BUTTON_TOGGLE", "${PANEL_ID}", true); return "asked"; })()`)
  if (r.ok) {
    for (let i = 0; i < 10 && !opened; i++) {
      await sleep(500)
      const banner = (await listPages()).find((p) => /CrosscheckP05/i.test(String(p.url)))
      if (banner) { docs.push(["banner panel", banner]); opened = true }
    }
  }
}

// One inspector connection for each page, for all its steps: opening a second
// right after closing the first failed with "inspector connection failed" in
// this probe's first run.
async function eachStep(page, fn) {
  const insp = new Inspector(page.id)
  const ev = async (expression) => {
    try { return { ok: true, value: await insp.evaluate(expression) } } catch (e) { return { ok: false, error: e.message } }
  }
  try {
    await insp.open()
    return await fn(ev)
  } catch (e) {
    return { error: e.message }
  } finally {
    insp.close()
    await sleep(500)
  }
}

const results = []
for (const [label, page] of docs) {
  if (!page) { results.push({ label, missing: true }); continue }
  const entry = await eachStep(page, async (ev) => {
    const r = await ev(CHECK)
    const e = { label, title: page.title, check: r.ok ? JSON.parse(r.value) : { error: r.error }, runs: [] }
    if (label !== "EFB" && label !== "cockpit panel") return e
    for (const c of compiled) {
      if (!c.code) { e.runs.push({ name: c.name, error: c.refused ? "the compiler refused it" : "not compiled" }); continue }
      // Inside a function, so tsc's top-level class doesn't collide with itself
      // when the probe runs again in the same page.
      const load = await ev(`(function () {\n${c.code}\n})();\n'loaded'`)
      if (!load.ok) { e.runs.push({ name: c.name, error: load.error }); continue }
      const test = await ev(`(function () { var s = window.CROSSCHECK_P09_SHARED; if (!s) return "no global"; var r = s.selfTest(); s.settle(20).then(function (n) { window.CROSSCHECK_P09_ASYNC = n; }, function (err) { window.CROSSCHECK_P09_ASYNC = "rejected " + err; }); return JSON.stringify(r); })()`)
      await sleep(300)
      const settled = await ev(`(function () { var v = window.CROSSCHECK_P09_ASYNC; window.CROSSCHECK_P09_ASYNC = undefined; window.CROSSCHECK_P09_SHARED = undefined; return String(v); })()`)
      e.runs.push({ name: c.name, tests: test.ok ? (test.value === "no global" ? test.value : JSON.parse(test.value)) : test.error, settled: settled.ok ? settled.value : settled.error })
    }
    return e
  })
  results.push(entry.label ? entry : { label, title: page.title, check: { error: entry.error }, runs: [] })
}
if (opened) await inPage(toolbar, `(function () { Coherent.call("TOOLBAR_BUTTON_TOGGLE", "${PANEL_ID}", false); return "closed"; })()`)

// ---------------------------------------------------------------- report

const ran = results.filter((r) => r.check && !r.check.error)
const lines = [
  `p09-coherent-syntax, ${new Date().toISOString()}`,
  `Documents: ${results.map((r) => (r.missing ? `${r.label} (not found)` : `${r.label} (${r.title}${r.check?.error ? `, failed: ${r.check.error}` : ""})`)).join("; ")}`,
  `User agents: ${[...new Set(ran.map((r) => r.check.ua))].join(" | ")}`,
  `Compilers: ${tscVersion}${tsc.status !== 0 ? ` (exit ${tsc.status}: ${(tsc.stdout + tsc.stderr).trim().split(/\r?\n/).slice(0, 4).join(" / ")})` : ""}, esbuild ${esbuild.version}`,
  "",
  "Syntax, parsed with new Function, and run where a value is given (✓ parses and returns it, ✗ doesn't parse, ! parses but returns something else or throws):",
]
const mark = (s) => (!s ? "?" : !s.parses ? "✗" : s.ok === false ? "!" : "✓")
lines.push(`  ${"".padEnd(36)} ${ran.map((r) => r.label.padEnd(14)).join("")}`)
for (const [id, es] of SYNTAX) {
  const cells = ran.map((r) => mark(r.check.syntax[id]).padEnd(14)).join("")
  lines.push(`  ${`${es} ${id}`.padEnd(36)} ${cells}`)
}
// The same failure in every document is one line.
const odd = []
for (const [id] of SYNTAX) {
  const msgs = ran.map((r) => r.check.syntax[id]).map((s) => (!s ? "not run" : !s.parses ? s.error : s.ok === false ? (s.runError ?? `returned ${s.value}`) : null))
  const failing = [...new Set(msgs.filter((m) => m !== null))]
  if (!failing.length) continue
  if (failing.length === 1 && msgs.every((m) => m === failing[0])) odd.push(`  ${id}: ${failing[0]} (every document)`)
  else ran.forEach((r, i) => { if (msgs[i]) odd.push(`  ${r.label}, ${id}: ${msgs[i]}`) })
}
lines.push("", "Failures and wrong values:", ...(odd.length ? odd : ["  none"]))
lines.push("", "Built-ins (native, script = filled in by a script, - = missing):")
lines.push(`  ${"".padEnd(36)} ${ran.map((r) => r.label.padEnd(14)).join("")}`)
const cell = (b) => (!b ? "?" : !b.present ? "-" : b.kind ?? "present")
for (const [p, es] of BUILTINS) lines.push(`  ${`${es ?? "    "} ${p}`.padEnd(36)} ${ran.map((r) => cell(r.check.builtins[p]).padEnd(14)).join("")}`)
lines.push("", "Web APIs:")
for (const p of WEB) lines.push(`  ${p.padEnd(36)} ${ran.map((r) => cell(r.check.web[p]).padEnd(14)).join("")}`)
lines.push("", `Error cause: ${ran.map((r) => `${r.label} ${r.check.extra.errorCause}`).join("; ")}`)
lines.push(`Stable sort (a stable sort gives 23014): ${ran.map((r) => `${r.label} ${r.check.extra.sortStable}`).join("; ")}`)
lines.push("", "shared.ts compiled and run:")
for (const c of compiled) lines.push(`  ${c.name}: ${c.code ? `${c.code.length} bytes` : c.refused ? `the compiler refused: ${c.refused}` : "not compiled"}`)
for (const r of results.filter((x) => x.runs?.length)) {
  for (const run of r.runs) {
    if (run.error) { lines.push(`  ${r.label}, ${run.name}: ${run.error}`); continue }
    const tests = Array.isArray(run.tests) ? run.tests : []
    lines.push(`  ${r.label}, ${run.name}: ${tests.length ? `${tests.filter((t) => t.ok).length} of ${tests.length} checks passed` : run.tests}; async settle returned ${run.settled}`)
    for (const t of tests.filter((x) => !x.ok)) lines.push(`    ✗ ${t.name}: got ${t.got}`)
  }
}
const text = lines.join("\n")
console.log(text)
console.log(`saved ${repoRelative(saveResult("architecture", "p09-coherent-syntax", text))}`)
