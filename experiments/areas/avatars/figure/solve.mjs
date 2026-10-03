/*
 * Turns a pose into the figure's channel values. A pose is where the eye is
 * and where it looks, and the point each hand and foot reaches for, all from
 * the seat point in meters forward, right, and up, with angles in degrees.
 * A hand with no point goes to its rest point in the spec, and a foot with
 * none to the spec's rest bend and shin length.
 *
 * The head turns about the eye, so the nose points where the pilot looks from
 * where the pilot's camera is. The chest sits between the hips and the head,
 * and each arm runs straight from its shoulder to its point.
 *
 * A leg's thigh runs from the hip to the knee point, and the knee bends toward
 * the foot until the shin, straight from the curve's end, passes through it.
 */

import { anchors, bendEnd } from "./model.mjs"

const DEG = 180 / Math.PI
const add = (a, b) => ({ fwd: a.fwd + b.fwd, right: a.right + b.right, up: a.up + b.up })
const sub = (a, b) => ({ fwd: a.fwd - b.fwd, right: a.right - b.right, up: a.up - b.up })
const mul = (a, k) => ({ fwd: a.fwd * k, right: a.right * k, up: a.up * k })
const dot = (a, b) => a.fwd * b.fwd + a.right * b.right + a.up * b.up
const len = (a) => Math.sqrt(dot(a, a))
const unit = (a) => mul(a, 1 / (len(a) || 1))
const lerp = (a, b, t) => add(a, mul(sub(b, a), t))
const cross = (a, b) => ({ fwd: a.right * b.up - a.up * b.right, right: a.up * b.fwd - a.fwd * b.up, up: a.fwd * b.right - a.right * b.fwd })

// Where the look points, as a unit vector.
export function lookDir(look) {
  const y = look.yaw / DEG, p = look.pitch / DEG
  return { fwd: Math.cos(p) * Math.cos(y), right: Math.cos(p) * Math.sin(y), up: Math.sin(p) }
}

export function rest(spec, part, side) {
  const r = spec.rest[part]
  return { fwd: r.fwd, right: side * r.right, up: r.up }
}

// The bend, in radians, and the shin's length that put the shin through a
// point `along` the limb and `toward` the bend from the curve's start. Past
// the furthest bend the curve reaches, it stays there.
function bendTo(along, toward, length, segments) {
  if (toward < 1e-6) return { bend: 0, shin: Math.max(0.02, along - length) }
  const miss = (b) => {
    const [ea, et] = bendEnd(b, length, segments)
    return (along - ea) * Math.sin(b) - (toward - et) * Math.cos(b)
  }
  const MAX = Math.PI * 0.99
  let bend = MAX
  if (miss(MAX) > 0) {
    let lo = 0, hi = MAX
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (miss(mid) > 0) hi = mid
      else lo = mid
    }
    bend = (lo + hi) / 2
  }
  const [ea, et] = bendEnd(bend, length, segments)
  return { bend, shin: Math.max(0.02, (along - ea) * Math.cos(bend) + (toward - et) * Math.sin(bend)) }
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

  const head = sub(eye, mul(lookDir(look), spec.head.eyeForward))
  const chest = lerp(a.hips, head, spec.chest.at)
  v.CHEST_FWD = chest.fwd
  v.CHEST_RIGHT = chest.right
  v.CHEST_UP = chest.up

  // Points a limb along `dir` as yaw and pitch, and returns the limb's own up
  // and right, which the model's twist turns about.
  const aim = (name, dir) => {
    const y = Math.atan2(dir.right, dir.fwd), p = Math.atan2(dir.up, Math.hypot(dir.fwd, dir.right))
    v[`${name}_YAW`] = y * DEG
    v[`${name}_PITCH`] = p * DEG
    const up = { fwd: -Math.sin(p) * Math.cos(y), right: -Math.sin(p) * Math.sin(y), up: Math.cos(p) }
    return { up, right: cross(up, dir) }
  }

  const arm = (name, from, to) => {
    const d = sub(to, from)
    aim(name, unit(d))
    v[`${name}_LEN`] = Math.max(0.02, len(d))
  }

  // A foot with no point hangs straight down from the thigh at the spec's
  // rest bend and shin length, wherever that puts it.
  const leg = (name, from, kneeAt, foot) => {
    const thigh = sub(kneeAt, from)
    const dir = unit(thigh)
    const length = Math.max(0.02, len(thigh))
    const { up, right } = aim(name, dir)
    v[`${name}_LEN`] = length
    if (!foot) {
      v[`${name}_ROLL`] = 0
      v[`${name}_BEND`] = spec.rest.leg.bend
      v[`${name}_SHIN`] = spec.rest.leg.shin
      return
    }
    const w = sub(foot, add(from, mul(dir, length)))
    const along = dot(w, dir)
    const off = sub(w, mul(dir, along))
    v[`${name}_ROLL`] = len(off) > 1e-6 ? Math.atan2(dot(off, right), -dot(off, up)) * DEG : 0
    const { bend, shin } = bendTo(along, len(off), spec.knee.arc, spec.knee.segments)
    v[`${name}_BEND`] = bend * DEG
    v[`${name}_SHIN`] = shin
  }

  arm("ARM_L", add(chest, a.shoulderL), pose.handL ?? rest(spec, "hand", -1))
  arm("ARM_R", add(chest, a.shoulderR), pose.handR ?? rest(spec, "hand", 1))
  leg("LEG_L", a.legL, a.kneeL, pose.footL)
  leg("LEG_R", a.legR, a.kneeR, pose.footR)
  return v
}
