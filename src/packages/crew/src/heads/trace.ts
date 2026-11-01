// How a pilot's head is drawn: a ball and a tapered stick for its nose, at the sizes of the figure their
// crew sees in the sim, lit like a studio photo, one ray for each pixel. It needs only a 2D canvas, and
// it runs for every pixel of every pass, so it works on plain numbers: a fresh array for each vector step
// cost a third to half of a pass's time (measured in Node 22 on the development PC, 2026-10-29).

export type V = [number, number, number]

/** The figure's sizes, in meters, from the figure the crew sees in the sim, so change them together with src/features/avatars/figure/figure.json. */
export const SPEC = {
  head: { radius: 0.1 },
  nose: { radius: 0.038, length: 0.099, tip: 0.6 },
  chest: { radius: 0.134, along: 0.48 },
  hips: { radius: 0.179 },
  shoulders: { width: 0.208, down: -0.01 },
  arm: { radius: 0.015 },
  hand: { radius: 0.038 },
  lighten: 0.3,
}

export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const unit = (a: V): V => scale(a, 1 / Math.hypot(a[0], a[1], a[2]))
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** A ball, or a stick that tapers from radius `ra` at `a` to `rb` at `b`, with rounded ends. */
export type Shape = { ball: true; c: V; r: number; light?: boolean; hand?: boolean } | { ball: false; a: V; b: V; ra: number; rb: number }

/** The shapes of a head looking along `look`, from its center. The nose leaves the head where its radius meets the head's surface, and its tip is a ball. */
export function headShapes(look: V): Shape[] {
  const R = SPEC.head.radius
  const r = SPEC.nose.radius
  const tip = r * SPEC.nose.tip
  return [
    { ball: true, c: [0, 0, 0], r: R },
    { ball: false, a: scale(look, Math.sqrt(R * R - r * r)), b: scale(look, R + SPEC.nose.length - tip), ra: r, rb: tip },
  ]
}

// Studio light: a soft key high on the left, a cool fill from the right, a rim from behind on the right
// that outlines the shapes against the backdrop, and a sky-and-floor ambient.
const KEY = { dir: unit([-0.6, 0.75, 0.6]), color: [1.0, 0.96, 0.9] as V, power: 1.2, softness: 2.5 }
const FILL = { dir: unit([0.85, 0.1, 0.55]), color: [0.75, 0.83, 1.0] as V, power: 0.28 }
const RIM = { dir: unit([0.6, 0.5, -0.65]), color: [1.0, 0.98, 0.95] as V, power: 1.1 }
const SKY: V = [0.42, 0.45, 0.52]
const FLOOR: V = [0.16, 0.14, 0.13]
const ROUGHNESS = 0.72

/** Where `hitStick` leaves the normal at its hit. The next call overwrites it, so a caller copies it out. */
export const hitNormal: V = [0, 0, 0]

export function hitBall(rox: number, roy: number, roz: number, rdx: number, rdy: number, rdz: number, c: V, r: number): number {
  const ox = rox - c[0]
  const oy = roy - c[1]
  const oz = roz - c[2]
  const b = ox * rdx + oy * rdy + oz * rdz
  const h = b * b - (ox * ox + oy * oy + oz * oz - r * r)
  return h < 0 ? -1 : -b - Math.sqrt(h)
}

/** A ray against a stick with rounded ends, after Inigo Quilez's round cone intersection (iquilezles.org/articles/intersectors). */
export function hitStick(rox: number, roy: number, roz: number, rdx: number, rdy: number, rdz: number, s: Extract<Shape, { ball: false }>): number {
  const { a, b, ra, rb } = s
  const bax = b[0] - a[0]
  const bay = b[1] - a[1]
  const baz = b[2] - a[2]
  const oax = rox - a[0]
  const oay = roy - a[1]
  const oaz = roz - a[2]
  const obx = rox - b[0]
  const oby = roy - b[1]
  const obz = roz - b[2]
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
      const nx = (oax + rdx * t) * d2 - bax * y
      const ny = (oay + rdy * t) * d2 - bay * y
      const nz = (oaz + rdz * t) * d2 - baz * y
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
    hitNormal[0] = (oax + rdx * best) / ra
    hitNormal[1] = (oay + rdy * best) / ra
    hitNormal[2] = (oaz + rdz * best) / ra
  }
  if (h2 > 0) {
    const t = -m6 - Math.sqrt(h2)
    if (best < 0 || t < best) {
      best = t
      hitNormal[0] = (obx + rdx * t) / rb
      hitNormal[1] = (oby + rdy * t) / rb
      hitNormal[2] = (obz + rdz * t) / rb
    }
  }
  return best
}

/** How much a ball lets the key light through to a point, softening with distance like a large light's shadow, after Quilez's sphere soft shadow. */
function softShadow(ox: number, oy: number, oz: number, r: number): number {
  const b = ox * KEY.dir[0] + oy * KEY.dir[1] + oz * KEY.dir[2]
  const h = b * b - (ox * ox + oy * oy + oz * oz - r * r)
  const d = Math.sqrt(Math.max(0, r * r - h)) - r
  const t = -b - Math.sqrt(Math.max(h, 0))
  if (t < 0) return 1
  const x = clamp01((KEY.softness * d) / t)
  return x * x * (3 - 2 * x)
}

/** The color of the shape at index `self` at a point, where its normal is (nx, ny, nz) and the camera lies along +z, written into `out`. */
export function shade(px: number, py: number, pz: number, nx: number, ny: number, nz: number, shapes: Shape[], self: number, albedo: V, out: V): void {
  const kx = KEY.dir[0]
  const ky = KEY.dir[1]
  const kz = KEY.dir[2]
  const lit = nx * kx + ny * ky + nz * kz
  const rox = px + nx * 1e-4
  const roy = py + ny * 1e-4
  const roz = pz + nz * 1e-4
  let ao = 1
  let shadow = 1
  for (let k = 0; k < shapes.length; k++) {
    if (k === self) continue
    const s = shapes[k]!
    // A stick's ball nearest the point, (cx, cy, cz) with radius r, stands in for the stick when it darkens the point.
    let cx: number, cy: number, cz: number, r: number
    let bax = 0
    let bay = 0
    let baz = 0
    let bb = 0
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
    const dx = cx - px
    const dy = cy - py
    const dz = cz - pz
    const l2 = dx * dx + dy * dy + dz * dz
    // A shape more than about 20 radii away darkens the point by under 0.25%, so it's skipped.
    if (r * r > 0.0025 * l2) ao *= 1 - clamp01(((nx * dx + ny * dy + nz * dz) / Math.sqrt(l2)) * ((r * r) / l2))
    if (lit > 0 && shadow > 0) {
      if (s.ball) shadow = Math.min(shadow, softShadow(rox - cx, roy - cy, roz - cz, r))
      else {
        // A stick's ball nearest the ray toward the key light stands in for the stick when it shades the ray's start.
        const a = s.a
        const wx = a[0] - rox
        const wy = a[1] - roy
        const wz = a[2] - roz
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
  const hx = kx
  const hy = ky
  const hz = kz + 1
  const toUnit = 1 / Math.hypot(hx, hy, hz)
  const halfX = hx * toUnit
  const halfY = hy * toUnit
  const halfZ = hz * toUnit
  const nh = Math.max(0, nx * halfX + ny * halfY + nz * halfZ)
  const a2 = ROUGHNESS ** 4
  const ggx = a2 / (Math.PI * (nh * nh * (a2 - 1) + 1) ** 2)
  const fresnel = 0.04 + 0.96 * (1 - Math.max(0, halfZ)) ** 5
  const spec = ggx * fresnel * key * shadow * KEY.power * 0.25
  for (let i = 0; i < 3; i++) {
    const light = (FLOOR[i]! + (SKY[i]! - FLOOR[i]!) * sky) * ao + KEY.color[i]! * KEY.power * key * shadow + FILL.color[i]! * FILL.power * fill * aoRoot + RIM.color[i]! * RIM.power * rim * ao
    out[i] = albedo[i]! * light + spec
  }
}

/** Keeps a color's hue while it rolls its brightest channel off toward white, so a lit side never clips to a flat patch, and encodes it for the screen, in place. */
export function display(c: V): void {
  const m = Math.max(c[0], c[1], c[2])
  const k = m > 0.7 ? (0.7 + 0.3 * (1 - Math.exp(-(m - 0.7) / 0.3))) / m : 1
  for (let i = 0; i < 3; i++) {
    const v = clamp01(c[i]! * k)
    c[i] = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  }
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** A color as the shading reads it. */
export function albedo(hex: string): V {
  const n = parseInt(hex.slice(1), 16)
  return [linear(((n >> 16) & 255) / 255), linear(((n >> 8) & 255) / 255), linear((n & 255) / 255)]
}

/** The lighter tint of a color, which the figure's chest wears. */
export function lightAlbedo(hex: string): V {
  const n = parseInt(hex.slice(1), 16)
  const lifted = (c: number) => linear(c + (1 - c) * SPEC.lighten)
  return [lifted(((n >> 16) & 255) / 255), lifted(((n >> 8) & 255) / 255), lifted((n & 255) / 255)]
}

/** Where in its pixel each pass sends its ray: the center first, then the R2 sequence, which spreads any number of rays evenly over the pixel, so the edges smooth a little more with every pass. */
export function offset(pass: number): [number, number] {
  return pass === 0 ? [0.5, 0.5] : [(0.5 + pass * 0.7548776662) % 1, (0.5 + pass * 0.569840291) % 1]
}

/**
 * Draws what a pass has summed over the box it reached, each pixel weighted by its opacity. The backdrop stays
 * clear, so the box behind the canvas draws it. It fills a 1px rectangle for each pixel, since Coherent GT's
 * canvas has no way to hand it pixels: `putImageData` and `drawImage` draw nothing, and `getImageData` throws
 * (record/areas/architecture/coherent-gt.md).
 */
export function present(ctx: CanvasRenderingContext2D, sum: Float32Array, size: number, box: number[]): void {
  ctx.clearRect(box[0]!, box[1]!, box[2]! - box[0]!, box[3]! - box[1]!)
  for (let j = box[1]!; j < box[3]!; j++) {
    for (let i = box[0]!; i < box[2]!; i++) {
      const o = (j * size + i) * 4
      const alpha = sum[o + 3]!
      if (alpha < 0.004) continue
      ctx.fillStyle = `rgba(${Math.round((sum[o]! / alpha) * 255)},${Math.round((sum[o + 1]! / alpha) * 255)},${Math.round((sum[o + 2]! / alpha) * 255)},${alpha})`
      ctx.fillRect(i, j, 1, 1)
    }
  }
}
