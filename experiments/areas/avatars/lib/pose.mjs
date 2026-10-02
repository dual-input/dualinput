/*
 * Positions and headings on the ground, for placing a figure relative to the
 * avatar. Distances are meters, angles are degrees, and headings are true.
 */

export const RAD = Math.PI / 180
const EARTH_M = 6_371_000

export const wrap = (deg) => ((deg % 360) + 360) % 360

// The signed turn from one heading to another, -180 to 180.
export const turn = (from, to) => ((to - from + 540) % 360) - 180

// A point aheadM along p.hdg and rightM to its right.
export function offset(p, aheadM, rightM) {
  const h = p.hdg * RAD
  const north = aheadM * Math.cos(h) - rightM * Math.sin(h)
  const east = aheadM * Math.sin(h) + rightM * Math.cos(h)
  return {
    ...p,
    lat: p.lat + (north / EARTH_M) / RAD,
    lon: p.lon + (east / (EARTH_M * Math.cos(p.lat * RAD))) / RAD,
  }
}

// The true bearing from a to b.
export function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD)
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD)
  return wrap(Math.atan2(y, x) / RAD)
}

// The pose at time t, between the two samples around it; null outside them.
// Numeric fields other than the heading are mixed in a straight line.
export function poseAt(samples, t) {
  for (let i = samples.length - 1; i > 0; i--) {
    const a = samples[i - 1]
    const b = samples[i]
    if (a.t > t || b.t < t) continue
    const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t)
    const out = { t }
    for (const k of Object.keys(b)) {
      if (k === "t" || typeof a[k] !== "number" || typeof b[k] !== "number") continue
      out[k] = k === "hdg" ? wrap(a.hdg + turn(a.hdg, b.hdg) * f) : a[k] + (b[k] - a[k]) * f
    }
    return out
  }
  return null
}
