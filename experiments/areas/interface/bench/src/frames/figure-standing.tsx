// The pilot's figure standing on home's page when the aircraft's profile has no notes: the in-sim
// figure on foot, from the shins up, turned toward the window's left, hands on its hips, looking up
// at Host. It stays a little alive at rest, breathing
// and shifting its weight, follows the cursor with its head, and grows impatient while the pilot
// moves the cursor around without hosting: a foot taps, it glances up at Host and back, its hands
// drum on its hips, and at last it shrugs, holding the shrug while the cursor is shaken at it.
// Hovering Host, the code field, or Join makes it hop and freeze mid-whatever, breath held, leaning
// toward it with its eyes on the cursor, which pulls it along as it moves across; leaving, it forgets
// its impatience and relaxes. Pressing Host or Join winds it up, and once our servers answer it jumps
// for joy and falls over backward, off the page.
//
// It draws with the portrait's ray tracer and light (figure-portrait.tsx). The figure's arms are
// straight sticks with no elbows, in the sim too, so its hands on its hips splay its arms outward,
// the hips being wider than the shoulders. The legs' sizes are the figure's spec,
// src/features/avatars/figure/figure.json on the figure viewer's branch, so change them together;
// the standing height of its hips is lower than the spec's, as HIPS_UP says.
import { useEffect, useRef } from "react"

import { add, albedos, clamp01, cross, display, dot, hitBall, hitNormal, hitStick, offset, present, scale, shade, SPEC, sub, unit, type Shape, type V } from "./figure-portrait"

const LEGS = { width: 0.16, down: 0.066, radius: 0.018, segments: 6 }
const FOOT = 0.045
// The hips stand lower than the in-sim figure's 0.92m, which the full legs in the leap made look
// uncannily long; the upper body keeps its sizes. VIEW sits as much lower, so the standing figure
// keeps its place on the page.
const HIPS_UP = 0.74
// The chest and the head's center above the hips, where the portrait puts them, so the neck's gap
// is the portrait's 3cm rather than the cockpit's longer one.
const CHEST_UP = 0.3
const HEAD_UP = 0.566
// Where the hands rest on the hips' sides, and where the shrug throws them, from the hips and from
// the chest; and where the feet stand. In meters, x to the viewer's right, y up, z toward the viewer.
const HANDS_ON_HIPS = { out: SPEC.hips.radius + 0.01, up: 0.03, fwd: 0.04 }
const SHRUG_HANDS = { out: 0.34, up: -0.1, fwd: 0.14 }
const FEET = { out: 0.1, fwd: 0.03 }

// A long lens from far in front, like the portrait's, framing the figure from just above its knees to
// a little above its head. The feet stay out of view, so a tap shows only in the thigh above them.
// The figure sits right of center, since turned to its right it throws its right hand further out to
// the viewer's left in the shrug.
const VIEW = { from: [-0.1, 1.238, 7] as V, to: [-0.1, 1.218, 0] as V, height: 1.636 }
// The figure turns this far to its own right, about its hips, so it faces the window's left, where
// Host and the page's words are. Its head still looks wherever it looks.
const YAW = (25 * Math.PI) / 180
const FWD = unit(sub(VIEW.to, VIEW.from))
const RIGHT = unit(cross(FWD, [0, 1, 0]))
const UP = cross(RIGHT, FWD)
const TAN_V = VIEW.height / 2 / Math.hypot(...sub(VIEW.to, VIEW.from))

// A pose in the figure's own frame, facing the viewer, which body() turns by YAW. The lean is the
// one move in the page's frame, toward Host, and the look is the head's direction there too. A
// tipped pose turns over by its angle about a pivot in its own frame and then moves by its shift,
// the look turning with it, given then in the figure's own frame as lookOwn.
// The shoulders sit on the chest where the in-sim figure puts them, moved by the pose's shoulders,
// which the slump rolls forward and down.
type Tip = { angle: number; pivot: V; shift: V; lookOwn: V }
type Pose = { hips: V; chest: V; head: V; look: V; lean: V; hands: [V, V]; feet: [V, V]; knees: [number, number]; shoulders?: V; tip?: Tip }

// A shoulder in a pose's own frame, before its lean and tip: side -1 on the viewer's left, 1 on the
// right.
const shoulderOf = (p: Pose, side: number): V => add(p.chest, add([(side * SPEC.shoulders.width) / 2, -SPEC.shoulders.down, 0], p.shoulders ?? [0, 0, 0]))

// An offset turned by YAW, and a point turned about the vertical line through the hips.
const spin = (o: V): V => [o[0] * Math.cos(YAW) - o[2] * Math.sin(YAW), o[1], o[0] * Math.sin(YAW) + o[2] * Math.cos(YAW)]
const turnAbout = (hips: V, q: V): V => add(hips, spin(sub(q, hips)))
// The way the figure falls, in its own frame: backward and a little to its left, the viewer's
// right, since straight back is mostly away from the viewer and would read as sinking. An offset
// tipped by an angle swings its top that way, about the level line across the fall.
const FALL = unit([0.15, 0, -1])
const ACROSS = unit(cross([0, 1, 0], FALL))
function tipOver(o: V, angle: number): V {
  const c = Math.cos(angle), s = Math.sin(angle)
  return add(add(scale(o, c), scale(cross(ACROSS, o), s)), scale(ACROSS, dot(ACROSS, o) * (1 - c)))
}

// The point of the segment from a to b nearest to p.
function nearest(p: V, a: V, b: V): V {
  const d = sub(b, a)
  return add(a, scale(d, clamp01(dot(sub(p, a), d) / dot(d, d))))
}

// A limp arm lies against what's in its way, so the slump's hanging arms rest on the hips and a
// swing past them brushes along them. An arm that would pass into the hips turns about its
// shoulder, away from them, as little as it takes to only rest on them, sunk at most TOUCH, about
// as far as with the hands on the hips, which reads as resting rather than clipping. The hand rests
// where the arm puts it.
const TOUCH = 0.003
function drape(shoulder: V, hand: V, hips: V): V {
  const length = Math.hypot(...sub(hand, shoulder))
  const reach = scale(sub(hand, shoulder), 1 / length)
  const fits = (d: V) => Math.hypot(...sub(nearest(hips, shoulder, add(shoulder, scale(d, length))), hips)) >= SPEC.hips.radius + SPEC.arm.radius - TOUCH
  if (fits(reach)) return hand
  const away = unit(sub(nearest(hips, shoulder, hand), hips))
  let lo = 0, hi = 4
  for (let i = 0; i < 16; i++) {
    const k = (lo + hi) / 2
    if (fits(unit(add(reach, scale(away, k))))) hi = k
    else lo = k
  }
  return add(shoulder, scale(unit(add(reach, scale(away, hi))), length))
}

// The figure's shapes in a pose: each leg curves from hip to foot, its middle pushed forward by the
// knee's bend, and each arm drapes over the hips.
// Every point of the figure's own frame is tipped, if the pose is, then turned about the hips.
function body(p: Pose): Shape[] {
  const tip = p.tip
  const place = (q: V) => turnAbout(p.hips, tip ? add(add(tip.pivot, tipOver(sub(q, tip.pivot), tip.angle)), tip.shift) : q)
  const leaned = (q: V, share: number) => add(place(q), scale(p.lean, share))
  const chest = leaned(p.chest, 0.6)
  const head = leaned(p.head, 1)
  const look = tip ? spin(tipOver(tip.lookOwn, tip.angle)) : p.look
  const R = SPEC.head.radius, r = SPEC.nose.radius, rt = r * SPEC.nose.tip
  const out = Math.sqrt(R * R - r * r)
  const shapes: Shape[] = [
    { ball: true, c: place(p.hips), r: SPEC.hips.radius },
    { ball: true, c: chest, r: SPEC.chest.radius, light: true },
    { ball: true, c: head, r: R },
    { ball: false, a: add(head, scale(look, out)), b: add(head, scale(look, R + SPEC.nose.length - rt)), ra: r, rb: rt },
  ]
  for (const k of [0, 1]) {
    const side = k === 0 ? -1 : 1
    const shoulder = leaned(shoulderOf(p, side), 0.6)
    const hand = drape(shoulder, place(p.hands[k]), place(p.hips))
    shapes.push({ ball: false, a: shoulder, b: hand, ra: SPEC.arm.radius, rb: SPEC.arm.radius }, { ball: true, c: hand, r: SPEC.hand.radius })
    // The leg bends in a smooth curve from hip to foot, as the in-sim figure's knee is an arc, drawn
    // as short sticks. The curve's control point sits twice the bend forward of the leg's middle, so
    // the curve's own middle sits the bend forward.
    const rootOwn = add(p.hips, [(side * LEGS.width) / 2, -LEGS.down, 0])
    const control = add(scale(add(rootOwn, p.feet[k]), 0.5), [0, 0, 2 * p.knees[k]])
    const along = (t: number): V => add(add(scale(rootOwn, (1 - t) ** 2), scale(control, 2 * (1 - t) * t)), scale(p.feet[k], t * t))
    let from = place(rootOwn)
    for (let i = 1; i <= LEGS.segments; i++) {
      const to = place(along(i / LEGS.segments))
      shapes.push({ ball: false, a: from, b: to, ra: LEGS.radius, rb: LEGS.radius })
      from = to
    }
    shapes.push({ ball: true, c: place(p.feet[k]), r: FOOT })
  }
  return shapes
}

// Where a point lands on the canvas, from 0 to 1 across and down, and how far it is from the camera.
function project(p: V, tanH: number): [number, number, number] {
  const d = sub(p, VIEW.from)
  const z = dot(d, FWD)
  return [(dot(d, RIGHT) / (z * tanH) + 1) / 2, (1 - dot(d, UP) / (z * TAN_V)) / 2, z]
}

// Each shape's box on the canvas in pixels, so a pixel tests only the shapes that can cover it, and
// the box of everything, so the passes skip the empty canvas.
type Box = [number, number, number, number]
function boxes(shapes: Shape[], w: number, h: number, tanH: number): { each: Box[]; all: Box } {
  const ballBox = (c: V, r: number): Box => {
    const [x, y, z] = project(c, tanH)
    const rx = (r / (z * tanH)) * (w / 2) + 1, ry = (r / (z * TAN_V)) * (h / 2) + 1
    return [x * w - rx, y * h - ry, x * w + rx, y * h + ry]
  }
  const each = shapes.map((s): Box => {
    if (s.ball) return ballBox(s.c, s.r)
    const a = ballBox(s.a, Math.max(s.ra, s.rb)), b = ballBox(s.b, Math.max(s.ra, s.rb))
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
  })
  // With no shapes yet, the box is empty and the passes draw nothing.
  const all = each.reduce((u, b): Box => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity])
  return { each, all: [Math.max(0, Math.floor(all[0])), Math.max(0, Math.floor(all[1])), Math.min(w - 1, Math.ceil(all[2])), Math.min(h - 1, Math.ceil(all[3]))] }
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))

// One ray for each pixel within the box of everything.
function pass(sum: Float32Array, w: number, h: number, tanH: number, shapes: Shape[], bx: { each: Box[]; all: Box }, colors: { main: V; light: V }, n: number) {
  const [ox, oy] = offset(n)
  const [x0, y0, x1, y1] = bx.all
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const rd = unit(add(FWD, add(scale(RIGHT, (((i + ox) / w) * 2 - 1) * tanH), scale(UP, (1 - ((j + oy) / h) * 2) * TAN_V))))
      let best = Infinity, self = -1, normal: V = [0, 0, 0]
      for (let k = 0; k < shapes.length; k++) {
        const b = bx.each[k]
        if (i < b[0] || i > b[2] || j < b[1] || j > b[3]) continue
        const s = shapes[k]
        const t = s.ball ? hitBall(VIEW.from, rd, s.c, s.r) : hitStick(VIEW.from, rd, s)
        if (t > 0 && t < best) {
          best = t
          self = k
          normal = s.ball ? scale(sub(add(VIEW.from, scale(rd, t)), s.c), 1 / s.r) : hitNormal
        }
      }
      if (self < 0) continue
      const s = shapes[self]
      const c = display(shade(add(VIEW.from, scale(rd, best)), normal, scale(rd, -1), shapes, self, s.ball && s.light ? colors.light : colors.main))
      const o = (j * w + i) * 4
      sum[o] += c[0]
      sum[o + 1] += c[1]
      sum[o + 2] += c[2]
      sum[o + 3] += 1
    }
  }
}

// How the figure moves, in seconds and meters. At rest it breathes and shifts its weight from foot
// to foot; impatience grows with every pixel the cursor travels without hosting, and drains once
// the cursor rests; past each level the figure adds a gesture, and at the last it shrugs and calms
// down to the second.
const IDLE = { breath: 4.2, breathe: 0.005, sway: 7.5, shift: 0.018, bend: 0.035 }
const IMPATIENCE = { tap: 250, glance: 700, drum: 1200, shrug: 1800, after: 900, rest: 1.5, drain: 500 }
// The foot is out of view, so its lift and the knee's bend with it are what show the tap.
const TAP = { rate: 2.4, lift: 0.035, knee: 1 }
const GLANCE = { every: 3.2, hold: 0.7 }
const DRUM = { rate: 5, lift: 0.012 }
// The shrug holds for as long as the pilot keeps shaking the cursor faster than tease, in page pixels
// a second over the last window seconds, as if being teased.
const SHRUG = { rise: 0.3, hold: 0.7, fall: 0.5, lift: 0.035, tilt: 0.02, up: 0.25, tease: 900, window: 0.25 }
// Hovering Host, the code field, or Join, or typing in the field, freezes the body mid-gesture, breath
// included, and the figure leans toward it, locking its head onto the cursor there, or onto the slot
// being typed in, faster than it follows the cursor elsewhere; moving along it pulls the figure
// that way. Let go, it forgets its impatience and relaxes its gestures at relax a second.
const PERK = { lean: [-0.035, 0, 0.02] as V, ease: 0.15, lock: 0.3, relax: 6 }
const PULL = { hips: 0.02, lean: 0.06, rate: 6 }
const HOP = { height: 0.03, peak: 0.1, decay: 8, length: 0.6 }
// Hosting or joining: one continuous leap for joy, a full jump that arcs over backward, arms spread
// and back arched, as if onto a cushion behind it, falling through the tab bar's line and off the
// page so the next page has the space. No landing, and no fear. It winds up as soon as the pilot
// hosts or joins, and holds its crouch, bobbing, until our servers answer; a refusal deflates it.
// Times in seconds from the attempt, lengths in meters, speeds in meters a second, angles in radians.
const CHEER = {
  // The wind-up: a deep crouch, leaning forward, arms swinging back and down.
  windup: 0.2,
  dip: 0.1,
  crouchBend: 0.13,
  // The push-off: the body springs up onto its toes, reaching the jump's speed as the feet leave.
  push: 0.13,
  toes: 0.06,
  // The flight: a full jump of this height, drifting back at this speed and turning back at spin
  // radians a second, which carries it, arched and spread, through the tab bar's line at about
  // 110 degrees, onto the cushion behind it that the page never shows.
  height: 0.45,
  gravity: 9.8,
  back: 0.5,
  spin: 2.3,
  arch: 0.35,
  flightBend: 0.07,
  // Arms from the shoulders: an angle from straight up, forward positive, and a splay outward.
  // They swing from behind and below, through the front, to just past straight up, and spread.
  arm: { length: 0.46, back: 3.9, up: 0.15, splay: 0.25, spread: 0.4 },
  look: unit([-0.25, 0.8, 0.55]),
  // Waiting in the crouch, it bobs this far, this many times a second.
  bob: { height: 0.012, rate: 3 },
}
// Refused, it lets go of everything it wound up: it freezes in its crouch for realize seconds, as if
// taking in what just happened, falls out of it into a slump over sag seconds, holds it, and over
// recover seconds stands back up as it was. The fall runs on springs
// with no easing in at the bottom: the body's settles with barely a bounce, and the head's, quicker
// and looser, flops ahead of the body and bounces once. In the slump its knees give a little, it
// bends forward at the waist by bend radians, its chest sinks and its shoulders roll forward and
// down, and its head hangs neck radians further from the neck, looking down. The arms keep the
// length they have with the hands on the hips and hang straight down from the shoulders, so the
// hands drop with the shoulders, the arms resting on the hips where the hips are in the way.
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
const TAKEOFF = CHEER.windup + CHEER.push
const LAUNCH = Math.sqrt(2 * CHEER.gravity * CHEER.height)
// A spring's value and speed, pulled toward a target with stiffness k and damping d. The arms' and
// the arch's springs follow their scripted angles a little late and overshoot a little, which gives
// the jump its follow-through.
type Spring = { x: number; v: number }
const spring = (s: Spring, target: number, k: number, d: number, dt: number) => {
  s.v += (k * (target - s.x) - d * s.v) * dt
  s.x += s.v * dt
}
// A press on Host or Join winds it up too, before any attempt: held while the button is held, and
// let go anywhere but the button, it straightens back up over CANCEL seconds, nothing attempted.
const CANCEL = 0.35
// The leap's time, held at the wind-up's end while pressed or waiting; how long it has held; the
// answer, or the press before it; how long it has been deflating from a refusal, or straightening up
// from a cancelled press; and how far the body and the head have fallen into the slump.
type Answer = "pressing" | "waiting" | "ok" | "no"
type Cheer = { t: number; waited: number; answer: Answer; deflating: number; canceling: number; arm: Spring; arch: Spring; slump: Spring; flop: Spring }
const newCheer = (answer: Answer): Cheer => ({
  t: 0,
  waited: 0,
  answer,
  deflating: -1,
  canceling: -1,
  arm: { x: CHEER.arm.back, v: 0 },
  arch: { x: 0, v: 0 },
  slump: { x: 0, v: 0 },
  flop: { x: 0, v: 0 },
})

// Steps the cheer by dt in small steps, since its springs are stiff.
function stepCheer(s: Cheer, dt: number) {
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
// A pass over the figure took about 15ms in Chrome on the development PC. While it moves, it's posed
// every frame with one pass. At rest it moves only by breathing and shifting, by under 2px, so it's
// posed at most this often then, with this many passes that smooth its edges.
const IDLE_FRAME = 150
const IDLE_PASSES = 2
const FRAME_BUDGET = 8

const envelope = (t: number, rise: number, hold: number, fall: number) =>
  t < 0 ? 0 : t < rise ? smooth(t / rise) : t < rise + hold ? 1 : t < rise + hold + fall ? 1 - smooth((t - rise - hold) / fall) : 0
const hop = (t: number) => (t < 0 || t >= HOP.length ? 0 : (Math.exp(-HOP.decay * t) * Math.sin((Math.PI / 2 / HOP.peak) * t)) / Math.exp(-HOP.decay * HOP.peak))
const lerp = (a: V, b: V, t: number): V => add(a, scale(sub(b, a), t))

// The pose in the cheer, from the pose it was in at the attempt: the leap's; refused, the held
// crouch giving way to the slump and the slump to the pose it started from; or, a press let go
// elsewhere, the crouch giving way to that pose.
function cheerPose(p: Pose, s: Cheer): Pose {
  const rest: Pose = { ...p, tip: { angle: 0, pivot: p.hips, shift: [0, 0, 0], lookOwn: unspin(p.look) } }
  if (s.canceling >= 0) return mixPose(leapPose(p, s), rest, smooth(s.canceling / CANCEL))
  if (s.deflating < 0) return leapPose(p, s)
  const sagged = mixPose(leapPose(p, s), slumpPose(p), s.slump.x, s.flop.x)
  return mixPose(sagged, rest, smooth((s.deflating - SLUMPED) / DEFLATE.recover))
}

// The leap, in one continuous motion. The wind-up lowers the body; the push-off carries it from the
// crouch, at rest, to the toes at the jump's speed, along a cubic so the motion has no seam; then it
// flies, rising and falling under gravity, drifting back, and turning back about its hips, the turn
// and the drift starting gently in the push-off at the speeds they keep. The arms and the arch come
// from their springs. Held in the crouch, it bobs.
function leapPose(p: Pose, s: Cheer): Pose {
  const c = s.t
  const u = clamp01((c - CHEER.windup) / CHEER.push)
  const flight = c - TAKEOFF
  // In the push-off, the turn and the drift grow as u cubed, reaching their flight speeds at takeoff.
  const early = (speed: number) => ((speed * CHEER.push) / 3) * u ** 3
  let lift: number, angle: number, drift: number
  if (c < CHEER.windup) {
    lift = -CHEER.dip * smooth(c / CHEER.windup)
    angle = drift = 0
  } else if (s.answer !== "ok") {
    lift = -CHEER.dip + CHEER.bob.height * Math.sin(s.waited * 2 * Math.PI * CHEER.bob.rate)
    angle = drift = 0
  } else if (flight < 0) {
    const toward = -2 * u ** 3 + 3 * u ** 2, speedUp = u ** 3 - u ** 2
    lift = -CHEER.dip * (1 - toward) + CHEER.toes * toward + LAUNCH * CHEER.push * speedUp
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
    feet: p.feet.map((f): V => add(f, [0, flight < 0 ? Math.max(0, lift) : lift, 0])) as [V, V],
    knees: p.knees.map((b) => b + CHEER.crouchBend * crouched + CHEER.flightBend * flown) as [number, number],
    tip: { angle, pivot: hips, shift: scale(FALL, drift), lookOwn: tipOver(CHEER.look, 0.2 + 0.7 * s.arch.x) },
  }
}

// Refused, standing deflated: slumped forward, head hanging, arms hanging.
function slumpPose(p: Pose): Pose {
  // An offset turned forward, its top toward the viewer, about the level line across the figure.
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

// A pose part way from a to b: every point and bend, and the tip's angle, pivot, shift, and look.
// Each hand swings about its shoulder rather than in a straight line, which would cut through the
// hips: its direction from the shoulder and its distance from it each ease between the two. The
// head swings about the chest the same way, and with its look goes headShare of the way, so it can
// fall ahead of the body. A share past 1, from a spring's overshoot, carries on past b.
function mixPose(a: Pose, b: Pose, t: number, headShare = t): Pose {
  const at = (x: V, y: V) => lerp(x, y, t)
  const ta = a.tip ?? { angle: 0, pivot: a.hips, shift: [0, 0, 0], lookOwn: unspin(a.look) }
  const tb = b.tip ?? { angle: 0, pivot: b.hips, shift: [0, 0, 0], lookOwn: unspin(b.look) }
  const about = (from: V, to: V, pivotA: V, pivotB: V, share: number): V => {
    const da = sub(from, pivotA), db = sub(to, pivotB)
    const la = Math.hypot(...da), lb = Math.hypot(...db)
    return add(lerp(pivotA, pivotB, t), scale(unit(lerp(scale(da, 1 / la), scale(db, 1 / lb), share)), la + (lb - la) * share))
  }
  const swing = (k: number): V => {
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
    tip: { angle: ta.angle + (tb.angle - ta.angle) * t, pivot: at(ta.pivot, tb.pivot), shift: at(ta.shift, tb.shift), lookOwn: unit(lerp(ta.lookOwn, tb.lookOwn, headShare)) },
  }
}

// A direction in the page's frame turned back into the figure's own, undoing spin.
const unspin = (o: V): V => [o[0] * Math.cos(YAW) + o[2] * Math.sin(YAW), o[1], -o[0] * Math.sin(YAW) + o[2] * Math.cos(YAW)]

// The figure fills its canvas, which the page sizes; it finds Host as the element marked data-host
// inside the element marked data-home-page around it, and the things it locks on to as the elements
// marked data-figure-target, and listens there to the cursor, to focus, and to the figure-attempt
// and figure-answer events the page sends when the pilot hosts or joins and our servers answer.
export function StandingFigure({ hex }: { hex: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext("2d")
    if (!el || !ctx) return
    const page = el.closest<HTMLElement>("[data-home-page]")
    const host = page?.querySelector<HTMLElement>("[data-host]") ?? null
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(el.clientWidth * dpr), h = Math.round(el.clientHeight * dpr)
    el.width = w
    el.height = h
    // The canvas keeps the height it opens with, from the bottom of the room it's given, so the
    // figure stays put when the start card grows over a refusal and the room shrinks from the top.
    // The card covers the canvas's empty top.
    el.style.height = `${el.clientHeight}px`
    const tanH = (TAN_V * w) / h
    const colors = albedos(hex)
    const sum = new Float32Array(w * h * 4)

    let cursor: [number, number] | null = null
    let impatience = 0
    let lastMove = -Infinity
    // The cursor's recent moves away from the targets, for its speed: when, and how far in page pixels.
    let moves: [number, number][] = []
    let hopAt = -Infinity
    let cheer: Cheer | null = null
    // The target under the cursor and the one with focus; the figure attends to either, the hovered
    // one first.
    let hovered: HTMLElement | null = null
    let focused: HTMLElement | null = null
    const attended = () => hovered ?? focused
    let lean = 0
    let pull = 0
    let look: V | null = null
    // The body's own clock, in seconds, which stops while it attends to a target, so breathing,
    // shifting, tapping, drumming, and the shrug all freeze where they are. The shrug's start and the
    // end of its hold run on it, and its shown amount and the tap's and drum's ease toward their targets.
    let clock = 0
    let shrugAt = -Infinity
    let heldUntil = -Infinity
    let shrugShown = 0
    let tapAmt = 0
    let drumAmt = 0

    // The canvas can zoom the page, so distances are counted in the page's own pixels.
    const zoom = () => el.getBoundingClientRect().width / el.offsetWidth || 1
    const onMove = (e: MouseEvent) => {
      if (cursor && !attended()) {
        const d = Math.hypot(e.clientX - cursor[0], e.clientY - cursor[1]) / zoom()
        impatience += d
        moves.push([performance.now(), d])
      }
      cursor = [e.clientX, e.clientY]
      lastMove = performance.now()
    }
    const onLeave = () => (cursor = null)
    // Attention starting makes it hop; ending, it forgets everything it was impatient about.
    const attend = (change: () => void) => {
      const before = attended()
      change()
      const after = attended()
      if (!before && after) hopAt = performance.now()
      if (before && !after) {
        impatience = 0
        shrugAt = heldUntil = -Infinity
      }
    }
    const targets = [...(page?.querySelectorAll<HTMLElement>("[data-figure-target]") ?? [])]
    const listeners = targets.flatMap((t) => [
      ["mouseenter", () => attend(() => (hovered = t))],
      ["mouseleave", () => attend(() => hovered === t && (hovered = null))],
      ["focusin", () => attend(() => (focused = t))],
      ["focusout", () => attend(() => focused === t && (focused = null))],
    ].map(([type, fn]) => [t, type, fn] as [HTMLElement, string, () => void]))
    // A press on Host or Join, the elements marked data-figure-press, winds it up; let go on the
    // button, the click's attempt follows, and let go anywhere else, it straightens back up. Coherent
    // GT has no PointerEvent, so these are the mouse's events, the release heard from the window.
    let pressedOn: HTMLElement | null = null
    const presses = [...(page?.querySelectorAll<HTMLElement>("[data-figure-press]") ?? [])]
    const fresh = () => !cheer || cheer.answer === "no" || cheer.canceling >= 0
    const onPress = (e: MouseEvent) => {
      if (e.button !== 0) return
      pressedOn = e.currentTarget as HTMLElement
      if (fresh()) cheer = newCheer("pressing")
    }
    const onRelease = (e: MouseEvent) => {
      if (!pressedOn) return
      if (cheer?.answer === "pressing") {
        if (pressedOn.contains(e.target as Node)) cheer.answer = "waiting"
        else cheer.canceling = 0
      }
      pressedOn = null
    }
    for (const b of presses) b.addEventListener("mousedown", onPress)
    window.addEventListener("mouseup", onRelease)
    // An attempt winds it up, if a press hasn't already, and the answer sets it leaping or
    // deflating; a new attempt after a refusal or a cancelled press starts afresh.
    const onAttempt = () => {
      if (fresh()) cheer = newCheer("waiting")
      else if (cheer?.answer === "pressing") cheer.answer = "waiting"
    }
    const onAnswer = (e: Event) => {
      if (cheer?.answer !== "waiting") return
      const ok = (e as CustomEvent<{ ok: boolean }>).detail.ok
      cheer.answer = ok ? "ok" : "no"
      if (!ok) cheer.deflating = 0
    }
    page?.addEventListener("mousemove", onMove)
    page?.addEventListener("mouseleave", onLeave)
    page?.addEventListener("figure-attempt", onAttempt)
    page?.addEventListener("figure-answer", onAnswer)
    for (const [t, type, fn] of listeners) t.addEventListener(type, fn)

    // The direction from the head toward a point on the page, as if the page were a window a little
    // in front of the figure, like the crew card's.
    const toward = (x: number, y: number, head: V): V => {
      const r = el.getBoundingClientRect()
      const [a, d] = project(head, tanH)
      const z = zoom()
      return unit([(x - (r.left + a * r.width)) / z, -(y - (r.top + d * r.height)) / z, el.offsetWidth * 1.6])
    }
    const center = (e: Element | null | undefined): [number, number] | null => {
      const r = e?.getBoundingClientRect()
      return r ? [r.left + r.width / 2, r.top + r.height / 2] : null
    }
    // Where the figure's eyes go on the target it attends to: the cursor on a hovered one, and on a
    // focused one the slot being typed in, which the code field marks data-active, or its middle.
    const spot = (): [number, number] | null => (hovered ? cursor : center(focused?.querySelector('[data-active="true"]') ?? focused))
    // Where that spot is across the target, from -1 at its left end to 1 at its right.
    const across = () => {
      const r = attended()?.getBoundingClientRect(), s = spot()
      return r && s ? Math.max(-1, Math.min(1, ((s[0] - r.left) / r.width) * 2 - 1)) : 0
    }

    let shapes: Shape[] = []
    let bx = boxes([], w, h, tanH)
    let passes = 0
    let posedAt = -Infinity
    let last = performance.now()
    let frame = 0
    const tick = () => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      const ease = (rate: number) => 1 - Math.exp(-rate * dt)
      if (now - lastMove > IMPATIENCE.rest * 1000) impatience = Math.max(0, impatience - IMPATIENCE.drain * dt)
      moves = moves.filter(([at]) => now - at < SHRUG.window * 1000)
      const speed = moves.reduce((s, [, d]) => s + d, 0) / SHRUG.window

      const attending = attended() !== null
      let shrugTarget = shrugShown
      let shrugBefore = shrugShown
      if (!attending) {
        clock += dt
        // How long the shrug holds at its height: its own hold, or longer while it's teased.
        const hold = () => Math.max(SHRUG.hold, Number.isFinite(heldUntil) ? heldUntil - shrugAt - SHRUG.rise : 0)
        // Teasing keeps a shrug that's under way at its height.
        const since = clock - shrugAt
        if (since >= 0 && since < SHRUG.rise + hold() && speed > SHRUG.tease) heldUntil = clock + 0.2
        if (impatience >= IMPATIENCE.shrug && !(since <= SHRUG.rise + hold() + SHRUG.fall)) {
          shrugAt = clock
          heldUntil = -Infinity
          impatience = IMPATIENCE.after
        }
        shrugTarget = envelope(clock - shrugAt, SHRUG.rise, hold(), SHRUG.fall)
        shrugShown += (shrugTarget - shrugShown) * ease(PERK.relax * 2)
        const calm = shrugTarget === 0
        tapAmt += ((calm && impatience >= IMPATIENCE.tap ? 1 : 0) - tapAmt) * ease(PERK.relax)
        drumAmt += ((calm && impatience >= IMPATIENCE.drum ? 1 : 0) - drumAmt) * ease(PERK.relax)
      }
      const shrug = shrugShown
      const glancing = !attending && shrugTarget === 0 && impatience >= IMPATIENCE.glance && clock % GLANCE.every < GLANCE.hold
      const leanBefore = lean, pullBefore = pull
      lean += ((attending ? 1 : 0) - lean) * PERK.ease
      pull += ((attending ? across() : 0) - pull) * ease(PULL.rate)

      const breathe = Math.sin((clock * 2 * Math.PI) / IDLE.breath)
      const sway = Math.sin((clock * 2 * Math.PI) / IDLE.sway)
      const hips: V = [IDLE.shift * sway + PULL.hips * pull, HIPS_UP + HOP.height * hop((now - hopAt) / 1000), 0]
      const leaning = add(scale(PERK.lean, lean), [PULL.lean * pull, 0, 0])
      const chest = add(hips, [0, CHEST_UP + IDLE.breathe * breathe + SHRUG.lift * shrug, 0])
      const head = add(hips, [SHRUG.tilt * shrug, HEAD_UP + IDLE.breathe * breathe + SHRUG.lift * shrug, 0])

      // The head eases toward Host at first, while glancing, and once the cursor leaves the page;
      // toward the cursor otherwise, tipping up a little in the shrug; and on a target it locks onto
      // its spot there, quickly.
      const target = attending ? spot() : !cursor || glancing ? center(host) ?? cursor : cursor
      const aim = target ? toward(target[0], target[1], add(turnAbout(hips, head), leaning)) : ([0, 0, 1] as V)
      look ??= aim
      const next = unit(add(look, scale(sub(unit(add(aim, [0, SHRUG.up * shrug, 0])), look), attending ? PERK.lock : 0.12)))
      const turning = Math.hypot(...sub(next, look)) > 2e-4
      look = next

      if (cheer) {
        stepCheer(cheer, dt)
        // A refusal that has run its course, or a press let go elsewhere, leaves it as it was.
        if (cheer.deflating > DEFLATED || cheer.canceling > CANCEL) cheer = null
      }
      // Off screen, or with the page hidden, it keeps time but draws nothing, since drawing is the
      // cost: the frames canvas holds several figures, and the EFB is often closed.
      const r = el.getBoundingClientRect()
      if (document.hidden || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) {
        frame = requestAnimationFrame(tick)
        return
      }
      // Shown at under half its size, as on the zoomed-out frames canvas, its breathing can't be
      // seen, so at rest it's posed once a second with one pass.
      const small = r.width < el.offsetWidth * 0.5
      const idleFrame = small ? 1000 : IDLE_FRAME
      const idlePasses = small ? 1 : IDLE_PASSES
      // Frozen on a target, an unchanged pose is left to sharpen.
      const gesturing = !attending && (tapAmt > 0.01 || drumAmt > 0.01 || Math.abs(shrug - shrugBefore) > 1e-4)
      const moving = turning || gesturing || cheer !== null || Math.abs(lean - leanBefore) > 1e-4 || Math.abs(pull - pullBefore) > 1e-4 || now - hopAt < HOP.length * 1000
      if (moving || passes === 0 || (!attending && now - posedAt > idleFrame)) {
        const drum = [0, 1].map((k) => drumAmt * DRUM.lift * Math.max(0, Math.sin(clock * 2 * Math.PI * DRUM.rate + k * Math.PI)))
        const tap = tapAmt * TAP.lift * Math.max(0, Math.sin(clock * 2 * Math.PI * TAP.rate))
        const pose: Pose = {
          hips,
          chest,
          head,
          look,
          lean: leaning,
          hands: [0, 1].map((k): V => {
            const side = k === 0 ? -1 : 1
            const onHips = add(hips, [side * (HANDS_ON_HIPS.out + drum[k] * 0.5), HANDS_ON_HIPS.up + drum[k], HANDS_ON_HIPS.fwd])
            return lerp(onHips, add(chest, [side * SHRUG_HANDS.out, SHRUG_HANDS.up, SHRUG_HANDS.fwd]), shrug)
          }) as [V, V],
          // The foot on the viewer's right taps.
          feet: [0, 1].map((k): V => [(k === 0 ? -1 : 1) * FEET.out, FOOT + (k === 1 ? tap : 0), FEET.fwd]) as [V, V],
          // The leg that carries less weight bends a little at the knee, and so does a tapping one.
          knees: [0, 1].map((k) => IDLE.bend * Math.max(0, (k === 0 ? 1 : -1) * sway) + (k === 1 ? tap * TAP.knee : 0)) as [number, number],
        }
        shapes = body(cheer ? cheerPose(pose, cheer) : pose)
        bx = boxes(shapes, w, h, tanH)
        // Once the leap has carried the whole figure off its canvas, it's gone for good.
        if (cheer && cheer.t > TAKEOFF && (bx.all[1] > bx.all[3] || bx.all[0] > bx.all[2])) {
          ctx.clearRect(0, 0, w, h)
          return
        }
        sum.fill(0)
        passes = 0
        posedAt = now
      }
      const start = performance.now()
      let ran = 0
      while (passes < idlePasses && (ran === 0 || performance.now() - start < FRAME_BUDGET)) {
        pass(sum, w, h, tanH, shapes, bx, colors, passes)
        passes++
        ran++
      }
      if (ran) {
        present(ctx, sum, w, passes)
        // The mean time of this frame's passes, for timing the figure in the bench.
        el.dataset.passMs = ((performance.now() - start) / ran).toFixed(2)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      page?.removeEventListener("mousemove", onMove)
      page?.removeEventListener("mouseleave", onLeave)
      page?.removeEventListener("figure-attempt", onAttempt)
      page?.removeEventListener("figure-answer", onAnswer)
      for (const [t, type, fn] of listeners) t.removeEventListener(type, fn)
      for (const b of presses) b.removeEventListener("mousedown", onPress)
      window.removeEventListener("mouseup", onRelease)
    }
  }, [hex])

  return <canvas ref={canvas} style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: "100%" }} />
}
