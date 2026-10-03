/*
 * Turns a pose into the figure's channel values. A pose is where the eye is
 * and where it looks, and the point each hand and foot reaches for, all from
 * the seat point in meters forward, right, and up, with angles in degrees.
 * A hand or foot with no point goes to its rest point in the spec.
 *
 * The head turns about the eye, so the nose points where the pilot looks from
 * where the pilot's camera is. The chest sits between the hips and the head,
 * and each limb runs straight from its anchor to its point.
 */

import { anchors } from "./model.mjs"

const DEG = 180 / Math.PI
const add = (a, b) => ({ fwd: a.fwd + b.fwd, right: a.right + b.right, up: a.up + b.up })
const sub = (a, b) => ({ fwd: a.fwd - b.fwd, right: a.right - b.right, up: a.up - b.up })
const lerp = (a, b, t) => ({ fwd: a.fwd + (b.fwd - a.fwd) * t, right: a.right + (b.right - a.right) * t, up: a.up + (b.up - a.up) * t })

// Where the look points, as a unit vector.
export function lookDir(look) {
  const y = look.yaw / DEG, p = look.pitch / DEG
  return { fwd: Math.cos(p) * Math.cos(y), right: Math.cos(p) * Math.sin(y), up: Math.sin(p) }
}

export function rest(spec, part, side) {
  const r = spec.rest[part]
  return { fwd: r.fwd, right: side * r.right, up: r.up }
}

export function solve(spec, pose) {
  const a = anchors(spec)
  const v = {}
  const { eye, look } = pose
  v.HEAD_FWD = eye.fwd
  v.HEAD_RIGHT = eye.right
  v.HEAD_UP = eye.up
  v.HEAD_YAW = look.yaw
  v.HEAD_PITCH = look.pitch
  v.HEAD_ROLL = look.roll

  const f = lookDir(look)
  const head = sub(eye, { fwd: f.fwd * spec.head.eyeForward, right: f.right * spec.head.eyeForward, up: f.up * spec.head.eyeForward })
  const chest = lerp(a.hips, head, spec.chest.at)
  v.CHEST_FWD = chest.fwd
  v.CHEST_RIGHT = chest.right
  v.CHEST_UP = chest.up

  const limb = (name, from, to) => {
    const d = sub(to, from)
    const flat = Math.hypot(d.fwd, d.right)
    v[`${name}_YAW`] = Math.atan2(d.right, d.fwd) * DEG
    v[`${name}_PITCH`] = Math.atan2(d.up, flat) * DEG
    v[`${name}_LEN`] = Math.max(0.02, Math.hypot(flat, d.up))
  }
  limb("ARM_L", add(chest, a.shoulderL), pose.handL ?? rest(spec, "hand", -1))
  limb("ARM_R", add(chest, a.shoulderR), pose.handR ?? rest(spec, "hand", 1))
  limb("LEG_L", a.legL, pose.footL ?? rest(spec, "foot", -1))
  limb("LEG_R", a.legR, pose.footR ?? rest(spec, "foot", 1))
  return v
}
