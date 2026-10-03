/*
 * The ray from the eye through the cursor, in a cockpit model's own space
 * (meters, +x left, y up, z forward; p18), and a fit of its parameters to
 * clicks whose target is known.
 *
 *   const dir = rayThrough(cam, mouse, params)
 *   const fit = fitProjection(samples)    samples: { cam, mouse, origin, target }
 *
 * cam is SimConnect_CameraGet in the SIMOBJECT referential: x left, y up, z
 * forward in meters (p07), the angles in degrees, with SimConnect.h's Bank
 * field carrying the yaw and Heading the roll (p06), and fov in radians.
 * mouse has the cursor's x and y in the sim window, -1 to 1 right and up, and
 * the window's width and height.
 *
 * params:
 *   mirror     +1 when the screen's right is the model's -x
 *   yaw        +1 or -1, the sign that turns the camera's yaw to the right
 *   pitch      +1 or -1, the sign that turns its pitch to up
 *   k          the half-width of the view is k * tan(fov / 2), so k = 1 reads
 *              the fov as horizontal, and k = aspect reads it as vertical
 *   yawBias, pitchBias   degrees added after the signs
 *
 * Roll is left out: it stays near 0 unless the pilot leans with a tracker (p07).
 */

const RAD = Math.PI / 180

// p19's clicks named controls best with these (record/areas/avatars/log.md).
export const P19 = { mirror: 1, yaw: 1, pitch: -1, k: 1, yawBias: 0, pitchBias: 0 }

export function rayThrough(cam, mouse, h) {
  const th = Math.tan(cam.fov / 2) * h.k
  const tv = th / (mouse.width / mouse.height)
  let f = 1, r = h.mirror * mouse.x * th, u = mouse.y * tv
  const p = (h.pitch * cam.pitch + h.pitchBias) * RAD
  ;[f, u] = [f * Math.cos(p) - u * Math.sin(p), f * Math.sin(p) + u * Math.cos(p)]
  const y = (h.yaw * cam.yaw + h.yawBias) * RAD
  ;[f, r] = [f * Math.cos(y) - r * Math.sin(y), f * Math.sin(y) + r * Math.cos(y)]
  return [-r, u, f]
}

// The angle between the ray and the line from the eye to the target, degrees.
export function angleOff(s, h) {
  const d = rayThrough(s.cam, s.mouse, h)
  const w = s.target.map((x, i) => x - s.origin[i])
  const c = (d[0] * w[0] + d[1] * w[1] + d[2] * w[2]) / (Math.hypot(...d) * Math.hypot(...w))
  return Math.acos(Math.min(1, Math.max(-1, c))) / RAD
}

const rms = (samples, h) => Math.sqrt(samples.reduce((s, x) => s + angleOff(x, h) ** 2, 0) / samples.length)

function search(samples, base, ks, pbs, ybs) {
  let best = null
  for (const k of ks) for (const pitchBias of pbs) for (const yawBias of ybs) {
    const h = { ...base, k, pitchBias, yawBias }
    const e = rms(samples, h)
    if (!best || e < best.rms) best = { params: h, rms: e }
  }
  return best
}
const steps = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step)

// k alone, with the signs and biases of base: how the view's width relates to
// CameraGet's fov in one set of clicks, to compare across zooms and windows.
export function fitK(samples, base) {
  return search(samples, base, steps(0.3, 3.5, 0.002), [base.pitchBias], [base.yawBias])
}
export const rmsOf = rms

// Every sign combination, a coarse grid of k and the biases, then a finer one
// around the best.
export function fitProjection(samples) {
  const tried = []
  for (const mirror of [1, -1]) for (const yaw of [1, -1]) for (const pitch of [1, -1]) {
    const coarse = search(samples, { mirror, yaw, pitch }, steps(0.4, 2.4, 0.04), steps(-8, 8, 0.5), steps(-8, 8, 0.5))
    const p = coarse.params
    tried.push(search(samples, { mirror, yaw, pitch }, steps(p.k - 0.04, p.k + 0.04, 0.004), steps(p.pitchBias - 0.5, p.pitchBias + 0.5, 0.05), steps(p.yawBias - 0.5, p.yawBias + 0.5, 0.05)))
  }
  tried.sort((a, b) => a.rms - b.rms)
  const best = tried[0]
  return { ...best, errors: samples.map((s) => angleOff(s, best.params)), runnerUp: tried[1], p19: { rms: rms(samples, P19), errors: samples.map((s) => angleOff(s, P19)) } }
}
