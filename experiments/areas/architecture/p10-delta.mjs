/*
 * p10-delta: how much smaller does p10's capture compress when each record is
 * stored as its difference from the one before it of the same kind and
 * object, rather than as SimConnect handed it over (node 6.6 of
 * record/areas/architecture/plan.md)?
 *
 * The capture is one input after another, each as its time in µs, its kind,
 * its length, and its bytes, all little-endian (recording/common/src/lib.rs).
 * A SimConnect object data record carries its object's ID at byte 16, after
 * the 12-byte SIMCONNECT_RECV header and the request ID (read in MSFS 2024
 * SDK 1.7.3, SimConnect.h, SIMCONNECT_RECV_SIMOBJECT_DATA), so traffic
 * records 500ms apart from one object share most of their bytes.
 *
 * It compares, each with zstd at levels 3 and 19:
 *   raw     the inputs as recorded
 *   delta   each time as its gap from the input before, and each record's
 *           bytes XORed with the last record of the same kind and object ID,
 *           where one of the same length exists; the transform is undone and
 *           checked byte for byte against the raw inputs
 *
 *   node experiments/areas/architecture/p10-delta.mjs <capture.bin>
 */

import { readFileSync } from "node:fs"
import { zstdCompressSync, constants } from "node:zlib"

const file = process.argv[2]
if (!file) { console.error("usage: node p10-delta.mjs <capture.bin>"); process.exit(1) }
const src = readFileSync(file)

// Kinds whose bytes are a SimConnect object data record (recording/common/src/lib.rs).
const OBJECT_KINDS = new Set([1, 2, 4, 5, 6, 7, 8])
const NAMES = { 1: "flight model", 2: "profile entries", 3: "input events", 4: "traffic, aircraft", 5: "traffic, ground", 6: "traffic identities", 7: "camera", 8: "module slot" }

function* inputs(buf) {
  let at = 0
  while (at + 14 <= buf.length) {
    const us = buf.readBigUInt64LE(at)
    const kind = buf.readUInt16LE(at + 8)
    const len = buf.readUInt32LE(at + 10)
    yield { us, kind, bytes: buf.subarray(at + 14, at + 14 + len) }
    at += 14 + len
  }
}

const keyOf = (kind, bytes) => (OBJECT_KINDS.has(kind) && bytes.length >= 20 ? `${kind}:${bytes.readUInt32LE(16)}` : `${kind}`)

const out = []
const last = new Map()
let prevUs = 0n
let xored = 0
const perKind = new Map()
for (const { us, kind, bytes } of inputs(src)) {
  const head = Buffer.alloc(14)
  head.writeBigUInt64LE(us - prevUs, 0)
  head.writeUInt16LE(kind, 8)
  head.writeUInt32LE(bytes.length, 10)
  prevUs = us
  const key = keyOf(kind, bytes)
  const before = last.get(key)
  let body = bytes
  if (before && before.length === bytes.length) {
    body = Buffer.alloc(bytes.length)
    for (let i = 0; i < bytes.length; i++) body[i] = bytes[i] ^ before[i]
    // The object ID stays as it was, so a reader finds the record's key first.
    if (key.includes(":")) bytes.copy(body, 16, 16, 20)
    xored++
  }
  last.set(key, bytes)
  out.push(head, body)
  const k = perKind.get(kind) ?? { raw: [], delta: [] }
  k.raw.push(bytes)
  k.delta.push(body)
  perKind.set(kind, k)
}
const delta = Buffer.concat(out)

// Undo the transform and check it gives back every byte.
{
  const back = []
  const seen = new Map()
  let us = 0n
  let at = 0
  while (at + 14 <= delta.length) {
    us += delta.readBigUInt64LE(at)
    const kind = delta.readUInt16LE(at + 8)
    const len = delta.readUInt32LE(at + 10)
    const body = delta.subarray(at + 14, at + 14 + len)
    const key = keyOf(kind, body)
    const prev = seen.get(key)
    let bytes = Buffer.from(body)
    if (prev && prev.length === len) {
      for (let i = 0; i < len; i++) bytes[i] = body[i] ^ prev[i]
      if (key.includes(":")) body.copy(bytes, 16, 16, 20)
    }
    seen.set(key, bytes)
    const head = Buffer.alloc(14)
    head.writeBigUInt64LE(us, 0)
    head.writeUInt16LE(kind, 8)
    head.writeUInt32LE(len, 10)
    back.push(head, bytes)
    at += 14 + len
  }
  const ok = Buffer.concat(back).equals(src)
  console.log(`ROUNDTRIP\t${ok ? "every byte back" : "MISMATCH"}`)
  if (!ok) process.exit(1)
}

const z = (buf, level) => zstdCompressSync(buf, { params: { [constants.ZSTD_c_compressionLevel]: level } }).length
const mb = (n) => (n / 1e6).toFixed(2)
const hours = Number((prevUs - [...inputs(src)][0].us)) / 3.6e9
console.log(`INPUTS\t${xored.toLocaleString("en-US")} of them XORed with an earlier record`)
for (const level of [3, 19]) {
  const r = z(src, level)
  const d = z(delta, level)
  console.log(`LEVEL ${level}\traw ${mb(r)} MB, ${(r / 1e6 / hours).toFixed(1)} MB an hour\tdelta ${mb(d)} MB, ${(d / 1e6 / hours).toFixed(1)} MB an hour\t${(r / d).toFixed(2)}x smaller`)
}
for (const [kind, k] of [...perKind.entries()].sort((a, b) => a[0] - b[0])) {
  const r = z(Buffer.concat(k.raw), 3)
  const d = z(Buffer.concat(k.delta), 3)
  console.log(`KIND\t${NAMES[kind] ?? kind}\tlevel 3: raw ${mb(r)} MB, delta ${mb(d)} MB\t${(r / Math.max(d, 1)).toFixed(2)}x`)
}
