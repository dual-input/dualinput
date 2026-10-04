/*
 * How far the probe module's frame sits from the model's: the camera in
 * SimConnect_CameraGet's SIMOBJECT space, which is the model's (p18, p21), against
 * the camera in WORLD space turned into the aircraft's frame from PLANE LATITUDE,
 * LONGITUDE, ALTITUDE, heading, pitch, and bank, as follow.cpp places the figure.
 * It prints the median difference over 60 pairs taken 50ms apart.
 *
 *   node experiments/areas/avatars/tools/frames.mjs
 */
import { open, Protocol, SimConnectConstants, SimConnectDataType, SimConnectPeriod } from "node-simconnect"

import { worldToFrame } from "../lib/frames.mjs"
const { handle } = await open("CROSSCHECK frame check", Protocol.SunRise)
const VARS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"], ["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"], ["GROUND VELOCITY", "knots"]]
for (const [n, u] of VARS) handle.addToDataDefinition(1, n, u, SimConnectDataType.FLOAT64)
let a = null
handle.on("simObjectData", (d) => {
  const v = VARS.map(() => d.data.readFloat64())
  a = { lat: v[0], lon: v[1], alt: v[2], hdg: v[3], pitch: v[4], bank: v[5], gs: v[6] }
})
handle.requestDataOnSimObject(1, 1, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SIM_FRAME)
let s = null, w = null
const pairs = []
handle.on("cameraData", (r) => {
  const c = r.cameraData
  if (c.positionReferential === 1) s = [c.position.x, c.position.y, c.position.z]
  if (c.positionReferential === 2) {
    w = { lat: c.position.x, lon: c.position.y, alt: c.position.z / 0.3048 }
    if (s && a) {
      const f = worldToFrame(a, w)
      pairs.push({ s, m: [-f.right, f.up, f.forward], a: { ...a } })
    }
  }
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 60; i++) { handle.cameraGet(1); handle.cameraGet(2); await sleep(50) }
handle.close()
const med = (xs) => { const t = [...xs].sort((p, q) => p - q); return t[Math.floor(t.length / 2)] }
const d = [0, 1, 2].map((k) => med(pairs.map((p) => p.s[k] - p.m[k])))
console.log(`${pairs.length} pairs; aircraft pitch ${a.pitch.toFixed(3)}Â°, bank ${a.bank.toFixed(3)}Â°, ${a.gs.toFixed(2)} kt`)
console.log(`camera SIMOBJECT ${pairs.at(-1).s.map((x) => x.toFixed(3)).join(", ")}; from WORLD ${pairs.at(-1).m.map((x) => x.toFixed(3)).join(", ")}`)
console.log(`SIMOBJECT minus WORLD-in-frame, median, model axes (+x left, y up, z forward): ${d.map((x) => (x * 100).toFixed(1)).join(", ")} cm`)
const spread = [0, 1, 2].map((k) => { const xs = pairs.map((p) => p.s[k] - p.m[k]); return ((Math.max(...xs) - Math.min(...xs)) * 100).toFixed(1) })
console.log(`spread over the pairs: ${spread.join(", ")} cm`)

// The same, with the north and east distances from WGS 84's radii of
// curvature at the aircraft's latitude instead of one sphere's 6,371km.
const WGS_A = 6_378_137, WGS_E2 = 0.00669437999014, RAD = Math.PI / 180
const last = pairs.at(-1)
const sl = Math.sin(last.a.lat * RAD)
const M = WGS_A * (1 - WGS_E2) / (1 - WGS_E2 * sl * sl) ** 1.5, N = WGS_A / Math.sqrt(1 - WGS_E2 * sl * sl)
const north = (w.lat - last.a.lat) * RAD * M, east = (w.lon - last.a.lon) * RAD * N * Math.cos(last.a.lat * RAD)
const sphere = worldToFrame(last.a, w)
const scale = { north: M / 6_371_000, east: N / 6_371_000 }
const nSphere = (w.lat - last.a.lat) * RAD * 6_371_000, eSphere = (w.lon - last.a.lon) * RAD * 6_371_000 * Math.cos(last.a.lat * RAD)
// Move the sphere's answer by the difference in north and east, turned into the frame.
const h = last.a.hdg * RAD
const dn = north - nSphere, de = east - eSphere
const wgs = [-(sphere.right + (-dn * Math.sin(h) + de * Math.cos(h))), sphere.up, sphere.forward + (dn * Math.cos(h) + de * Math.sin(h))]
console.log(`aircraft at latitude ${last.a.lat.toFixed(4)}°, heading ${last.a.hdg.toFixed(1)}° true; WGS 84's radii are ${(scale.north * 100).toFixed(2)}% and ${(scale.east * 100).toFixed(2)}% of the sphere's north and east`)
console.log(`SIMOBJECT minus WORLD-in-frame with WGS 84's radii: ${[0, 1, 2].map((k) => ((last.s[k] - wgs[k]) * 100).toFixed(1)).join(", ")} cm`)
process.exit(0)

