// The poses of the pilot's figure standing on home's page: the in-sim figure on foot, from the shins up, turned
// toward the window's left, hands on its hips. The figure's arms are straight sticks with no elbows, in the sim
// too, so its hands on its hips splay its arms outward, the hips being wider than the shoulders.

import { add, clamp01, cross, dot, scale, SPEC, sub, unit } from "../heads/trace.ts"
import type { Shape, V } from "../heads/trace.ts"
import type { Projection } from "./drawing.ts"

const LEGS = { width: 0.16, down: 0.066, radius: 0.018, segments: 6 }
export const FOOT = 0.045
/** The hips stand lower than the in-sim figure's 0.92m, which the full legs in the leap made look uncannily long. */
export const HIPS_UP = 0.74
/** The chest and the head's center above the hips, where the portrait puts them, so the neck's gap is the portrait's 3cm. */
export const CHEST_UP = 0.3
export const HEAD_UP = 0.566
/** Where the hands rest on the hips' sides, and where the shrug throws them, from the hips and from the chest; and where the feet stand. In meters, x to the viewer's right, y up, z toward the viewer. */
export const HANDS_ON_HIPS = { out: SPEC.hips.radius + 0.01, up: 0.03, fwd: 0.04 }
export const SHRUG_HANDS = { out: 0.34, up: -0.1, fwd: 0.14 }
export const FEET = { out: 0.1, fwd: 0.03 }

/** A long lens from far in front, framing the figure from just above its knees to a little above its head, right of center, since it throws its right hand further out in the shrug. */
const VIEW = { from: [-0.1, 1.238, 7] as V, to: [-0.1, 1.218, 0] as V, height: 1.636 }
/** The figure turns this far to its own right, about its hips, so it faces the window's left, where Host and the page's words are. */
const YAW = (25 * Math.PI) / 180
const FWD = unit(sub(VIEW.to, VIEW.from))
const RIGHT = unit(cross(FWD, [0, 1, 0]))
const UP = cross(RIGHT, FWD)
const TAN_V = VIEW.height / 2 / Math.hypot(...sub(VIEW.to, VIEW.from))

/** Where a point lands on a drawing `width` by `height`. */
export function standingProjection(width: number, height: number): Projection {
  const perUnit = height / 2 / TAN_V
  return (point) => {
    const d = sub(point, VIEW.from)
    const z = dot(d, FWD)
    return { x: width / 2 + (dot(d, RIGHT) / z) * perUnit, y: height / 2 - (dot(d, UP) / z) * perUnit, perMeter: perUnit / z, depth: z }
  }
}

/**
 * A pose in the figure's own frame, facing the viewer, which `body` turns by YAW. The lean is the one move in the
 * page's frame, toward Host, and the look is the head's direction there too. A tipped pose turns over by its
 * angle about a pivot in its own frame and then moves by its shift, the look turning with it.
 */
type Tip = { angle: number; pivot: V; shift: V; lookOwn: V }
export type Pose = { hips: V; chest: V; head: V; look: V; lean: V; hands: [V, V]; feet: [V, V]; knees: [number, number]; shoulders?: V; tip?: Tip }

const shoulderOf = (pose: Pose, side: number): V => add(pose.chest, add([(side * SPEC.shoulders.width) / 2, -SPEC.shoulders.down, 0], pose.shoulders ?? [0, 0, 0]))

const spin = (o: V): V => [o[0] * Math.cos(YAW) - o[2] * Math.sin(YAW), o[1], o[0] * Math.sin(YAW) + o[2] * Math.cos(YAW)]
const unspin = (o: V): V => [o[0] * Math.cos(YAW) + o[2] * Math.sin(YAW), o[1], -o[0] * Math.sin(YAW) + o[2] * Math.cos(YAW)]
export const turnAbout = (hips: V, q: V): V => add(hips, spin(sub(q, hips)))

/** The way the figure falls, in its own frame: backward and a little to its left, since straight back is mostly away from the viewer and would read as sinking. */
const FALL = unit([0.15, 0, -1])
const ACROSS = unit(cross([0, 1, 0], FALL))
function tipOver(o: V, angle: number): V {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return add(add(scale(o, c), scale(cross(ACROSS, o), s)), scale(ACROSS, dot(ACROSS, o) * (1 - c)))
}

function nearest(p: V, a: V, b: V): V {
  const d = sub(b, a)
  return add(a, scale(d, clamp01(dot(sub(p, a), d) / dot(d, d))))
}

/**
 * A limp arm lies against what's in its way, so the slump's hanging arms rest on the hips. An arm that would pass
 * into the hips turns about its shoulder, away from them, as little as it takes to only rest on them, sunk at most
 * TOUCH, about as far as with the hands on the hips, which reads as resting rather than clipping.
 */
const TOUCH = 0.003
function drape(shoulder: V, hand: V, hips: V): V {
  const length = Math.hypot(...sub(hand, shoulder))
  const reach = scale(sub(hand, shoulder), 1 / length)
  const fits = (d: V) => Math.hypot(...sub(nearest(hips, shoulder, add(shoulder, scale(d, length))), hips)) >= SPEC.hips.radius + SPEC.arm.radius - TOUCH
  if (fits(reach)) return hand
  const away = unit(sub(nearest(hips, shoulder, hand), hips))
  let lo = 0
  let hi = 4
  for (let i = 0; i < 16; i++) {
    const k = (lo + hi) / 2
    if (fits(unit(add(reach, scale(away, k))))) hi = k
    else lo = k
  }
  return add(shoulder, scale(unit(add(reach, scale(away, hi))), length))
}

/** Which shape's shadow falls on which ball, by their places in what `body` returns: the nose on the head, the head on the chest, and the chest on the hips. */
export const BODY_SHADOWS = new Map([
  [2, 3],
  [1, 2],
  [0, 1],
])

/** The figure's shapes in a pose: each leg curves from hip to foot, its middle pushed forward by the knee's bend, and each arm drapes over the hips. */
export function body(pose: Pose): Shape[] {
  const tip = pose.tip
  const place = (q: V) => turnAbout(pose.hips, tip ? add(add(tip.pivot, tipOver(sub(q, tip.pivot), tip.angle)), tip.shift) : q)
  const leaned = (q: V, share: number) => add(place(q), scale(pose.lean, share))
  const chest = leaned(pose.chest, 0.6)
  const head = leaned(pose.head, 1)
  const look = tip ? spin(tipOver(tip.lookOwn, tip.angle)) : pose.look
  const R = SPEC.head.radius
  const r = SPEC.nose.radius
  const rt = r * SPEC.nose.tip
  const shapes: Shape[] = [
    { ball: true, c: place(pose.hips), r: SPEC.hips.radius },
    { ball: true, c: chest, r: SPEC.chest.radius, light: true },
    { ball: true, c: head, r: R },
    { ball: false, a: add(head, scale(look, Math.sqrt(R * R - r * r))), b: add(head, scale(look, R + SPEC.nose.length - rt)), ra: r, rb: rt },
  ]
  for (const k of [0, 1] as const) {
    const side = k === 0 ? -1 : 1
    const shoulder = leaned(shoulderOf(pose, side), 0.6)
    const hand = drape(shoulder, place(pose.hands[k]), place(pose.hips))
    shapes.push({ ball: false, a: shoulder, b: hand, ra: SPEC.arm.radius, rb: SPEC.arm.radius }, { ball: true, c: hand, r: SPEC.hand.radius })
    // The leg bends in a smooth curve from hip to foot, as the in-sim figure's knee is an arc, drawn as short sticks.
    const rootOwn = add(pose.hips, [(side * LEGS.width) / 2, -LEGS.down, 0])
    const control = add(scale(add(rootOwn, pose.feet[k]), 0.5), [0, 0, 2 * pose.knees[k]])
    const along = (t: number): V => add(add(scale(rootOwn, (1 - t) ** 2), scale(control, 2 * (1 - t) * t)), scale(pose.feet[k], t * t))
    let from = place(rootOwn)
    for (let i = 1; i <= LEGS.segments; i++) {
      const to = place(along(i / LEGS.segments))
      shapes.push({ ball: false, a: from, b: to, ra: LEGS.radius, rb: LEGS.radius })
      from = to
    }
    shapes.push({ ball: true, c: place(pose.feet[k]), r: FOOT })
  }
  return shapes
}

export const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
export const lerp = (a: V, b: V, t: number): V => add(a, scale(sub(b, a), t))

/**
 * Hosting or joining: one continuous leap for joy, a full jump that arcs over backward, arms spread and back
 * arched, as if onto a cushion behind it, falling through the tab bar's line and off the page. It winds up as soon
 * as the pilot hosts or joins, and holds its crouch, bobbing, until our servers answer. Times in seconds from the
 * attempt, lengths in meters, speeds in meters a second, angles in radians.
 */
const CHEER = {
  windup: 0.2,
  dip: 0.1,
  crouchBend: 0.13,
  push: 0.13,
  toes: 0.06,
  height: 0.45,
  gravity: 9.8,
  back: 0.5,
  spin: 2.3,
  arch: 0.35,
  flightBend: 0.07,
  // Arms from the shoulders: an angle from straight up, forward positive, and a splay outward.
  arm: { length: 0.46, back: 3.9, up: 0.15, splay: 0.25, spread: 0.4 },
  look: unit([-0.25, 0.8, 0.55]),
  bob: { height: 0.012, rate: 3 },
}

/**
 * Refused, it freezes in its crouch as if taking in what just happened, falls into a slump, holds it, and stands
 * back up as it was. The fall runs on springs: the body's settles with barely a bounce, and the head's, quicker and
 * looser, flops ahead of the body and bounces once.
 */
const DEFLATE = {
  realize: 0.8,
  sag: 0.5,
  hold: 0.8,
  recover: 0.6,
  slump: { k: 120, d: 15 },
  flop: { k: 180, d: 11 },
  sink: 0.025,
  knees: 0.06,
  bend: 0.42,
  chest: 0.03,
  shoulders: [0, -0.03, 0.03] as V,
  neck: 0.35,
  look: unit([-0.1, -0.85, 0.5]),
}
const ARM = Math.hypot(HANDS_ON_HIPS.out - SPEC.shoulders.width / 2, CHEST_UP - SPEC.shoulders.down - HANDS_ON_HIPS.up, HANDS_ON_HIPS.fwd)
const SLUMPED = DEFLATE.realize + DEFLATE.sag + DEFLATE.hold
const DEFLATED = SLUMPED + DEFLATE.recover
export const TAKEOFF = CHEER.windup + CHEER.push
const LAUNCH = Math.sqrt(2 * CHEER.gravity * CHEER.height)
/** A press let go elsewhere, or a canceled attempt, straightens it back up over this long. */
const CANCEL = 0.35

type Spring = { x: number; v: number }
const spring = (s: Spring, target: number, k: number, d: number, dt: number) => {
  s.v += (k * (target - s.x) - d * s.v) * dt
  s.x += s.v * dt
}

/** Where the attempt stands: pressed, waiting on our servers, or answered. */
export type Answer = "pressing" | "waiting" | "ok" | "no"
export type Cheer = { t: number; waited: number; answer: Answer; deflating: number; canceling: number; arm: Spring; arch: Spring; slump: Spring; flop: Spring }

export const newCheer = (answer: Answer): Cheer => ({ t: 0, waited: 0, answer, deflating: -1, canceling: -1, arm: { x: CHEER.arm.back, v: 0 }, arch: { x: 0, v: 0 }, slump: { x: 0, v: 0 }, flop: { x: 0, v: 0 } })

/** Steps the cheer by `dt` in small steps, since its springs are stiff. */
export function stepCheer(s: Cheer, dt: number): void {
  for (let left = dt; left > 1e-6; left -= 0.004) {
    const h = Math.min(0.004, left)
    if (s.answer === "no") {
      s.deflating += h
      if (s.deflating > DEFLATE.realize) {
        spring(s.slump, 1, DEFLATE.slump.k, DEFLATE.slump.d, h)
        spring(s.flop, 1, DEFLATE.flop.k, DEFLATE.flop.d, h)
      }
    }
    if (s.canceling >= 0) s.canceling += h
    // The crouch's bob runs on the time it has held, which stops at a refusal, freezing it.
    if (s.answer !== "ok" && s.t + h >= CHEER.windup) {
      s.t = CHEER.windup
      if (s.answer !== "no") s.waited += h
    } else s.t += h
    const u = smooth((s.t - CHEER.windup) / CHEER.push)
    const arm = s.t < CHEER.windup ? CHEER.arm.back : CHEER.arm.back + (CHEER.arm.up - CHEER.arm.back) * u
    const arch = s.t < CHEER.windup ? -0.3 * smooth(s.t / CHEER.windup) : s.t < TAKEOFF ? -0.3 * (1 - u) : CHEER.arch * smooth((s.t - TAKEOFF) / 0.35)
    spring(s.arm, arm, 150, 13, h)
    spring(s.arch, arch, 50, 10, h)
  }
}

/** Whether a cheer has run its course, leaving the figure as it was: a refusal's slump or a canceled press. */
export const cheerOver = (s: Cheer) => s.deflating > DEFLATED || s.canceling > CANCEL

/** The leap, in one continuous motion: the wind-up lowers the body, the push-off carries it to the toes at the jump's speed along a cubic so the motion has no seam, and then it flies. */
function leapPose(p: Pose, s: Cheer): Pose {
  const c = s.t
  const u = clamp01((c - CHEER.windup) / CHEER.push)
  const flight = c - TAKEOFF
  // In the push-off, the turn and the drift grow as u cubed, reaching their flight speeds at takeoff.
  const early = (speed: number) => ((speed * CHEER.push) / 3) * u ** 3
  let lift: number
  let angle: number
  let drift: number
  if (c < CHEER.windup) {
    lift = -CHEER.dip * smooth(c / CHEER.windup)
    angle = drift = 0
  } else if (s.answer !== "ok") {
    lift = -CHEER.dip + CHEER.bob.height * Math.sin(s.waited * 2 * Math.PI * CHEER.bob.rate)
    angle = drift = 0
  } else if (flight < 0) {
    const toward = -2 * u ** 3 + 3 * u ** 2
    lift = -CHEER.dip * (1 - toward) + CHEER.toes * toward + LAUNCH * CHEER.push * (u ** 3 - u ** 2)
    angle = early(CHEER.spin)
    drift = early(CHEER.back)
  } else {
    lift = CHEER.toes + LAUNCH * flight - 0.5 * CHEER.gravity * flight ** 2
    angle = early(CHEER.spin) + CHEER.spin * flight
    drift = early(CHEER.back) + CHEER.back * flight
  }
  const crouched = c < CHEER.windup ? smooth(c / CHEER.windup) : 1 - smooth(u)
  const flown = flight > 0 ? smooth(flight / 0.3) : 0
  const blend = smooth(c / 0.1)
  const raise = (q: V): V => add(q, [0, lift, 0])
  const hips = raise(p.hips)
  // The upper body bends about the hips by the arch: forward in the crouch, back in the flight.
  const upper = (q: V): V => add(hips, tipOver(sub(raise(q), hips), s.arch.x))
  const splay = CHEER.arm.splay + CHEER.arm.spread * flown
  const hands = p.hands.map((hand, k) => {
    const side = k === 0 ? -1 : 1
    const reach = add(shoulderOf(p, side), scale(unit([side * splay, Math.cos(s.arm.x), Math.sin(s.arm.x)]), CHEER.arm.length))
    return lerp(raise(hand), upper(reach), blend)
  }) as [V, V]
  return {
    ...p,
    hips,
    chest: upper(p.chest),
    head: upper(p.head),
    lean: scale(p.lean, 1 - blend),
    hands,
    // On the floor until takeoff, then carried with the body.
    feet: p.feet.map((foot): V => add(foot, [0, flight < 0 ? Math.max(0, lift) : lift, 0])) as [V, V],
    knees: p.knees.map((bend) => bend + CHEER.crouchBend * crouched + CHEER.flightBend * flown) as [number, number],
    tip: { angle, pivot: hips, shift: scale(FALL, drift), lookOwn: tipOver(CHEER.look, 0.2 + 0.7 * s.arch.x) },
  }
}

/** Refused, standing deflated: slumped forward, head hanging, arms hanging. */
function slumpPose(p: Pose): Pose {
  const bend = (o: V, a: number): V => [o[0], o[1] * Math.cos(a) - o[2] * Math.sin(a), o[1] * Math.sin(a) + o[2] * Math.cos(a)]
  const hips = add(p.hips, [0, -DEFLATE.sink, 0])
  const chest = add(hips, add(bend(sub(p.chest, p.hips), DEFLATE.bend), [0, -DEFLATE.chest, 0]))
  const head = add(chest, bend(sub(p.head, p.chest), DEFLATE.bend + DEFLATE.neck))
  const slumped: Pose = {
    ...p,
    hips,
    chest,
    head,
    shoulders: DEFLATE.shoulders,
    lean: [0, 0, 0],
    knees: p.knees.map((b) => b + DEFLATE.knees) as [number, number],
    tip: { angle: 0, pivot: hips, shift: [0, 0, 0], lookOwn: DEFLATE.look },
  }
  const hang = (side: number): V => add(shoulderOf(slumped, side), [0, -ARM, 0])
  return { ...slumped, hands: [hang(-1), hang(1)] }
}

/**
 * A pose part way from a to b. Each hand swings about its shoulder rather than in a straight line, which would cut
 * through the hips, and the head swings about the chest the same way, going `headShare` of the way, so it can fall
 * ahead of the body. A share past 1, from a spring's overshoot, carries on past b.
 */
function mixPose(a: Pose, b: Pose, t: number, headShare = t): Pose {
  const at = (x: V, y: V) => lerp(x, y, t)
  const tipA = a.tip ?? { angle: 0, pivot: a.hips, shift: [0, 0, 0] as V, lookOwn: unspin(a.look) }
  const tipB = b.tip ?? { angle: 0, pivot: b.hips, shift: [0, 0, 0] as V, lookOwn: unspin(b.look) }
  const about = (from: V, to: V, pivotA: V, pivotB: V, share: number): V => {
    const da = sub(from, pivotA)
    const db = sub(to, pivotB)
    const la = Math.hypot(...da)
    const lb = Math.hypot(...db)
    return add(lerp(pivotA, pivotB, t), scale(unit(lerp(scale(da, 1 / la), scale(db, 1 / lb), share)), la + (lb - la) * share))
  }
  const swing = (k: 0 | 1): V => {
    const side = k === 0 ? -1 : 1
    return about(a.hands[k], b.hands[k], shoulderOf(a, side), shoulderOf(b, side), t)
  }
  return {
    hips: at(a.hips, b.hips),
    chest: at(a.chest, b.chest),
    head: about(a.head, b.head, a.chest, b.chest, headShare),
    look: b.look,
    lean: at(a.lean, b.lean),
    hands: [swing(0), swing(1)],
    shoulders: at(a.shoulders ?? [0, 0, 0], b.shoulders ?? [0, 0, 0]),
    feet: [at(a.feet[0], b.feet[0]), at(a.feet[1], b.feet[1])],
    knees: [a.knees[0] + (b.knees[0] - a.knees[0]) * t, a.knees[1] + (b.knees[1] - a.knees[1]) * t],
    tip: { angle: tipA.angle + (tipB.angle - tipA.angle) * t, pivot: at(tipA.pivot, tipB.pivot), shift: at(tipA.shift, tipB.shift), lookOwn: unit(lerp(tipA.lookOwn, tipB.lookOwn, headShare)) },
  }
}

/** The pose in the cheer, from the pose it was in at the attempt. */
export function cheerPose(p: Pose, s: Cheer): Pose {
  const rest: Pose = { ...p, tip: { angle: 0, pivot: p.hips, shift: [0, 0, 0], lookOwn: unspin(p.look) } }
  if (s.canceling >= 0) return mixPose(leapPose(p, s), rest, smooth(s.canceling / CANCEL))
  if (s.deflating < 0) return leapPose(p, s)
  return mixPose(mixPose(leapPose(p, s), slumpPose(p), s.slump.x, s.flop.x), rest, smooth((s.deflating - SLUMPED) / DEFLATE.recover))
}
