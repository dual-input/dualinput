/*
 * Turns a pose into the figure's channel values. A pose is where the eye is
 * and where it looks, and the point each hand and foot reaches for, all from
 * the seat point in meters forward, right, and up, with angles in degrees.
 * A hand or foot with no point goes to its rest point in the spec.
 *
 * The head turns about the eye, so the nose points where the pilot looks from
 * where the pilot's camera is. The chest sits between the hips and the head.
 *
 * An arm reaching for a point runs straight to it. At rest it curves by the
 * spec's rest bend and bows outward, away from the body, with its chord still
 * ending on the rest point.
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

  // Points a limb along `dir`, with its bend toward `toward` (any vector off
  // that line), as yaw, pitch, and the roll that the model's twist reads.
  const aim = (name, dir, toward) => {
    const y = Math.atan2(dir.right, dir.fwd), p = Math.atan2(dir.up, Math.hypot(dir.fwd, dir.right))
    v[`${name}_YAW`] = y * DEG
    v[`${name}_PITCH`] = p * DEG
    const up = { fwd: -Math.sin(p) * Math.cos(y), right: -Math.sin(p) * Math.sin(y), up: Math.cos(p) }
    const right = cross(up, dir)
    v[`${name}_ROLL`] = toward ? Math.atan2(dot(toward, right), -dot(toward, up)) * DEG : 0
  }

  const arm = (name, side, from, target) => {
    const d = sub(target ?? rest(spec, "hand", side), from)
    const chord = unit(d)
    const bend = target ? 0 : spec.arm.restBend / DEG
    if (bend === 0) {
      aim(name, chord, null)
      v[`${name}_BEND`] = 0
      v[`${name}_LEN`] = Math.max(0.02, len(d))
      return
    }
    // The curve's chord runs at `tilt` from its start toward the bend, so the
    // start leans the other way, outward, for the chord to land on the point.
    const [ea, et] = bendEnd(bend, 1, spec.arm.segments)
    const tilt = Math.atan2(et, ea)
    // Inward, square to the chord; straight down if the chord runs sideways.
    const sideways = { fwd: 0, right: -side, up: 0 }
    let inward = sub(sideways, mul(chord, dot(sideways, chord)))
    if (len(inward) < 1e-3) inward = sub({ fwd: 0, right: 0, up: -1 }, mul(chord, -chord.up))
    inward = unit(inward)
    const start = add(mul(chord, Math.cos(tilt)), mul(inward, -Math.sin(tilt)))
    const toward = add(mul(chord, Math.sin(tilt)), mul(inward, Math.cos(tilt)))
    aim(name, unit(start), toward)
    v[`${name}_BEND`] = bend * DEG
    v[`${name}_LEN`] = Math.max(0.02, len(d) / Math.hypot(ea, et))
  }

  const leg = (name, from, kneeAt, foot) => {
    const thigh = sub(kneeAt, from)
    const dir = unit(thigh)
    const length = Math.max(0.02, len(thigh))
    const knee = add(from, mul(dir, length))
    const w = sub(foot, knee)
    const along = dot(w, dir)
    const off = sub(w, mul(dir, along))
    aim(name, dir, len(off) > 1e-6 ? off : null)
    v[`${name}_LEN`] = length
    const { bend, shin } = bendTo(along, len(off), spec.knee.arc, spec.knee.segments)
    v[`${name}_BEND`] = bend * DEG
    v[`${name}_SHIN`] = shin
  }

  arm("ARM_L", -1, add(chest, a.shoulderL), pose.handL)
  arm("ARM_R", 1, add(chest, a.shoulderR), pose.handR)
  leg("LEG_L", a.legL, a.kneeL, pose.footL ?? rest(spec, "foot", -1))
  leg("LEG_R", a.legR, a.kneeR, pose.footR ?? rest(spec, "foot", 1))
  return v
}
