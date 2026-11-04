// A portrait of the pilot's figure as their crew sees it in the cockpit, for the crew card: the
// spheres and sticks the in-sim model builds, at its sizes and in its seated pose, lit like a
// studio photo and cropped at the waist. The head turns about its eye toward a direction the
// caller sets, easing there, as the in-sim figure's head does.
//
// It renders in software, one ray per pixel into the shapes, since that needs only a 2D canvas,
// and whether Coherent GT, the sim's panel engine, runs WebGL is unmeasured.
//
// The sizes, the palette, and the pose are the figure's spec and its solver's seated test pose,
// src/features/avatars/figure/figure.json and src/features/avatars/routines/src/solve.rs on the
// figure viewer's branch, which isn't on main yet, so change them together.
import { useEffect, useRef } from "react"

// The vector math, the spec, the shapes, their ray tests and shading, and the passes' offsets and
// presenting are exported for the standing figure in figure-standing.tsx, which draws the same
// figure on foot.
export type V = [number, number, number]
export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const unit = (a: V): V => scale(a, 1 / Math.hypot(a[0], a[1], a[2]))
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export const SPEC = {
  head: { radius: 0.1, eyeForward: 0.06 },
  nose: { radius: 0.038, length: 0.099, tip: 0.6 },
  chest: { radius: 0.134, at: 0.48 },
  hips: { radius: 0.179 },
  shoulders: { width: 0.208, down: -0.01 },
  arm: { radius: 0.015 },
  hand: { radius: 0.038 },
  lighten: 0.3,
}
// Forward, right, and up from the hips' center, in meters.
const POSE = { eye: [-0.05, 0, 0.63] }
// In the cockpit the head sits at the pilot's eye and the hips on the seat, which leaves a neck's
// worth of air between the head and the chest. The portrait lowers the head to close most of it,
// leaving 3cm, and keeps the chest where the cockpit's pose puts it.
const NECK_DROP = 0.064

// The palette without its gray, which marks a figure whose pilot is gone or lost.
export const FIGURE_COLORS = [
  { name: "red", hex: "#e2453c" },
  { name: "blue", hex: "#3b7fe0" },
  { name: "green", hex: "#3fae5a" },
  { name: "yellow", hex: "#f2b630" },
  { name: "purple", hex: "#8e5ad8" },
  { name: "orange", hex: "#f0862e" },
  { name: "teal", hex: "#2fb3a6" },
  { name: "pink", hex: "#e46aa6" },
]

// The render's axes: x to the viewer's right, y up, and z toward the camera, from the hips' center.
// The figure faces the camera, so its own right is the viewer's left.
const at = (fwd: number, right: number, up: number): V => [-right, up, fwd]

// A ball, or a stick that tapers from radius ra at a to rb at b, with rounded ends: an arm where
// the radii match, and the nose where they don't. A hand is the one shape drawn below the portrait.
export type Shape = { ball: true; c: V; r: number; light?: boolean; hand?: boolean } | { ball: false; a: V; b: V; ra: number; rb: number }

const COCKPIT_EYE = at(POSE.eye[0], POSE.eye[1], POSE.eye[2])
const EYE = sub(COCKPIT_EYE, [0, NECK_DROP, 0])

// The figure looking along look, with its body and head raised by lift, in meters, and each hand
// moved by its offset from where it holds the portrait's edge.
function figure(look: V, lift: { body: number; head: number; hands: V[] } = { body: 0, head: 0, hands: [[0, 0, 0], [0, 0, 0]] }): Shape[] {
  const head = add(sub(EYE, scale(look, SPEC.head.eyeForward)), [0, lift.head, 0])
  // The chest sits between the hips and the head's center, so it leans a little as the head turns.
  const chest = add(scale(sub(COCKPIT_EYE, scale(look, SPEC.head.eyeForward)), SPEC.chest.at), [0, lift.body, 0])
  const R = SPEC.head.radius, r = SPEC.nose.radius, rt = r * SPEC.nose.tip
  // The nose leaves the head where its radius meets the head's surface, and its tip is a ball.
  const out = Math.sqrt(R * R - r * r)
  const shapes: Shape[] = [
    { ball: true, c: [0, lift.body, 0], r: SPEC.hips.radius },
    { ball: true, c: chest, r: SPEC.chest.radius, light: true },
    { ball: true, c: head, r: R },
    { ball: false, a: add(head, scale(look, out)), b: add(head, scale(look, R + SPEC.nose.length - rt)), ra: r, rb: rt },
  ]
  for (const side of [-1, 1]) {
    const shoulder = add(chest, at(0, (side * SPEC.shoulders.width) / 2, -SPEC.shoulders.down))
    const which = side < 0 ? 1 : 0
    const hand = add(HANDS[which], lift.hands[which])
    shapes.push({ ball: false, a: shoulder, b: hand, ra: SPEC.arm.radius, rb: SPEC.arm.radius }, { ball: true, c: hand, r: SPEC.hand.radius, hand: true })
  }
  return shapes
}

// A portrait lens: far back and long, so the figure keeps its proportions, framed from the top of
// the hips to a little above the head.
const CAMERA = { from: [0, 0.6, 3.3] as V, to: [0, 0.45, 0] as V, fov: 10.7 }
const FWD = unit(sub(CAMERA.to, CAMERA.from))
const RIGHT = unit(cross(FWD, [0, 1, 0]))
const UP = cross(RIGHT, FWD)
const TAN = Math.tan((CAMERA.fov * Math.PI) / 360)

// Where a point lands in the portrait, from 0 to 1 across and down, and how far from the camera.
function project(p: V): [number, number, number] {
  const d = sub(p, CAMERA.from)
  const z = dot(d, FWD)
  return [(dot(d, RIGHT) / (z * TAN) + 1) / 2, (1 - dot(d, UP) / (z * TAN)) / 2, z]
}
export const HEAD_IN_PORTRAIT = project(sub(EYE, [0, 0, SPEC.head.eyeForward]))

// The point a given distance in front of the hips that lands at a place in the portrait.
function inPortrait(across: number, down: number, fwd: number): V {
  const rd = unit(add(FWD, add(scale(RIGHT, (across * 2 - 1) * TAN), scale(UP, (1 - down * 2) * TAN))))
  return add(CAMERA.from, scale(rd, (fwd - CAMERA.from[2]) / rd[2]))
}
// The hands hold the portrait's bottom edge near its corners, just clear of their rounding, a
// little in front of the hips, with the bottom quarter of each hand over the edge.
const HOLD = { across: 0.15, fwd: 0.25, over: 0.25 }
const HANDS = [HOLD.across, 1 - HOLD.across].map((across) => {
  const z = project(inPortrait(across, 1, HOLD.fwd))[2]
  const r = SPEC.hand.radius / (2 * z * TAN)
  return inPortrait(across, 1 - r * (1 - 2 * HOLD.over), HOLD.fwd)
})
// How far the canvas reaches below the portrait, as a share of its width: enough for the part of
// each hand over the edge and the faint shadow it casts on the page.
export const OVERHANG = 0.1

// Studio light: a soft key high on the left, a cool fill from the right, a rim from behind on the
// right that outlines the shapes against the backdrop, and a sky-and-floor ambient. The session
// card's cockpit (cockpit-scene.tsx) lights its scene with the same, so the figures in it match.
export const KEY = { dir: unit([-0.6, 0.75, 0.6]), color: [1.0, 0.96, 0.9] as V, power: 1.2, softness: 2.5 }
export const FILL = { dir: unit([0.85, 0.1, 0.55]), color: [0.75, 0.83, 1.0] as V, power: 0.28 }
export const RIM = { dir: unit([0.6, 0.5, -0.65]), color: [1.0, 0.98, 0.95] as V, power: 1.1 }
export const SKY: V = [0.42, 0.45, 0.52]
export const FLOOR: V = [0.16, 0.14, 0.13]
const ROUGHNESS = 0.72

// The ray tests, shade, display, and both figures' passes run for every pixel of every pass, where
// a fresh 3-element array for each vector step, as the helpers above make, costs a third to half
// of a pass's time. So they work on plain numbers, a ray as its origin's three and its direction's
// three, and write what they find into arrays they're handed. The standing figure's pass took 62ms
// with the helpers and 33ms with plain numbers, and the portrait's 14ms and 9ms (measured in Node
// 22 on the development PC, at 390 by 720 pixels and 195 across, 2026-10-29).
//
// Where hitStick leaves the normal at its hit. The next call overwrites it, so a caller copies it out.
export const hitNormal: V = [0, 0, 0]

export function hitBall(rox: number, roy: number, roz: number, rdx: number, rdy: number, rdz: number, c: V, r: number) {
  const ox = rox - c[0], oy = roy - c[1], oz = roz - c[2]
  const b = ox * rdx + oy * rdy + oz * rdz
  const h = b * b - (ox * ox + oy * oy + oz * oz - r * r)
  return h < 0 ? -1 : -b - Math.sqrt(h)
}

// A ray against a stick with rounded ends, after Inigo Quilez's round cone intersection
// (iquilezles.org/articles/intersectors). It leaves the normal in hitNormal.
export function hitStick(rox: number, roy: number, roz: number, rdx: number, rdy: number, rdz: number, s: Extract<Shape, { ball: false }>) {
  const { a, b, ra, rb } = s
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2]
  const oax = rox - a[0], oay = roy - a[1], oaz = roz - a[2]
  const obx = rox - b[0], oby = roy - b[1], obz = roz - b[2]
  const rr = ra - rb
  const m0 = bax * bax + bay * bay + baz * baz
  const m1 = bax * oax + bay * oay + baz * oaz
  const m2 = bax * rdx + bay * rdy + baz * rdz
  const m3 = rdx * oax + rdy * oay + rdz * oaz
  const m5 = oax * oax + oay * oay + oaz * oaz
  const m6 = obx * rdx + oby * rdy + obz * rdz
  const m7 = obx * obx + oby * oby + obz * obz
  const d2 = m0 - rr * rr
  const k2 = d2 - m2 * m2
  const k1 = d2 * m3 - m1 * m2 + m2 * rr * ra
  const k0 = d2 * m5 - m1 * m1 + m1 * rr * ra * 2 - m0 * ra * ra
  const h = k1 * k1 - k0 * k2
  // A ray along the stick's axis never crosses its side, so the ends are tried whatever the side says.
  if (h >= 0 && Math.abs(k2) > 1e-12) {
    const t = (-Math.sqrt(h) - k1) / k2
    const y = m1 - ra * rr + t * m2
    if (y > 0 && y < d2) {
      const nx = (oax + rdx * t) * d2 - bax * y, ny = (oay + rdy * t) * d2 - bay * y, nz = (oaz + rdz * t) * d2 - baz * y
      const toUnit = 1 / Math.hypot(nx, ny, nz)
      hitNormal[0] = nx * toUnit
      hitNormal[1] = ny * toUnit
      hitNormal[2] = nz * toUnit
      return t
    }
  }
  const h1 = m3 * m3 - m5 + ra * ra
  const h2 = m6 * m6 - m7 + rb * rb
  let best = -1
  if (h1 > 0) {
    best = -m3 - Math.sqrt(h1)
    const toUnit = 1 / ra
    hitNormal[0] = (oax + rdx * best) * toUnit
    hitNormal[1] = (oay + rdy * best) * toUnit
    hitNormal[2] = (oaz + rdz * best) * toUnit
  }
  if (h2 > 0) {
    const t = -m6 - Math.sqrt(h2)
    if (best < 0 || t < best) {
      best = t
      const toUnit = 1 / rb
      hitNormal[0] = (obx + rdx * t) * toUnit
      hitNormal[1] = (oby + rdy * t) * toUnit
      hitNormal[2] = (obz + rdz * t) * toUnit
    }
  }
  return best
}

// How much a ball lets the key light through to a point, softening with distance like a large
// light's shadow, after Quilez's sphere soft shadow. The ray starts at (ox, oy, oz) from the ball's
// center and runs toward the key light.
function softShadow(ox: number, oy: number, oz: number, r: number) {
  const b = ox * KEY.dir[0] + oy * KEY.dir[1] + oz * KEY.dir[2]
  const h = b * b - (ox * ox + oy * oy + oz * oz - r * r)
  const d = Math.sqrt(Math.max(0, r * r - h)) - r
  const t = -b - Math.sqrt(Math.max(h, 0))
  if (t < 0) return 1
  const x = clamp01((KEY.softness * d) / t)
  return x * x * (3 - 2 * x)
}

// The color of the shape at index self at the point (px, py, pz), where its normal is (nx, ny, nz)
// and the camera lies along (vx, vy, vz), written into out.
export function shade(px: number, py: number, pz: number, nx: number, ny: number, nz: number, vx: number, vy: number, vz: number, shapes: Shape[], self: number, albedo: V, out: V) {
  const kx = KEY.dir[0], ky = KEY.dir[1], kz = KEY.dir[2]
  const lit = nx * kx + ny * ky + nz * kz
  const rox = px + nx * 1e-4, roy = py + ny * 1e-4, roz = pz + nz * 1e-4
  let ao = 1, shadow = 1
  for (let k = 0; k < shapes.length; k++) {
    if (k === self) continue
    const s = shapes[k]
    // A stick's ball nearest the point, (cx, cy, cz) with radius r, stands in for the stick when it
    // darkens the point.
    let cx: number, cy: number, cz: number, r: number
    let bax = 0, bay = 0, baz = 0, bb = 0
    if (s.ball) {
      cx = s.c[0]
      cy = s.c[1]
      cz = s.c[2]
      r = s.r
    } else {
      const a = s.a
      bax = s.b[0] - a[0]
      bay = s.b[1] - a[1]
      baz = s.b[2] - a[2]
      bb = bax * bax + bay * bay + baz * baz
      const t = clamp01(((px - a[0]) * bax + (py - a[1]) * bay + (pz - a[2]) * baz) / bb)
      cx = a[0] + bax * t
      cy = a[1] + bay * t
      cz = a[2] + baz * t
      r = s.ra + (s.rb - s.ra) * t
    }
    const dx = cx - px, dy = cy - py, dz = cz - pz
    const l2 = dx * dx + dy * dy + dz * dz
    // A shape more than about 20 radii away darkens the point by under 0.25%, so it's skipped.
    if (r * r > 0.0025 * l2) ao *= 1 - clamp01(((nx * dx + ny * dy + nz * dz) / Math.sqrt(l2)) * ((r * r) / l2))
    if (lit > 0 && shadow > 0) {
      if (s.ball) shadow = Math.min(shadow, softShadow(rox - cx, roy - cy, roz - cz, r))
      else {
        // A stick's ball nearest the ray toward the key light stands in for the stick when it
        // shades the ray's start.
        const a = s.a
        const wx = a[0] - rox, wy = a[1] - roy, wz = a[2] - roz
        const b = bax * kx + bay * ky + baz * kz
        const d = bax * wx + bay * wy + baz * wz
        const e = kx * wx + ky * wy + kz * wz
        const den = bb - b * b
        const t = den > 1e-12 ? clamp01((b * e - d) / den) : 0
        shadow = Math.min(shadow, softShadow(rox - (a[0] + bax * t), roy - (a[1] + bay * t), roz - (a[2] + baz * t), s.ra + (s.rb - s.ra) * t))
      }
    }
  }
  const sky = 0.5 + 0.5 * ny
  const key = Math.max(0, lit)
  const fill = Math.max(0, nx * FILL.dir[0] + ny * FILL.dir[1] + nz * FILL.dir[2])
  const rim = Math.max(0, nx * RIM.dir[0] + ny * RIM.dir[1] + nz * RIM.dir[2])
  const aoRoot = Math.sqrt(ao)
  // A broad, faint highlight, since the in-sim material is rough.
  const hx = kx + vx, hy = ky + vy, hz = kz + vz
  const toUnit = 1 / Math.hypot(hx, hy, hz)
  const halfX = hx * toUnit, halfY = hy * toUnit, halfZ = hz * toUnit
  const nh = Math.max(0, nx * halfX + ny * halfY + nz * halfZ)
  const a2 = ROUGHNESS ** 4
  const ggx = a2 / (Math.PI * (nh * nh * (a2 - 1) + 1) ** 2)
  const fresnel = 0.04 + 0.96 * (1 - Math.max(0, halfX * vx + halfY * vy + halfZ * vz)) ** 5
  const spec = ggx * fresnel * key * shadow * KEY.power * 0.25
  for (let i = 0; i < 3; i++) {
    const light =
      (FLOOR[i] + (SKY[i] - FLOOR[i]) * sky) * ao +
      KEY.color[i] * KEY.power * key * shadow +
      FILL.color[i] * FILL.power * fill * aoRoot +
      RIM.color[i] * RIM.power * rim * ao
    out[i] = albedo[i] * light + spec
  }
}

// Keeps a color's hue while it rolls its brightest channel off toward white, so a lit side never
// clips to a flat patch, and encodes it for the screen, in place.
export function display(c: V) {
  const m = Math.max(c[0], c[1], c[2])
  const k = m > 0.7 ? (0.7 + 0.3 * (1 - Math.exp(-(m - 0.7) / 0.3))) / m : 1
  for (let i = 0; i < 3; i++) {
    const v = clamp01(c[i] * k)
    c[i] = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  }
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
export function albedos(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const srgb = [16, 8, 0].map((s) => ((n >> s) & 255) / 255)
  return { main: srgb.map(linear) as V, light: srgb.map((c) => linear(c + (1 - c) * SPEC.lighten)) as V }
}

// Each hand's soft shadow on the page below the portrait: its center, a little under the hand's,
// and its radius, in the portrait's units of 0 to 1 across.
const HAND_SHADOWS = HANDS.map((h) => {
  const [x, y, z] = project(h)
  const r = SPEC.hand.radius / (2 * z * TAN)
  return { x, y: y + 0.35 * r, r: 1.25 * r }
})

// Where in its pixel each pass sends its ray: the center first, then the R2 sequence, which spreads
// any number of rays evenly over the pixel, so the edges smooth a little more with every pass.
export function offset(pass: number): [number, number] {
  return pass === 0 ? [0.5, 0.5] : [(0.5 + pass * 0.7548776662) % 1, (0.5 + pass * 0.569840291) % 1]
}

// One ray for each pixel of the portrait, size pixels across, and of the strip below it where the
// hands hang over the edge, added into sum: each pixel's color weighted by its opacity, then the
// opacity, since a shadow is translucent black. Under the portrait's bottom edge only the hands
// and their shadows draw, so the body stays cropped there. Each hand's shadow shows by its share
// in shadows, which fades it while the hand is off the edge.
function pass(sum: Float32Array, size: number, shapes: Shape[], colors: { main: V; light: V }, shadows: number[], n: number) {
  const [ox, oy] = offset(n)
  const height = sum.length / 4 / size
  const rox = CAMERA.from[0], roy = CAMERA.from[1], roz = CAMERA.from[2]
  const color: V = [0, 0, 0]
  for (let j = 0; j < height; j++) {
    const down = (j + oy) / size
    const below = down > 1
    const up = (1 - down * 2) * TAN
    const upX = UP[0] * up, upY = UP[1] * up, upZ = UP[2] * up
    for (let i = 0; i < size; i++) {
      const across = (i + ox) / size
      const right = (across * 2 - 1) * TAN
      const dx = FWD[0] + (RIGHT[0] * right + upX), dy = FWD[1] + (RIGHT[1] * right + upY), dz = FWD[2] + (RIGHT[2] * right + upZ)
      const toUnit = 1 / Math.hypot(dx, dy, dz)
      const rdx = dx * toUnit, rdy = dy * toUnit, rdz = dz * toUnit
      let best = Infinity, self = -1, nx = 0, ny = 0, nz = 0
      for (let k = 0; k < shapes.length; k++) {
        const s = shapes[k]
        if (below && !(s.ball && s.hand)) continue
        const t = s.ball ? hitBall(rox, roy, roz, rdx, rdy, rdz, s.c, s.r) : hitStick(rox, roy, roz, rdx, rdy, rdz, s)
        if (t > 0 && t < best) {
          best = t
          self = k
          if (!s.ball) {
            nx = hitNormal[0]
            ny = hitNormal[1]
            nz = hitNormal[2]
          }
        }
      }
      const o = (j * size + i) * 4
      if (self >= 0) {
        const s = shapes[self]
        const px = rox + rdx * best, py = roy + rdy * best, pz = roz + rdz * best
        if (s.ball) {
          const toUnit = 1 / s.r
          nx = (px - s.c[0]) * toUnit
          ny = (py - s.c[1]) * toUnit
          nz = (pz - s.c[2]) * toUnit
        }
        shade(px, py, pz, nx, ny, nz, -rdx, -rdy, -rdz, shapes, self, s.ball && s.light ? colors.light : colors.main, color)
        display(color)
        sum[o] += color[0]
        sum[o + 1] += color[1]
        sum[o + 2] += color[2]
        sum[o + 3] += 1
      } else if (below) {
        for (let k = 0; k < HAND_SHADOWS.length; k++) {
          const h = HAND_SHADOWS[k]
          const d = Math.hypot(across - h.x, down - h.y) / h.r
          const x = clamp01((d - 0.35) / 0.65)
          sum[o + 3] += 0.15 * shadows[k] * (1 - x * x * (3 - 2 * x))
        }
      }
    }
  }
}

// Draws the average of the passes so far. The backdrop stays clear, so the box behind the canvas
// draws it.
export function present(ctx: CanvasRenderingContext2D, sum: Float32Array, size: number, passes: number) {
  const img = ctx.createImageData(size, sum.length / 4 / size)
  const px = img.data
  for (let o = 0; o < sum.length; o += 4) {
    const alpha = sum[o + 3]
    if (!alpha) continue
    px[o] = (sum[o] / alpha) * 255
    px[o + 1] = (sum[o + 1] / alpha) * 255
    px[o + 2] = (sum[o + 2] / alpha) * 255
    px[o + 3] = (alpha / passes) * 255
  }
  ctx.putImageData(img, 0, 0)
}

// Each frame runs as many passes as fit in this many milliseconds, and at least one after the
// figure moves, so a slow engine moves it at a lower frame rate rather than stalling.
const FRAME_BUDGET = 8
const MOST_PASSES = 32

// A startle when the pilot picks another color: the body jolts up and settles with a small bounce,
// the head lagging a moment and tipping back, and the hands nearly lose their grip, popping off the
// edge one after the other, drawing in toward the chest as they rise, back and inward by those
// shares of their lift, and grabbing the edge again. The long lens barely shows the move back, so
// the move inward is what reads. Times are in seconds, the height in meters.
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
const LAST_LAG = Math.max(STARTLE.head.lag, ...STARTLE.hands.map((h) => h.lag))
// A hand this far off the edge, in meters, has lost its shadow.
const SHADOW_GONE = 0.015

// The startle's rise at t seconds in, as a damped bounce that's 1 at its peak and 0 once it ends.
function jolt(t: number) {
  if (t < 0 || t >= STARTLE.length) return 0
  const w = Math.PI / 2 / STARTLE.peak
  return (Math.exp(-STARTLE.decay * t) * Math.sin(w * t)) / Math.exp(-STARTLE.decay * STARTLE.peak)
}

// A hand's lift at t seconds in, 1 at its highest: it flicks up, slowing, then comes down faster
// and faster and stops dead on the edge, as a hand grabs for support, with no bounce.
function grab(t: number) {
  const { rise, fall } = STARTLE.grab
  if (t < 0 || t >= rise + fall) return 0
  if (t < rise) return Math.sin((Math.PI / 2) * (t / rise))
  const u = (t - rise) / fall
  return 1 - u * u
}

// The portrait eases its head toward aim, a unit direction in the render's axes, a little each
// frame, and startles when hex changes. Each move starts the passes afresh, and while the figure
// rests they add up to smooth the edges, MOST_PASSES rays a pixel at most.
export function FigurePortrait({ hex, aim }: { hex: string; aim: React.MutableRefObject<V> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const look = useRef<V | null>(null)
  const color = useRef({ hex, startled: -Infinity })

  useEffect(() => {
    if (hex !== color.current.hex) color.current = { hex, startled: performance.now() }
  }, [hex])

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext("2d")
    if (!el || !ctx) return
    // Coherent GT drops aspect-ratio, so the canvas's height is set from its width here.
    el.style.height = `${el.clientWidth * (1 + OVERHANG)}px`
    const size = Math.round(el.clientWidth * (window.devicePixelRatio || 1))
    el.width = size
    el.height = Math.round(size * (1 + OVERHANG))
    look.current ??= aim.current
    let drawnHex = color.current.hex
    let colors = albedos(drawnHex)
    const sum = new Float32Array(el.width * el.height * 4)
    let shapes = figure(look.current)
    let shadows = [1, 1]
    let passes = 0
    let frame = 0
    const tick = () => {
      const from = look.current!
      const next = unit(add(from, scale(sub(aim.current, from), 0.12)))
      const turning = Math.hypot(...sub(next, from)) > 2e-4
      const since = (performance.now() - color.current.startled) / 1000
      // One frame past the last part's end, so the figure draws once more at rest.
      const startling = since < STARTLE.length + LAST_LAG + 0.05
      if (color.current.hex !== drawnHex) {
        drawnHex = color.current.hex
        colors = albedos(drawnHex)
      }
      if (turning || startling || passes === 0) {
        look.current = next
        const head = jolt(since - STARTLE.head.lag)
        const lifts = STARTLE.hands.map((h) => STARTLE.height * h.gain * grab(since - h.lag))
        shapes = figure(unit(add(next, [0, STARTLE.head.tip * head, 0])), {
          body: STARTLE.height * jolt(since),
          head: STARTLE.height * STARTLE.head.gain * head,
          hands: lifts.map((lift, k): V => [-Math.sign(HANDS[k][0]) * STARTLE.grab.inward * lift, lift, -STARTLE.grab.back * lift]),
        })
        shadows = lifts.map((lift) => 1 - clamp01(lift / SHADOW_GONE))
        sum.fill(0)
        passes = 0
      }
      const start = performance.now()
      let ran = 0
      while (passes < MOST_PASSES && (ran === 0 || performance.now() - start < FRAME_BUDGET)) {
        pass(sum, size, shapes, colors, shadows, passes)
        passes++
        ran++
      }
      if (ran) present(ctx, sum, size, passes)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [aim])

  // The canvas spans the portrait's box and hangs below it, so the box must not clip it.
  return <canvas ref={canvas} style={{ position: "absolute", left: 0, top: 0, width: "100%" }} />
}
