/*
 * Between the world and the aircraft's frame: points given as latitude,
 * longitude, and altitude, directions given north, east, and down, and the
 * aircraft's frame as { forward, right, up } in meters from its reference
 * point, turned by its heading, pitch, and bank, as the probe module's place()
 * turns them (experiments/areas/avatars/wasm/src/follow.cpp).
 *
 *   const a = { lat, lon, alt, hdg, pitch, bank }   as SimConnect reads the
 *            aircraft: degrees, altitude in feet, heading true, and pitch and
 *            bank negative for nose up and right wing down (p15,
 *            record/areas/avatars/log.md)
 *   worldToFrame(a, { lat, lon, alt })   a point in the aircraft's frame
 *   nedToFrame(a, [n, e, d])             a direction in the aircraft's frame
 *   frameToNed(a, { forward, right, up })
 */

const RAD = Math.PI / 180
const EARTH_M = 6_371_000
const FT = 0.3048

// The body-to-north-east-down rotation, yaw then pitch then roll, with body
// axes forward, right, and down.
function rotation(a) {
  const ps = a.hdg * RAD, th = -a.pitch * RAD, ph = -a.bank * RAD
  const [cps, sps, cth, sth, cph, sph] = [Math.cos(ps), Math.sin(ps), Math.cos(th), Math.sin(th), Math.cos(ph), Math.sin(ph)]
  return [
    [cth * cps, sph * sth * cps - cph * sps, cph * sth * cps + sph * sps],
    [cth * sps, sph * sth * sps + cph * cps, cph * sth * sps - sph * cps],
    [-sth, sph * cth, cph * cth],
  ]
}

export function nedToFrame(a, v) {
  const R = rotation(a)
  const b = [0, 1, 2].map((j) => R[0][j] * v[0] + R[1][j] * v[1] + R[2][j] * v[2])
  return { forward: b[0], right: b[1], up: -b[2] }
}

export function frameToNed(a, f) {
  const R = rotation(a)
  const b = [f.forward, f.right, -f.up]
  return R.map((row) => row[0] * b[0] + row[1] * b[1] + row[2] * b[2])
}

export function worldToFrame(a, p) {
  const north = (p.lat - a.lat) * RAD * EARTH_M
  const east = (p.lon - a.lon) * RAD * EARTH_M * Math.cos(a.lat * RAD)
  const down = -(p.alt - a.alt) * FT
  return nedToFrame(a, [north, east, down])
}

// A direction's heading (true, degrees) and its angle above the horizon.
export function headingAndRise(v) {
  const h = Math.hypot(v[0], v[1])
  return { heading: ((Math.atan2(v[1], v[0]) / RAD) + 360) % 360, rise: Math.atan2(-v[2], h) / RAD }
}

// The ray through the cursor from a camera given in the world: its heading and
// pitch built from SimConnect_CameraGet's WORLD angles by a hypothesis h =
// { yawSign, yawOffset, pitchSign } (heading = yawSign * yaw + yawOffset,
// rise = pitchSign * pitch), its field of view the view's height (p20). As a
// direction north, east, and down.
export function worldRay(cam, mouse, h) {
  const ps = (h.yawSign * cam.yaw + h.yawOffset) * RAD, th = h.pitchSign * cam.pitch * RAD
  const f = [Math.cos(th) * Math.cos(ps), Math.cos(th) * Math.sin(ps), -Math.sin(th)]
  const r = [-Math.sin(ps), Math.cos(ps), 0]
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]
  const tv = Math.tan(cam.fov / 2), th2 = tv * (mouse.width / mouse.height)
  return [0, 1, 2].map((k) => f[k] + r[k] * mouse.x * th2 + u[k] * mouse.y * tv)
}
