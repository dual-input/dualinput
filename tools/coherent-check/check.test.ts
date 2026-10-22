import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import * as esbuild from "esbuild"

import { checkCode, checkFile } from "./check.ts"

// p09's samples, each a function body, with what MSFS 2024's Coherent GT did with it on
// 2026-10-09: "+" parsed and ran, "x" didn't parse, "!" parsed and threw when its line ran
// (record/areas/architecture/log.md, "Coherent GT parses all of ES2017 and object rest";
// read in experiments/areas/architecture/p09-coherent-syntax.mjs).
const SAMPLES: [string, "+" | "x" | "!", string][] = [
  ["let and const", "+", "let a = 1; const b = 2; return a + b;"],
  ["arrow functions", "+", "var f = (x) => x * 2; return f(2);"],
  ["classes, getters, statics", "+", "class A { constructor(x) { this.x = x; } get y() { return this.x + 1; } static s() { return 5; } } return new A(1).y + A.s();"],
  ["extends and super", "+", "class A { f() { return 1; } } class B extends A { f() { return super.f() + 1; } } return new B().f();"],
  ["extending Error", "+", "class E extends Error {} return new E('m') instanceof E;"],
  ["template literals", "+", "var x = 2; return `a${x}b`;"],
  ["tagged templates", "+", "function t(s, v) { return s.raw[0] + v + s[1]; } return t`a\\n${1}b`;"],
  ["destructuring with defaults", "+", "var {a, b: [c, d = 4]} = {a: 1, b: [3]}; return a + c + d;"],
  ["default parameters", "+", "function f(a, b = 2) { return a + b; } return f(1);"],
  ["rest parameters", "+", "function f(...r) { return r.length; } return f(1, 2, 3);"],
  ["spread in calls and arrays", "+", "return Math.max(...[1, 5, 3]) + [...'ab'].length;"],
  ["computed keys, shorthand, methods", "+", "var k = 'x', v = 1; var o = {[k + 'y']: 2, v, m() { return 3; }}; return o.xy + o.v + o.m();"],
  ["for-of", "+", "var s = 0; for (const x of [1, 2, 3]) s += x; return s;"],
  ["generators", "+", "function* g() { yield 1; yield 2; } var s = 0; for (const x of g()) s += x; return s;"],
  ["new.target", "+", "var r; function F() { r = new.target === F; } new F(); return r;"],
  ["super in object methods", "+", "var p = {f() { return 1; }}; var o = {__proto__: p, f() { return super.f() + 1; }}; return o.f();"],
  ["binary and octal literals", "+", "return 0b101 + 0o7;"],
  ["regex u and y flags", "+", String.raw`return /\u{61}/u.test('a') && /a/y.sticky;`],
  ["exponent operator", "+", "return 2 ** 10;"],
  ["async functions", "+", "async function f() { return await 1; } return typeof f;"],
  ["async arrows and methods", "+", "var f = async (x) => await x; class A { async m() { return 1; } } return typeof f + typeof new A().m;"],
  ["trailing commas in calls", "+", "function f(a, b,) { return a + b; } return f(1, 2,);"],
  ["object rest", "+", "var {a, ...r} = {a: 1, b: 2, c: 3}; return Object.keys(r).join();"],
  ["object spread", "x", "var o = {...{a: 1}, b: 2}; return o.a + o.b;"],
  ["for await", "x", "async function f() { for await (const x of []) {} } return typeof f;"],
  ["async generators", "x", "async function* g() { yield 1; } return typeof g;"],
  ["regex named groups", "x", String.raw`return /(?<y>\d{4})/.exec('in 2026').groups.y;`],
  ["regex lookbehind", "x", String.raw`return /(?<=\$)\d+/.exec('cost $42')[0];`],
  ["regex s flag", "!", String.raw`return /a.b/s.test('a\nb');`],
  ["regex unicode properties", "x", String.raw`return /\p{L}/u.test('a');`],
  ["template literal revision", "+", String.raw`function t(s) { return s[0] === undefined; } return t` + "`" + String.raw`\unicode` + "`;"],
  ["optional catch binding", "x", "try { throw 1; } catch { return 'caught'; }"],
  ["U+2028 in a string literal", "x", "return '" + String.fromCharCode(0x2028) + "'.length;"],
  ["optional chaining", "x", "var o = null; return o?.x === undefined;"],
  ["nullish coalescing", "x", "return null ?? 5;"],
  ["BigInt literals", "x", "return typeof 10n;"],
  ["logical assignment", "x", "var a = null; a ??= 1; var b = 0; b ||= 2; var c = 1; c &&= 3; return a + b + c;"],
  ["numeric separators", "x", "return 1_000;"],
  ["class fields", "x", "class A { x = 1; static y = 2; } return new A().x + A.y;"],
  ["#private fields", "x", "class A { #x = 1; g() { return this.#x; } } return new A().g();"],
  ["#private methods", "x", "class A { #m() { return 2; } g() { return this.#m(); } } return new A().g();"],
  ["static blocks", "x", "class A { static { A.z = 3; } } return A.z;"],
  ["#x in obj", "x", "class A { #x; static has(o) { return #x in o; } } return A.has(new A());"],
  ["regex d flag", "!", "return /a/d.exec('a').indices[0][0];"],
]

// The check parses at ES2017, so it also refuses two samples the engine ran, both from
// ES2018. esbuild lowers object rest, and our code uses no invalid escape in a tagged template.
const REFUSED_THOUGH_THE_ENGINE_RAN = new Set(["object rest", "template literal revision"])

const asFile = (body: string) => `(function () {\n${body}\n})();\n`

test("the check fails every p09 sample the engine fails, and passes every one from ES2015 to ES2017", () => {
  for (const [name, engine, body] of SAMPLES) {
    const failed = checkCode(asFile(body)).length > 0
    const expected = engine !== "+" || REFUSED_THOUGH_THE_ENGINE_RAN.has(name)
    assert.equal(failed, expected, `${name}: the engine gave ${engine}, and the check ${failed ? "failed" : "passed"} it`)
  }
})

test("a syntax error names its line and says none of the file runs", () => {
  const [f, ...rest] = checkCode("var a = 1;\nvar b = a?.c;\n")
  assert.equal(rest.length, 0)
  assert.equal(f!.line, 2)
  assert.match(f!.message, /doesn't parse as ES2017, so none of the file runs/)
})

const messages = (code: string) => checkCode(code).map((f) => f.message)

test("a missing built-in or web API fails wherever the code names the global", () => {
  assert.deepEqual(messages("new ResizeObserver(function () {});"), ["ResizeObserver is missing in Coherent GT"])
  assert.deepEqual(messages("window.queueMicrotask(function () {});"), ["queueMicrotask is missing in Coherent GT"])
  assert.deepEqual(messages("var o = Object.fromEntries([]);"), ["Object.fromEntries is missing in Coherent GT"])
  assert.deepEqual(messages("var s = window.crypto.subtle;"), ["crypto.subtle is missing in Coherent GT"])
  assert.deepEqual(messages("var e = new Error('m', { cause: 1 });"), ["an Error's cause is missing in Coherent GT"])
})

test("a prototype method fails by its name, since a bundle carries no types", () => {
  assert.deepEqual(messages("var a = [[1]].flat();"), [".flat is Array.prototype.flat, missing in Coherent GT"])
  assert.deepEqual(messages("var a = [1].at(-1);"), [".at is Array.prototype.at or String.prototype.at, missing in Coherent GT"])
  assert.deepEqual(messages("p.finally(function () {});"), [
    ".finally is Promise.prototype.finally, filled in by the sim's scripts only in mainUi, the EFB, and the toolbar",
  ])
})

test("a local of a banned name, a guard, the file's own class, and the file's own fill-in pass", () => {
  assert.deepEqual(messages("function f(Intl) { return Intl.x; }"), [])
  assert.deepEqual(messages("var r = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(f) : null;"), [])
  assert.deepEqual(messages("if (Object.hasOwn) { Object.hasOwn(o, 'k'); }"), [])
  assert.deepEqual(messages("var ok = 'flat' in a && a.flat();"), [])
  assert.deepEqual(messages("var ArrayUtils = class { static flatMap(a, f) { return a; } }; ArrayUtils.flatMap([], g);"), [])
  assert.deepEqual(messages("Array.prototype.flat = function () { return this; }; var a = [].flat();"), [])
})

test("a RegExp built from strings fails on what ES2017's regexes lack, as esbuild writes them", () => {
  assert.deepEqual(messages('var r = new RegExp("(?<y>\\\\d{4})");').length, 1)
  assert.deepEqual(messages('var r = RegExp("a.b", "s");').length, 1)
  assert.deepEqual(messages('var r = new RegExp("a+", "gi");'), [])
  assert.deepEqual(messages('function f(RegExp) { return new RegExp("(?<y>a)"); }'), [])
})

test("a failure in a bundle names our TypeScript's line through esbuild's map", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coherent-check-"))
  try {
    const source = path.join(dir, "page.ts")
    fs.writeFileSync(source, "const list: number[][] = [[1], [2]]\nexport const flat = list.flat()\n")
    const out = path.join(dir, "page.js")
    esbuild.buildSync({ entryPoints: [source], bundle: true, format: "iife", target: "es2017", sourcemap: "external", outfile: out, logLevel: "silent" })
    const [f, ...rest] = checkFile(out)
    assert.equal(rest.length, 0)
    assert.equal(f!.source?.line, 2)
    assert.equal(f!.source?.text, "export const flat = list.flat()")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
