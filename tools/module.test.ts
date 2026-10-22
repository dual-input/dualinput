// Tests the check tools/check.ts makes on our WASM module's exports, on small modules this
// file writes byte by byte, so the check's own failure is tested without a build.
//
//   node --test tools/module.test.ts

import assert from "node:assert/strict"
import { test } from "node:test"

import { missingExports, REQUIRED_EXPORTS } from "./lib/module.ts"

/** A number as WebAssembly's unsigned LEB128, 7 bits a byte, low bits first. */
function leb(n: number): number[] {
  const bytes: number[] = []
  do {
    const low = n & 0x7f
    n >>>= 7
    bytes.push(n ? low | 0x80 : low)
  } while (n)
  return bytes
}

/** A module with one empty function, which it exports under each of `names`. */
function exporting(names: string[]): Uint8Array {
  const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body]
  const exports = names.flatMap((name) => {
    const bytes = [...Buffer.from(name)]
    return [...leb(bytes.length), ...bytes, 0x00, 0x00] // a function's export, of function 0
  })
  return Uint8Array.from([
    ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00], // "\0asm", version 1
    ...section(1, [1, 0x60, 0, 0]), // one type: no parameters, no results
    ...section(3, [1, 0]), // one function, of that type
    ...section(7, [...leb(names.length), ...exports]),
    ...section(10, [1, 2, 0, 0x0b]), // its body: no locals, then the end
  ])
}

test("a module that exports everything the sim calls passes", () => {
  assert.deepEqual(missingExports(exporting([...REQUIRED_EXPORTS, "rust_eh_personality"])), [])
})

test("a module missing an export the sim calls fails, naming the export", () => {
  const without = REQUIRED_EXPORTS.filter((name) => name !== "mark_decommit_pages")
  assert.deepEqual(missingExports(exporting(without)), ["mark_decommit_pages"])
  assert.deepEqual(missingExports(exporting([])), REQUIRED_EXPORTS)
})
