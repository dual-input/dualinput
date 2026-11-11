// The splash Velopack's Setup.exe shows while it installs, src/apps/desktop/icons/splash.gif: a pixel-art night
// approach in a Cessna 172 at 65 kt down a 3-degree path toward a runway lit with ALSF-2 approach lights.
//
//   node tools/splash.ts    writes src/apps/desktop/icons/splash.gif
//
// Everything random is seeded, so the same code and the same sharp write the same file byte for byte. To change the
// picture, change this file, run it, and look at the GIF.

import path from "node:path"

import sharp from "sharp"

import { colors } from "../src/packages/ui/palette/palette.ts"
import { ROOT } from "./lib/repo.ts"
import { main } from "./lib/run.ts"

const OUT = path.join(ROOT, "src", "apps", "desktop", "icons", "splash.gif")

// The camera projects onto a 640x360 view, and each 4x4 square of it is one art pixel, a 160x90 grid. The GIF draws
// each art pixel as 3x3, so the splash is 480x270.
const VIEW_WIDTH = 640
const VIEW_HEIGHT = 360
const ART = 4
const GRID_WIDTH = VIEW_WIDTH / ART
const GRID_HEIGHT = VIEW_HEIGHT / ART
const BLOCK = 3

// The flight: 4.5s at 12.5 fps, from 420 m before the threshold, at 33 m/s (65 kt), on a 3-degree path that crosses
// the threshold at 15 m.
const DELAY_MS = 80
const FRAMES = Math.round((4.5 * 100) / (DELAY_MS / 10))
const FROM = 420
const SPEED = 33
const GLIDE = Math.tan((3 * Math.PI) / 180)
const FOCAL = (720 * VIEW_HEIGHT) / 344
const HORIZON = VIEW_HEIGHT * 0.4

type Rgb = readonly [number, number, number]
const rgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

// The lights are the kit's own amber, red, and green; the sky and ground are darks between the kit's background and
// its sky blue.
const COLOR = {
  background: rgb(colors.background),
  night1: rgb("#0d161b"),
  night2: rgb("#112530"),
  night3: rgb("#1a3b4b"),
  skyDim: rgb("#2e6d8a"),
  white: rgb("#f4fbff"),
  amber: rgb(colors.warning),
  amberDim: rgb("#7d6127"),
  red: rgb(colors.destructive),
  redDim: rgb("#6e3533"),
  green: rgb(colors.success),
  greenDim: rgb("#2f6b40"),
  ground: rgb("#070808"),
  ridge: rgb("#080c0f"),
}
type ColorName = keyof typeof COLOR

type Kind = "approach" | "siderow" | "threshold" | "edge" | "edgeAmber" | "end" | "center" | "centerRed" | "tdz" | "papiRed" | "papiWhite"

/** Each kind of light's color close up, and far off, where it dims. */
const LOOK: Record<Kind, readonly [ColorName, ColorName]> = {
  approach: ["amber", "amberDim"],
  siderow: ["red", "redDim"],
  threshold: ["green", "greenDim"],
  edge: ["white", "skyDim"],
  edgeAmber: ["amber", "amberDim"],
  end: ["red", "redDim"],
  center: ["white", "skyDim"],
  centerRed: ["red", "redDim"],
  tdz: ["white", "skyDim"],
  papiRed: ["red", "redDim"],
  papiWhite: ["white", "skyDim"],
}

/** How close, in meters, each kind of light has to be to show its full color; 1,400 for the kinds not named. */
const FULL_COLOR: Partial<Record<Kind, number>> = { center: 700, centerRed: 700, edge: 1300, edgeAmber: 4000, end: 4000, tdz: 260 }

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const
const bayer = (x: number, y: number): number => BAYER[y % 4]![x % 4]!

/** A seeded random number from 0 to 1 (mulberry32). */
function random(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Light {
  x: number
  s: number
  kind: Kind
}

/**
 * The runway's lights in meters: x across the runway, left negative, and s along it from the threshold, the approach
 * negative. The runway is 3,000 m long and 45 m wide.
 */
function lights(): Light[] {
  const out: Light[] = []
  const add = (x: number, s: number, kind: Kind) => out.push({ x, s, kind })
  const length = 3000
  const edge = 23.5

  // ALSF-2: a barrette of five every 100 ft out to 2,400 ft, red side rows inside 1,000 ft, and crossbars at 1,000 and
  // 500 ft. Its sequenced flashers only flash, so they aren't drawn.
  for (let k = 1; k <= 24; k++) {
    const s = -30 * k
    for (const x of [-2.1, -1.05, 0, 1.05, 2.1]) add(x, s, "approach")
    if (s >= -270) for (const side of [-1, 1]) for (const x of [10.5, 11.55, 12.6]) add(side * x, s, "siderow")
  }
  for (let x = 4.5; x <= 15; x += 1.5) for (const side of [-1, 1]) add(side * x, -300, "approach")
  for (let x = 3.6; x <= 7.5; x += 1.3) for (const side of [-1, 1]) add(side * x, -150, "approach")

  for (let x = -25.5; x <= 25.5; x += 3) add(x, 0, "threshold")
  // Edge lights every 200 ft, amber over the last 2,000 ft as seen from the approach.
  for (let s = 0; s <= length; s += 60) {
    const kind = s >= length - 600 ? "edgeAmber" : "edge"
    add(-edge, s, kind)
    add(edge, s, kind)
  }
  for (let x = -22.5; x <= 22.5; x += 3) add(x, length, "end")
  // Centerline every 50 ft: white, then red and white alternating from 3,000 ft to 1,000 ft remaining, then red.
  let n = 0
  for (let s = 7.5; s < length; s += 15, n++) {
    const left = length - s
    add(0, s, left <= 300 ? "centerRed" : left <= 900 ? (n % 2 ? "centerRed" : "center") : "center")
  }
  // Touchdown zone: barrettes of three either side of the centerline, out to 3,000 ft.
  for (let s = 30; s <= 900; s += 30) for (const side of [-1, 1]) for (const x of [9, 9.9, 10.8]) add(side * x, s, "tdz")
  // PAPI on the left, on the glide path: two red inboard, two white outboard.
  for (let i = 0; i < 4; i++) add(-(edge + 15 + 9 * i), 300, i < 2 ? "papiRed" : "papiWhite")
  return out
}

/** One frame on the 160x90 grid as RGBA, from `d` meters before the threshold, `t` of the way through the flight. */
function frame(d: number, t: number): Buffer {
  const buf = Buffer.alloc(GRID_WIDTH * GRID_HEIGHT * 4)
  const set = (x: number, y: number, c: Rgb) => {
    if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return
    const i = (y * GRID_WIDTH + x) * 4
    buf[i] = c[0]
    buf[i + 1] = c[1]
    buf[i + 2] = c[2]
    buf[i + 3] = 255
  }
  const height = 15 + d * GLIDE
  const project = (x: number, s: number, up = 0) => {
    const z = d + s
    return { x: VIEW_WIDTH / 2 + (FOCAL * x) / z, y: HORIZON + (FOCAL * (height - up)) / z, z }
  }
  const horizon = Math.round(HORIZON / ART)

  // Sky and ground in Bayer-dithered steps between neighboring shades, lightest toward the horizon.
  const ramp = (t: number, x: number, y: number, steps: readonly ColorName[]): Rgb => {
    const pos = t * (steps.length - 1)
    const at = Math.floor(pos)
    const pick = (pos - at) * 16 > bayer(x, y) ? at + 1 : at
    return COLOR[steps[Math.min(pick, steps.length - 1)]!]
  }
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (y < horizon) {
        const toward = Math.pow(y / horizon, 2.2)
        // The glow is strongest above the runway's far end.
        const centered = 1 - Math.min(1, Math.abs(x - GRID_WIDTH / 2) / (GRID_WIDTH * 0.75))
        set(x, y, ramp(Math.min(1, toward * (0.55 + 0.45 * centered)), x, y, ["background", "night1", "night2", "night3"]))
      } else {
        set(x, y, ramp(Math.max(0, 1 - (y - horizon) / 7) * 0.6, x, y, ["ground", "night1", "night2"]))
      }
    }
  }

  // A low ridge either side, leaving the runway's direction open.
  const ridge = (x: number): number => {
    const open = Math.abs(x - GRID_WIDTH / 2)
    if (open < 9) return 0
    const shape = x < GRID_WIDTH / 2 ? 2.4 + 1.5 * Math.sin(x * 0.23 + 0.6) + 0.9 * Math.sin(x * 0.11) : 2.0 + 1.4 * Math.sin(x * 0.19 + 2.1) + 1.1 * Math.sin(x * 0.07 + 0.4)
    return Math.max(0, Math.round(shape * Math.min(1, (open - 9) / 10)))
  }
  for (let x = 0; x < GRID_WIDTH; x++) for (let y = horizon - ridge(x); y < horizon; y++) set(x, y, COLOR.ridge)

  // Stars, then towns on the ridge and along the horizon, from one seeded sequence: the towns take the numbers after the
  // stars', so adding a star moves every town.
  const rand = random(5)
  const across = GRID_WIDTH / 100
  const stars: { x: number; y: number; bright: boolean }[] = []
  for (let i = 0; i < Math.round((34 * GRID_WIDTH * GRID_HEIGHT) / (100 * 86)); i++) {
    const x = Math.floor(rand() * GRID_WIDTH)
    const y = Math.floor(Math.pow(rand(), 1.5) * (horizon - 4))
    stars.push({ x, y, bright: rand() < 0.3 })
  }
  for (const [i, star] of stars.entries()) {
    if (star.y >= horizon - ridge(star.x)) continue
    // Every sixth star dips once over the flight, each at its own moment.
    const twinkle = i % 6 === 0 && Math.abs(((t - i / 34 + 1) % 1) - 0.5) < 0.04
    set(star.x, star.y, star.bright !== twinkle ? COLOR.white : COLOR.skyDim)
  }
  for (const [at, count] of [[7, 5], [19, 4], [30, 6], [69, 5], [82, 4], [93, 6]] as const) {
    for (let i = 0; i < Math.round(count * across); i++) {
      const x = Math.round(at * across + (rand() - 0.5) * 7 * across)
      const top = horizon - ridge(x)
      const y = top + Math.floor(rand() * (horizon - top + 2))
      set(x, y, rand() < 0.65 ? COLOR.amberDim : rand() < 0.6 ? COLOR.amber : COLOR.white)
    }
  }

  // Far lights first, so near ones draw over them, but the threshold last, over the approach lights beside it.
  // The touchdown zone's barrettes show only close up: far off, they fill the runway into a white wedge.
  const shown = lights()
    .map((l) => ({ kind: l.kind, ...project(l.x, l.s) }))
    .filter((l) => l.z > 1 && (l.kind !== "tdz" || l.z < 260))
    .map((l) => ({ ...l, px: Math.floor(l.x / ART), py: Math.floor(l.y / ART) }))
    .filter((l) => l.px > -4 && l.px < GRID_WIDTH + 4 && l.py < GRID_HEIGHT + 4)
    .sort((a, b) => Number(a.kind === "threshold") - Number(b.kind === "threshold") || b.z - a.z)
  for (const l of shown) {
    const dim = COLOR[LOOK[l.kind][1]]
    if (l.z < 70) {
      // Close: a 2x2 light in a ring of glow.
      for (const [dx, dy] of [[-1, 0], [-1, 1], [2, 0], [2, 1], [0, -1], [1, -1], [0, 2], [1, 2]] as const) set(l.px + dx, l.py + dy, dim)
    } else if (l.z < 170) {
      // Near: a lit pixel in a plus of glow.
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) set(l.px + dx, l.py + dy, dim)
    }
  }
  for (const l of shown) {
    const [bright, dim] = LOOK[l.kind]
    const c = COLOR[l.z < (FULL_COLOR[l.kind] ?? 1400) ? bright : dim]
    set(l.px, l.py, c)
    if (l.z < 70) {
      set(l.px + 1, l.py, c)
      set(l.px, l.py + 1, c)
      set(l.px + 1, l.py + 1, c)
    }
  }

  // The airport's rotating beacon on its tower, right of the field: a white flash, then a green one, as its beam sweeps
  // past, over a steady red obstruction light.
  const beacon = project(95, 240, 20)
  const bx = Math.floor(beacon.x / ART)
  const by = Math.floor(beacon.y / ART)
  set(bx, by + 1, COLOR.redDim)
  for (const [center, bright, dim] of [[0.25, "white", "skyDim"], [0.75, "green", "greenDim"]] as const) {
    const strength = 1 - Math.abs(t - center) / 0.035
    if (strength > 0.6) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1]] as const) set(bx + dx, by + dy, COLOR[dim])
      set(bx, by, COLOR[bright])
    } else if (strength > 0.15) {
      set(bx, by, COLOR[dim])
    }
  }
  return buf
}

main(async () => {
  const width = GRID_WIDTH * BLOCK
  const height = GRID_HEIGHT * BLOCK
  const frames: Buffer[] = []
  for (let i = 0; i < FRAMES; i++) {
    const grid = frame(FROM - (SPEED * 4.5 * i) / FRAMES, i / FRAMES)
    frames.push(await sharp(grid, { raw: { width: GRID_WIDTH, height: GRID_HEIGHT, channels: 4 } }).resize(width, height, { kernel: "nearest" }).raw().toBuffer())
  }
  // Velopack plays every frame at one delay, the average of the frames' delays, so they all get the same one (read in
  // Velopack 1.2.161, src/bins/src/windows/splash.rs, SplashWindow::run).
  await sharp(Buffer.concat(frames), { raw: { width, height: height * FRAMES, channels: 4, pageHeight: height } })
    .gif({ delay: Array<number>(FRAMES).fill(DELAY_MS), loop: 0, dither: 0, colours: 32, effort: 10 })
    .toFile(OUT)
  console.log(`${path.relative(ROOT, OUT)} written: ${width}x${height}, ${FRAMES} frames at ${DELAY_MS} ms`)
})
