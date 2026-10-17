/*
 * p01: what the ground objects in p10's capture at EGLL were.
 *
 * p10 polled the sim's ground objects within 5km every 500ms, and read each new
 * object's TITLE, ATC ID, and LIVERY NAME once (experiments/areas/architecture/
 * recording/capture/src/main.rs). This reads that capture, with no sim, and
 * groups the ground objects by their title's prefix, with how many came within
 * 100m and 1km of the pilot's aircraft and how many moved more than 5m.
 *
 * Run: node experiments/areas/traffic-atc/p01-ground-objects.mjs [capture.bin.zst]
 * Output: experiments/areas/traffic-atc/results/p01-ground-objects-<time>.txt
 *
 * Needs Node 22.15 or later, for zlib's zstd.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import zlib from "node:zlib"
import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const CAPTURE = process.argv[2] ?? join(REPO, "experiments", "areas", "architecture", "results", "p10-capture-2026-10-16-13-52-24.bin.zst")

// The capture's kinds of input (experiments/areas/architecture/recording/common/src/lib.rs).
const FM = 1, TRAFFIC_AIR = 4, TRAFFIC_GROUND = 5, IDENT = 6
// Each input is its time in µs, its kind, its length, then a SimConnect record.
const HEADER = 14
// SIMCONNECT_RECV_SIMOBJECT_DATA: dwObjectID at 16, untagged data from 40.
const OBJECT_ID = 16, DATA = 40
// The traffic definition's fields, each a FLOAT64: latitude and longitude in degrees come first.
const TRAFFIC_FIELDS = 12
const NEAR_M = [100, 1000]
const MOVED_M = 5

const EARTH_M = 6371000
function metres(a, b) {
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.sqrt(h))
}

function text(bytes, offset, length) {
  const s = bytes.subarray(offset, offset + length)
  const end = s.indexOf(0)
  return s.subarray(0, end < 0 ? length : end).toString("latin1")
}

const plural = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`

const buf = zlib.zstdDecompressSync(readFileSync(CAPTURE))
let aircraft = null                 // the pilot's aircraft, from the flight model's newest read
const titles = new Map()            // object ID -> title
const ground = new Map()            // object ID -> { first, nearest, moved }
const airborne = new Set()          // AI aircraft object IDs

for (let at = 0; at + HEADER <= buf.length;) {
  const kind = buf.readUInt16LE(at + 8)
  const length = buf.readUInt32LE(at + 10)
  const rec = buf.subarray(at + HEADER, at + HEADER + length)
  at += HEADER + length

  if (kind === FM && length >= DATA + 16) {
    // The flight model's definition reads latitude and longitude in radians.
    aircraft = { lat: rec.readDoubleLE(DATA) * 180 / Math.PI, lon: rec.readDoubleLE(DATA + 8) * 180 / Math.PI }
  } else if ((kind === TRAFFIC_AIR || kind === TRAFFIC_GROUND) && length >= DATA + 8 * TRAFFIC_FIELDS) {
    // A poll that found nothing still answers, with no data.
    const id = rec.readUInt32LE(OBJECT_ID)
    if (kind === TRAFFIC_AIR) { airborne.add(id); continue }
    const here = { lat: rec.readDoubleLE(DATA), lon: rec.readDoubleLE(DATA + 8) }
    const from = aircraft ? metres(aircraft, here) : Infinity
    const seen = ground.get(id)
    if (!seen) ground.set(id, { first: here, nearest: from, moved: 0 })
    else { seen.nearest = Math.min(seen.nearest, from); seen.moved = Math.max(seen.moved, metres(seen.first, here)) }
  } else if (kind === IDENT && length >= DATA + 256) {
    titles.set(rec.readUInt32LE(OBJECT_ID), text(rec, DATA, 256))
  }
}

const prefixOf = (title) => title.match(/^[A-Za-z0-9]+_/)?.[0] ?? (title.split(" ")[0] || "(no title)")
const groups = new Map()
for (const [id, g] of ground) {
  const title = titles.get(id) ?? "(no title)"
  const group = groups.get(prefixOf(title)) ?? { count: 0, near: NEAR_M.map(() => 0), moved: 0, titles: new Map() }
  group.count++
  NEAR_M.forEach((m, i) => { if (g.nearest <= m) group.near[i]++ })
  if (g.moved > MOVED_M) group.moved++
  group.titles.set(title, (group.titles.get(title) ?? 0) + 1)
  groups.set(prefixOf(title), group)
}

const lines = [
  `p01: the ground objects in ${repoRelative(CAPTURE)}`,
  "",
  `${plural(ground.size, "ground object")} and ${plural(airborne.size, "AI aircraft object")} over the capture, each counted once by its object ID.`,
  `Distances are from the pilot's aircraft at the time of each poll; "moved" is more than ${MOVED_M}m from where the object was first seen.`,
  "",
  ["Prefix", "Objects", ...NEAR_M.map((m) => `Within ${m < 1000 ? `${m}m` : `${m / 1000}km`}`), "Moved", "Titles, most common first"].join("\t"),
]
for (const [prefix, g] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
  const named = [...g.titles].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`).join("; ")
  lines.push([prefix, g.count, ...g.near, g.moved, named].join("\t"))
}
const file = saveResult("traffic-atc", "p01-ground-objects", lines.join("\n"))
console.log(lines.join("\n"))
console.log(`\nSaved ${repoRelative(file)}`)
