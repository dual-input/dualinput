// A portrait of the pilot's figure as their crew sees it in the cockpit, for the crew card: the spheres and sticks
// the in-sim model builds, at its sizes and in its seated pose, lit like a studio photo and cropped at the waist,
// its hands holding the portrait's bottom edge. The head turns about its eye toward a direction the caller sets,
// easing there, and it startles when the pilot picks another color.

import { useEffect, useRef } from "react"
import type { RefObject } from "react"

import { add, cross, dot, scale, SPEC, sub, unit } from "../heads/trace.ts"
import type { Shape, V } from "../heads/trace.ts"
import { FigureDrawing } from "./drawing.ts"
import type { Projection } from "./drawing.ts"

/** Forward, right, and up from the hips' center, in meters. */
const POSE = { eye: [-0.05, 0, 0.63] }
const EYE_FORWARD = 0.06
/** In the cockpit the head sits at the pilot's eye, which leaves a neck's worth of air above the chest. The portrait lowers it to close most of that, leaving 3cm. */
const NECK_DROP = 0.064

/** The render's axes: x to the viewer's right, y up, and z toward the camera, from the hips' center. The figure faces the camera, so its own right is the viewer's left. */
const at = (fwd: number, right: number, up: number): V => [-right, up, fwd]
const COCKPIT_EYE = at(POSE.eye[0]!, POSE.eye[1]!, POSE.eye[2]!)
const EYE = sub(COCKPIT_EYE, [0, NECK_DROP, 0])

/** A portrait lens: far back and long, so the figure keeps its proportions, framed from the top of the hips to a little above the head. */
const CAMERA = { from: [0, 0.6, 3.3] as V, to: [0, 0.45, 0] as V, fov: 10.7 }
const FWD = unit(sub(CAMERA.to, CAMERA.from))
const RIGHT = unit(cross(FWD, [0, 1, 0]))
const UP = cross(RIGHT, FWD)
const TAN = Math.tan((CAMERA.fov * Math.PI) / 360)

/** Where a point lands in the portrait, from 0 to 1 across and down, and how far from the camera. */
function place(p: V): [number, number, number] {
  const d = sub(p, CAMERA.from)
  const z = dot(d, FWD)
  return [(dot(d, RIGHT) / (z * TAN) + 1) / 2, (1 - dot(d, UP) / (z * TAN)) / 2, z]
}

/** Where the head sits in the portrait, from which the crew card aims it. */
export const HEAD_IN_PORTRAIT = place(sub(EYE, [0, 0, EYE_FORWARD]))

/** The point a given distance in front of the hips that lands at a place in the portrait. */
function inPortrait(across: number, down: number, fwd: number): V {
  const ray = unit(add(FWD, add(scale(RIGHT, (across * 2 - 1) * TAN), scale(UP, (1 - down * 2) * TAN))))
  return add(CAMERA.from, scale(ray, (fwd - CAMERA.from[2]) / ray[2]))
}

/** The hands hold the portrait's bottom edge near its corners, a little in front of the hips, with the bottom quarter of each hand over the edge. */
const HOLD = { across: 0.15, fwd: 0.25, over: 0.25 }
const HANDS = [HOLD.across, 1 - HOLD.across].map((across) => {
  const z = place(inPortrait(across, 1, HOLD.fwd))[2]
  const r = SPEC.hand.radius / (2 * z * TAN)
  return inPortrait(across, 1 - r * (1 - 2 * HOLD.over), HOLD.fwd)
}) as [V, V]
/** How far the drawing reaches below the portrait, as a share of its width: enough for the part of each hand over the edge. */
const OVERHANG = 0.1

/** The figure looking along `look`, its body and head raised by `lift`, and each hand moved from where it holds the edge. */
function figure(look: V, lift: { body: number; head: number; hands: [V, V] }): Shape[] {
  const head = add(sub(EYE, scale(look, EYE_FORWARD)), [0, lift.head, 0])
  // The chest sits between the hips and the head's center, so it leans a little as the head turns.
  const chest = add(scale(sub(COCKPIT_EYE, scale(look, EYE_FORWARD)), SPEC.chest.along), [0, lift.body, 0])
  const R = SPEC.head.radius
  const r = SPEC.nose.radius
  const tip = r * SPEC.nose.tip
  const shapes: Shape[] = [
    { ball: true, c: [0, lift.body, 0], r: SPEC.hips.radius },
    { ball: true, c: chest, r: SPEC.chest.radius, light: true },
    { ball: true, c: head, r: R },
    { ball: false, a: add(head, scale(look, Math.sqrt(R * R - r * r))), b: add(head, scale(look, R + SPEC.nose.length - tip)), ra: r, rb: tip },
  ]
  for (const side of [-1, 1]) {
    const shoulder = add(chest, at(0, (side * SPEC.shoulders.width) / 2, -SPEC.shoulders.down))
    const which = side < 0 ? 1 : 0
    const hand = add(HANDS[which]!, lift.hands[which]!)
    shapes.push({ ball: false, a: shoulder, b: hand, ra: SPEC.arm.radius, rb: SPEC.arm.radius }, { ball: true, c: hand, r: SPEC.hand.radius, hand: true })
  }
  return shapes
}

const SHADOWS = new Map([
  [2, 3],
  [1, 2],
  [0, 1],
])

/** A startle when the pilot picks another color: the body jolts up and settles with a small bounce, the head lagging a moment and tipping back, and the hands nearly lose their grip, popping off the edge one after the other. Times in seconds, the height in meters. */
const STARTLE = {
  height: 0.03,
  peak: 0.08,
  decay: 7,
  length: 0.75,
  head: { gain: 1.25, lag: 0.025, tip: 0.3 },
  hands: [
    { gain: 0.8, lag: 0.045 },
    { gain: 0.55, lag: 0.015 },
  ],
  grab: { rise: 0.06, fall: 0.09, back: 1, inward: 0.6 },
}
const LAST_LAG = Math.max(STARTLE.head.lag, ...STARTLE.hands.map((hand) => hand.lag))

function jolt(t: number): number {
  if (t < 0 || t >= STARTLE.length) return 0
  return (Math.exp(-STARTLE.decay * t) * Math.sin((Math.PI / 2 / STARTLE.peak) * t)) / Math.exp(-STARTLE.decay * STARTLE.peak)
}

/** A hand's lift, 1 at its highest: it flicks up, slowing, then comes down faster and faster and stops dead on the edge, as a hand grabs for support. */
function grab(t: number): number {
  const { rise, fall } = STARTLE.grab
  if (t < 0 || t >= rise + fall) return 0
  if (t < rise) return Math.sin((Math.PI / 2) * (t / rise))
  const u = (t - rise) / fall
  return 1 - u * u
}

export function FigurePortrait({ hex, size, aim }: { hex: string; size: number; aim: RefObject<V> }) {
  const holder = useRef<HTMLDivElement>(null)
  const drawingRef = useRef<FigureDrawing | null>(null)
  const startled = useRef(-Infinity)
  const firstHex = useRef(hex)

  useEffect(() => {
    if (hex === firstHex.current) return
    firstHex.current = hex
    drawingRef.current?.setColor(hex)
    startled.current = performance.now()
  }, [hex])

  useEffect(() => {
    const element = holder.current
    if (!element) return
    const height = Math.round(size * (1 + OVERHANG))
    const drawing = new FigureDrawing(firstHex.current, size, height)
    drawingRef.current = drawing
    element.appendChild(drawing.svg)
    const project: Projection = (point) => {
      const [x, y, z] = place(point)
      return { x: x * size, y: y * size, perMeter: size / (2 * z * TAN), depth: z }
    }
    let look: V = aim.current
    let drawn = false
    let frame = 0
    const tick = () => {
      const next = unit(add(look, scale(sub(aim.current, look), 0.12)))
      const turning = Math.hypot(...sub(next, look)) > 2e-4
      const since = (performance.now() - startled.current) / 1000
      if (turning || since < STARTLE.length + LAST_LAG + 0.05 || !drawn) {
        look = next
        const head = jolt(since - STARTLE.head.lag)
        const lifts = STARTLE.hands.map((hand) => STARTLE.height * hand.gain * grab(since - hand.lag))
        const hands = lifts.map((lift, k): V => [-Math.sign(HANDS[k as 0 | 1][0]) * STARTLE.grab.inward * lift, lift, -STARTLE.grab.back * lift]) as [V, V]
        drawing.draw(figure(unit(add(next, [0, STARTLE.head.tip * head, 0])), { body: STARTLE.height * jolt(since), head: STARTLE.height * STARTLE.head.gain * head, hands }), project, SHADOWS)
        drawn = true
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      drawing.svg.remove()
      drawingRef.current = null
    }
    // The aim is a ref, read each frame, and the size is the card's for its life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // It spans the portrait's box and hangs below it, so the box must not clip it.
  return <div ref={holder} className="absolute left-0 top-0" />
}
