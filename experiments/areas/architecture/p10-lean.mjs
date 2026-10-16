/*
 * p10-lean: how small does a recording get if the core reads less, measured on
 * p10's capture (node 6.6 of record/areas/architecture/plan.md)? Each variant
 * drops the inputs a leaner read would never have taken in, then compresses
 * what's left with zstd at level 3, as p10's own size did.
 *
 * The levers, alone and together:
 *   gate      a traffic object's record only when it differs from the last one
 *             kept for that object by more than FS Copilot's change gate: 0.1m
 *             of position, 0.5ft of altitude, 0.1° of an angle, 0.5kt of ground
 *             speed, 50ft/min of vertical speed, or any switch (FS Copilot fork,
 *             record/traffic-atc/docs/01-design.md, "Rate"); SimConnect can do
 *             this itself, through a request per object with its changed flag
 *             and each value's epsilon
 *   radius N  AI aircraft within N km of the user's aircraft only
 *   1 Hz      each traffic object's record at most once a second
 *   fm N      the flight model at most N times a second
 *   cam N     the camera at most N times a second
 *   header    each input's time as a varint gap from the one before, and its
 *             kind and length as varints, in place of 14 fixed bytes
 *
 * A record's values start at byte 40 (SIMCONNECT_RECV_SIMOBJECT_DATA, read in
 * MSFS 2024 SDK 1.7.3, SimConnect.h); the object ID is at byte 16. Traffic
 * carries 12 doubles from latitude in degrees (recording/capture/src/main.rs,
 * TRAFFIC_FIELDS), and the flight model 21 from latitude in radians (FM_FIELDS).
 *
 *   node experiments/areas/architecture/p10-lean.mjs <capture.bin>
 */

import { readFileSync } from "node:fs"
import { zstdCompressSync, constants } from "node:zlib"

const FM = 1, AIR = 4, GROUND = 5, CAMERA = 7
const DATA_AT = 40

const src = readFileSync(process.argv[2])
const all = []
for (let at = 0; at + 14 <= src.length;) {
  const us = Number(src.readBigUInt64LE(at))
  const kind = src.readUInt16LE(at + 8)
  const len = src.readUInt32LE(at + 10)
  all.push({ us, kind, bytes: src.subarray(at + 14, at + 14 + len) })
  at += 14 + len
}
const hours = (all.at(-1).us - all[0].us) / 3.6e9

const doubles = (b, n) => Array.from({ length: n }, (_, i) => b.readDoubleLE(DATA_AT + 8 * i))
const km = (lat1, lon1, lat2, lon2) => {
  const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(a))
}
const changed = (a, b) => {
  const m = km(a[0], a[1], b[0], b[1]) * 1000
  return m > 0.1 || Math.abs(a[2] - b[2]) > 0.5 || [3, 4, 5].some((i) => Math.abs(a[i] - b[i]) > 0.1) ||
    Math.abs(a[6] - b[6]) > 0.5 || Math.abs(a[7] - b[7]) > 50 || [8, 9, 10, 11].some((i) => a[i] !== b[i])
}

function run({ gate = false, radiusKm = null, trafficHz = null, fmHz = null, camHz = null, header = false }) {
  const kept = []
  let own = null
  const lastKept = new Map()
  const lastAt = new Map()
  for (const input of all) {
    const { us, kind, bytes } = input
    if (kind === FM && bytes.length >= DATA_AT + 16) {
      own = [bytes.readDoubleLE(DATA_AT) * 180 / Math.PI, bytes.readDoubleLE(DATA_AT + 8) * 180 / Math.PI]
    }
    const hz = kind === FM ? fmHz : kind === CAMERA ? camHz : (kind === AIR || kind === GROUND) ? trafficHz : null
    const object = (kind === AIR || kind === GROUND) && bytes.length >= 20 ? bytes.readUInt32LE(16) : 0
    const key = `${kind}:${object}`
    // An answer with no object in range carries no values, and is kept as it is.
    if ((kind === AIR || kind === GROUND) && bytes.length >= DATA_AT + 96) {
      const v = doubles(bytes, 12)
      if (radiusKm && kind === AIR && own && km(own[0], own[1], v[0], v[1]) > radiusKm) continue
      if (gate && lastKept.has(key) && !changed(v, lastKept.get(key))) continue
      if (hz && lastAt.has(key) && us - lastAt.get(key) < 1e6 / hz - 50_000) continue
      lastKept.set(key, v)
    } else if (hz && lastAt.has(key) && us - lastAt.get(key) < 1e6 / hz - 5_000) {
      continue
    }
    lastAt.set(key, us)
    kept.push(input)
  }
  const parts = []
  let prev = 0
  const varint = (n) => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; o.push(b) } while (n); return Buffer.from(o) }
  for (const { us, kind, bytes } of kept) {
    if (header) parts.push(varint(us - prev), varint(kind), varint(bytes.length))
    else { const h = Buffer.alloc(14); h.writeBigUInt64LE(BigInt(us)); h.writeUInt16LE(kind, 8); h.writeUInt32LE(bytes.length, 10); parts.push(h) }
    parts.push(bytes)
    prev = us
  }
  const buf = Buffer.concat(parts)
  const z = zstdCompressSync(buf, { params: { [constants.ZSTD_c_compressionLevel]: 3 } }).length
  const byKind = new Map()
  for (const { kind } of kept) byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
  return { inputs: kept.length, raw: buf.length, z, air: byKind.get(AIR) ?? 0, ground: byKind.get(GROUND) ?? 0, fm: byKind.get(FM) ?? 0, cam: byKind.get(CAMERA) ?? 0 }
}

const variants = [
  ["as captured", {}],
  ["header", { header: true }],
  ["gate", { gate: true }],
  ["1 Hz", { trafficHz: 1 }],
  ["radius 100", { radiusKm: 100 }],
  ["radius 50", { radiusKm: 50 }],
  ["fm 20, cam 10", { fmHz: 20, camHz: 10 }],
  ["gate, header", { gate: true, header: true }],
  ["gate, fm 20, cam 10, header", { gate: true, fmHz: 20, camHz: 10, header: true }],
  ["gate, radius 100, fm 20, cam 10, header", { gate: true, radiusKm: 100, fmHz: 20, camHz: 10, header: true }],
  ["gate, radius 50, fm 20, cam 10, header", { gate: true, radiusKm: 50, fmHz: 20, camHz: 10, header: true }],
  ["gate, 1 Hz, radius 50, fm 20, cam 10, header", { gate: true, trafficHz: 1, radiusKm: 50, fmHz: 20, camHz: 10, header: true }],
]
console.log(`p10-lean on ${process.argv[2]}, ${(hours * 60).toFixed(1)} minutes, node ${process.version}'s zstd at level 3`)
console.log(["variant", "inputs a second", "aircraft a second", "ground a second", "fm a second", "camera a second", "raw MB an hour", "zstd MB an hour"].join("\t"))
for (const [name, opts] of variants) {
  const r = run(opts)
  const s = hours * 3600
  console.log([name, (r.inputs / s).toFixed(1), (r.air / s).toFixed(1), (r.ground / s).toFixed(1), (r.fm / s).toFixed(1), (r.cam / s).toFixed(1), (r.raw / 1e6 / hours).toFixed(1), (r.z / 1e6 / hours).toFixed(1)].join("\t"))
}
