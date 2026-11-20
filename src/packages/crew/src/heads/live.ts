// What keeps the crew's heads alive in preflight: each watches the cursor while it's on the EFB, a little
// late and at its own pace, both seeded by its pilot's ID, so a sweep ripples across the crew, and rests
// when the cursor leaves. Over this pilot's unpressed Ready every head looks at it and bobs, over Leave every
// head shakes slowly, and a pilot who readies nods while the rest turn to them for a moment
// (record/areas/interface/decisions.md, "In preflight the heads watch the cursor").
//
// A head draws by one pass a frame, blended into the passes before, so its edges smooth over a few frames,
// and only while its look moves and for a few frames after, so a still cursor costs nothing. One loop draws
// every head, in at most a few milliseconds a frame. Coherent GT has no IntersectionObserver, so the loop
// measures which heads show (record/areas/architecture/coherent-gt.md, "Web APIs").

import { useLayoutEffect, useRef } from "react"
import type { RefObject } from "react"

import { albedo, display, headShapes, hitBall, hitNormal, hitStick, offset, present, shade, SPEC, unit } from "./trace.ts"
import type { Shape, V } from "./trace.ts"

/** Times in milliseconds, angles in degrees. A head reaches toward a point `lookDepth` in front of the page, so the cursor anywhere in the card turns it partway, and only the card's far corners take it to its cone. */
const LIVE = {
  fps: 30,
  budget: 4,
  blend: 0.4,
  cone: 30,
  lookDepth: 360,
  delay: [40, 150],
  settle: [150, 300],
  reflexSettle: 120,
  glanceMs: 1200,
  nodMs: 380,
  nodDeg: 14,
  bobDeg: 6,
  bobHz: 2.2,
  shakeDeg: 10,
  shakeHz: 0.8,
  /** How many frames a head that stopped moving keeps smoothing, and how many passes a head that never moves takes. */
  converge: 8,
  stillPasses: 16,
}
const DEG = Math.PI / 180

/** The box a head fills, in the root's units. */
export const HEAD_SIZE = 28

/** A head at rest looks toward the viewer's right, where a row's name sits, and a little down. */
const REST_LOOK = unit([0.4, -0.1, 1])
/** A head of a pilot out of the flight hangs looking down and toward the viewer's right, as far as a watching head can turn, since further looks wrong. */
const SLUMP_SIN = Math.sin(LIVE.cone * DEG)
export const SLUMP_LOOK = unit([SLUMP_SIN * 0.82, -SLUMP_SIN * 0.57, Math.cos(LIVE.cone * DEG)])
/** A head with its back to us, its nose hidden behind it. */
const AWAY: V = [0, 0, -1]

const PIXELS_PER_METER = HEAD_SIZE / (2 * SPEC.head.radius)

/** How far a head's canvas reaches past its box on every side, for its nose. A canvas reaching past a list's window gives it room to scroll, so each gets only what its nose can reach. */
export type HeadRoom = { size: number }
function roomFor(reach: number): HeadRoom {
  return { size: HEAD_SIZE + 2 * (Math.ceil(reach * PIXELS_PER_METER - HEAD_SIZE / 2) + 1) }
}
const NOSE_REACH = SPEC.head.radius + SPEC.nose.length
export const LIST_ROOM = roomFor(NOSE_REACH * Math.sin((LIVE.cone + LIVE.nodDeg) * DEG))
/** A folded row's head passes through profile as it turns its back. */
export const TURN_ROOM = roomFor(NOSE_REACH)

const norm = (v: V): V => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const yawed = (v: V, a: number): V => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)]

/** A look turned `t` of the way round, 0 to 1, to the back, settling on AWAY at the end. */
function turned(v: V, t: number): V {
  if (t <= 0) return v
  const r = yawed(v, Math.PI * t)
  return norm([r[0] + (AWAY[0] - r[0]) * t, r[1] + (AWAY[1] - r[1]) * t, r[2] + (AWAY[2] - r[2]) * t])
}

/** A look toward a point `dx` right and `dy` down of a head's center, turned no further than the cone. */
function lookToward(dx: number, dy: number): V {
  const r = Math.hypot(dx, dy)
  if (!r) return [0, 0, 1]
  const turn = Math.min(Math.atan2(r, LIVE.lookDepth), LIVE.cone * DEG)
  return [(Math.sin(turn) * dx) / r, (Math.sin(turn) * -dy) / r, Math.cos(turn)]
}

// ---------------------------------------------------------------- the cursor

/** Marks what a head reacts to under the cursor: this pilot's Ready, with `data-on` once it's pressed, or Leave. */
export const HEAD_CUE = "data-head-cue"

/** Where the cursor has been for the last half second, in the window's pixels. Each head reads it a little late. */
type Sample = { t: number; x: number; y: number; inApp: boolean; cue: HTMLElement | null }
const trail: Sample[] = []
let following = false

function follow(): void {
  if (following) return
  following = true
  // Capturing, so a handler of the EFB's that stops a mouse event on its way up can't hide the cursor from the heads.
  window.addEventListener(
    "mousemove",
    (event) => {
      const at = event.target instanceof Element ? event.target : null
      trail.push({ t: performance.now(), x: event.clientX, y: event.clientY, inApp: !!at?.closest("[data-app-frame]"), cue: at?.closest<HTMLElement>(`[${HEAD_CUE}]`) ?? null })
      while (trail.length > 2 && trail[0]!.t < performance.now() - 500) trail.shift()
    },
    true,
  )
  document.addEventListener("mouseleave", () => trail.push({ t: performance.now(), x: 0, y: 0, inApp: false, cue: null }))
}

function sampleAt(t: number): Sample | undefined {
  for (let i = trail.length - 1; i >= 0; i--) if (trail[i]!.t <= t) return trail[i]
  return trail[0]
}

// ---------------------------------------------------------------- a crew's minds

/** A pilot's heads in one card share one mind, so the crew list's head and the folded row's look the same way, and the row's takes over from the list's as the card folds without a jump. */
type Mind = { look: V; t: number; delay: number; settle: number; random: () => number; nodAt: number; glance?: { of: Mind; until: number }; heads: Set<HTMLElement> }

/** A pilot's ID, hashed, seeds their head's own random numbers (mulberry32). */
function seeded(id: string): () => number {
  let a = Array.from(id).reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761), 1779033703) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The minds of one card's heads. `scale` is the root's, which turns the cursor's window pixels into the units a head's rect reads in. */
export class Crew {
  private readonly minds = new Map<string, Mind>()
  scale = 1

  mind(pilot: string): Mind {
    let mind = this.minds.get(pilot)
    if (!mind) {
      const random = seeded(pilot)
      const [d0, d1] = LIVE.delay as [number, number]
      const [s0, s1] = LIVE.settle as [number, number]
      mind = { look: REST_LOOK, t: performance.now(), delay: d0 + random() * (d1 - d0), settle: s0 + random() * (s1 - s0), random, nodAt: -Infinity, heads: new Set() }
      this.minds.set(pilot, mind)
    }
    return mind
  }

  /** A pilot readied: they nod, and the others turn to them at once for a beat, as anyone turns at something happening. */
  readied(pilot: string): void {
    const now = performance.now()
    const them = this.minds.get(pilot)
    if (!them) return
    this.minds.forEach((mind) => {
      if (mind === them) mind.nodAt = now
      else mind.glance = { of: them, until: now + LIVE.glanceMs + mind.random() * 600 }
    })
  }
}

/** Where a head's center is, in the root's units, from its own box, which its canvas reaches past. */
function centerOf(head: HTMLElement): { x: number; y: number } {
  const r = (head.parentElement ?? head).getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function shownHead(mind: Mind): HTMLElement | undefined {
  const heads = Array.from(mind.heads)
  return heads.find(isShowing) ?? heads[0]
}

function lookAt(from: HTMLElement | undefined, x: number, y: number): V {
  if (!from) return REST_LOOK
  const c = centerOf(from)
  return lookToward(x - c.x, y - c.y)
}

/** Where a mind wants to look now, how fast it gets there, and whether it bobs or shakes. Whether Ready is pressed is read as it looks, so the bob stops on the press though the cursor stays put. */
function aim(mind: Mind, now: number, scale: number): { to: V; settle: number; bob: boolean; shake: boolean } {
  const head = shownHead(mind)
  if (mind.glance && now < mind.glance.until) {
    const at = shownHead(mind.glance.of)
    const c = at ? centerOf(at) : undefined
    return { to: c ? lookAt(head, c.x, c.y) : REST_LOOK, settle: LIVE.reflexSettle, bob: false, shake: false }
  }
  const s = sampleAt(now - mind.delay)
  if (!s || !head || !s.inApp) return { to: REST_LOOK, settle: mind.settle, bob: false, shake: false }
  if (s.cue?.isConnected && s.cue.getAttribute(HEAD_CUE) === "ready" && !s.cue.hasAttribute("data-on")) {
    const r = s.cue.getBoundingClientRect()
    return { to: lookAt(head, r.left + r.width / 2, r.top + r.height / 2), settle: mind.settle, bob: true, shake: false }
  }
  return { to: lookAt(head, s.x / scale, s.y / scale), settle: mind.settle, bob: false, shake: s.cue?.getAttribute(HEAD_CUE) === "leave" }
}

/** A mind's look this frame, eased toward where it aims as a first-order lag, which settles in about three of its settle constants, plus a nod's dip, the bob over Ready, or the shake over Leave. */
function lookOf(mind: Mind, now: number, scale: number): V {
  const { to, settle, bob, shake } = aim(mind, now, scale)
  if (now !== mind.t) {
    const k = 1 - Math.exp(-(now - mind.t) / (settle / 3))
    mind.look = norm([mind.look[0] + (to[0] - mind.look[0]) * k, mind.look[1] + (to[1] - mind.look[1]) * k, mind.look[2] + (to[2] - mind.look[2]) * k])
    mind.t = now
  }
  const s = now / 1000
  const nod = (now - mind.nodAt) / LIVE.nodMs
  const dip = (nod >= 0 && nod < 1 ? LIVE.nodDeg * Math.sin(Math.PI * nod) : 0) + (bob ? LIVE.bobDeg * Math.max(0, Math.sin(s * 2 * Math.PI * LIVE.bobHz)) : 0)
  const look = dip ? norm([mind.look[0], mind.look[1] - Math.tan(dip * DEG), mind.look[2]]) : mind.look
  return shake ? yawed(look, LIVE.shakeDeg * DEG * Math.sin(s * 2 * Math.PI * LIVE.shakeHz)) : look
}

// ---------------------------------------------------------------- drawing

/** Whether a head shows: laid out, inside its card and its list's window, and not faded out by the card's fold. */
function isShowing(head: HTMLElement): boolean {
  const box = head.parentElement
  if (!box || box.offsetParent === null) return false
  const r = box.getBoundingClientRect()
  for (const clip of [head.closest("[data-scroll-window]"), head.closest("[data-fold-clip]")]) {
    if (!clip) continue
    const c = clip.getBoundingClientRect()
    if (r.bottom <= c.top || r.top >= c.bottom) return false
  }
  if (head.closest<HTMLElement>("[data-fold-glide]")?.style.opacity === "0") return false
  const form = head.closest("[data-fold-form]")
  return !form || getComputedStyle(form).opacity !== "0"
}

/** The canvas pixels a head's shapes can reach, from its left, top, right, and bottom, a pixel to spare. */
function reach(shapes: Shape[], w: number, dpr: number, center: number): number[] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const corner = (p: V, r: number) => {
    x0 = Math.min(x0, center + PIXELS_PER_METER * (p[0] - r))
    x1 = Math.max(x1, center + PIXELS_PER_METER * (p[0] + r))
    y0 = Math.min(y0, center - PIXELS_PER_METER * (p[1] + r))
    y1 = Math.max(y1, center - PIXELS_PER_METER * (p[1] - r))
  }
  for (const s of shapes) {
    if (s.ball) corner(s.c, s.r)
    else {
      corner(s.a, s.ra)
      corner(s.b, s.rb)
    }
  }
  return [Math.max(0, Math.floor((x0 - 1) * dpr)), Math.max(0, Math.floor((y0 - 1) * dpr)), Math.min(w, Math.ceil((x1 + 1) * dpr)), Math.min(w, Math.ceil((y1 + 1) * dpr))]
}

/** How much of its own color a pilot's head keeps while they're out of the flight. */
const DIM_KEEPS = 0.4

/** Dims a color by mixing it with the head's window, so the head stays solid: at 40% opacity, its nose showed the window and the card through it. */
function dimToward(color: V, window: V): void {
  for (let i = 0; i < 3; i++) color[i] = color[i]! * DIM_KEEPS + window[i]! * (1 - DIM_KEEPS)
}

/** The color a head's window draws in, from the custom property the kit's root sets, as `pass` mixes it. */
function windowColor(element: Element): V {
  const [r, g, b] = getComputedStyle(element).getPropertyValue("--muted").split(",").map((part) => Number(part) / 255)
  return [r ?? 0, g ?? 0, b ?? 0]
}

/**
 * One pass of a head into `acc`, blended at `blend` with what it held, over the pixels its shapes reach now
 * and reached last frame: inside now's, a hit adds its color and a miss fades what was there; outside it,
 * where the nose has just left, the pixel clears, or a fading trail would stay where no later frame reaches.
 * Its rays run parallel, from a plane 10m in front of the head, as an orthographic camera's do.
 */
function pass(head: Live, shapes: Shape[], n: number, blend: number, now: number[], before: number[]): void {
  const { acc, w, dpr, center, tint } = head
  const [ox, oy] = offset(n)
  const keep = 1 - blend
  const color: V = [0, 0, 0]
  const tints = [tint, tint]
  for (let j = Math.min(now[1]!, before[1]!); j < Math.max(now[3]!, before[3]!); j++) {
    const roy = (center - (j + oy) / dpr) / PIXELS_PER_METER
    for (let i = Math.min(now[0]!, before[0]!); i < Math.max(now[2]!, before[2]!); i++) {
      const o = (j * w + i) * 4
      if (i < now[0]! || i >= now[2]! || j < now[1]! || j >= now[3]!) {
        acc.fill(0, o, o + 4)
        continue
      }
      const rox = ((i + ox) / dpr - center) / PIXELS_PER_METER
      let best = Infinity
      let self = -1
      let nx = 0
      let ny = 0
      let nz = 0
      for (let k = 0; k < shapes.length; k++) {
        const shape = shapes[k]!
        const t = shape.ball ? hitBall(rox, roy, 10, 0, 0, -1, shape.c, shape.r) : hitStick(rox, roy, 10, 0, 0, -1, shape)
        if (t > 0 && t < best) {
          best = t
          self = k
          if (!shape.ball) {
            nx = hitNormal[0]
            ny = hitNormal[1]
            nz = hitNormal[2]
          }
        }
      }
      acc[o] = acc[o]! * keep
      acc[o + 1] = acc[o + 1]! * keep
      acc[o + 2] = acc[o + 2]! * keep
      acc[o + 3] = acc[o + 3]! * keep
      if (self < 0) continue
      const shape = shapes[self]!
      const pz = 10 - best
      if (shape.ball) {
        nx = (rox - shape.c[0]) / shape.r
        ny = (roy - shape.c[1]) / shape.r
        nz = (pz - shape.c[2]) / shape.r
      }
      shade(rox, roy, pz, nx, ny, nz, shapes, self, tints[self]!, color)
      display(color)
      if (head.dim) dimToward(color, head.dim)
      acc[o] = acc[o]! + color[0] * blend
      acc[o + 1] = acc[o + 1]! + color[1] * blend
      acc[o + 2] = acc[o + 2]! + color[2] * blend
      acc[o + 3] = acc[o + 3]! + blend
    }
  }
}

/** A head on the page: a `crew` makes it watch, and with none it holds `look`. */
type Live = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  acc: Float32Array
  w: number
  dpr: number
  center: number
  tint: V
  /** The window's color, while the pilot is out of the flight. */
  dim: V | null
  crew: Crew | null
  mind: Mind | null
  look: V
  part: Element | null
  n: number
  stale: boolean
  box: number[]
  drawn: V
  still: number
}

/** How far round to its back each folded row's head has turned, which the card's fold sets as it docks. */
const turns = new WeakMap<Element, number>()
export function setHeadTurn(part: Element, turn: number | undefined): void {
  if (turn === undefined) turns.delete(part)
  else turns.set(part, turn)
}

const lives = new Set<Live>()
let loop = 0
let lastFrame = 0
let firstLive = 0

function tick(): void {
  // A head that doesn't watch stops needing frames once it's smoothed, so a page of them costs nothing.
  const needed = Array.from(lives).some((head) => head.mind || head.stale || head.still <= LIVE.stillPasses)
  loop = needed ? requestAnimationFrame(tick) : 0
  // The cursor's samples and a nod's start read this clock, and in Coherent GT a frame's own timestamp counts from another moment (record/areas/architecture/coherent-gt.md).
  const now = performance.now()
  if (now - lastFrame < 1000 / LIVE.fps - 2) return
  lastFrame = now
  const all = Array.from(lives)
  const start = performance.now()
  // Round the list from where the last frame stopped, so a crowded page shares the budget.
  const from = firstLive % (all.length || 1)
  let k = 0
  for (; k < all.length && performance.now() - start < LIVE.budget; k++) {
    const head = all[(from + k) % all.length]!
    if (!isShowing(head.canvas)) {
      head.stale = true
      continue
    }
    const base = head.mind ? lookOf(head.mind, now, head.crew!.scale) : head.look
    const look = turned(base, (head.part && turns.get(head.part)) || 0)
    // A head that hasn't moved since it last drew keeps drawing until its edges have smoothed, then rests.
    const moved = Math.acos(Math.min(1, look[0] * head.drawn[0] + look[1] * head.drawn[1] + look[2] * head.drawn[2])) > 0.2 * DEG
    head.still = moved || head.stale ? 0 : head.still + 1
    if (head.still > (head.mind ? LIVE.converge : LIVE.stillPasses)) continue
    const shapes = headShapes(look)
    const box = reach(shapes, head.w, head.dpr, head.center)
    if (head.stale) head.acc.fill(0)
    // A head that doesn't watch averages its passes evenly, and one that does leans on its latest, so it keeps up.
    const blend = head.stale ? 1 : head.mind ? LIVE.blend : 1 / (head.still + 1)
    const before = head.stale ? box : head.box
    pass(head, shapes, head.n++ % LIVE.stillPasses, blend, box, before)
    head.box = box
    head.drawn = look
    head.stale = false
    present(head.ctx, head.acc, head.w, [Math.min(box[0]!, before[0]!), Math.min(box[1]!, before[1]!), Math.max(box[2]!, before[2]!), Math.max(box[3]!, before[3]!)])
    // The sim shows a canvas's new pixels only once something about the element changes, so a head drawn with nothing else moving would stay as it was (measured on MSFS 2024, 2026-11-02, record/areas/interface/log.md).
    head.canvas.style.opacity = head.n % 2 ? "0.999" : "1"
  }
  firstLive = (from + k) % (all.length || 1)
}

/** Draws a head on `canvas`, from when it mounts until it goes. `crew` and `pilot` make it watch, and `look` holds it still, `dimmed` as a pilot out of the flight's is. */
export function useLiveHead(canvas: RefObject<HTMLCanvasElement | null>, hex: string, room: HeadRoom, scale: number, crew: Crew | null, pilot: string | undefined, look: V = REST_LOOK, dimmed = false): void {
  const lookRef = useRef(look)
  lookRef.current = look
  useLayoutEffect(() => {
    const element = canvas.current
    if (!element) return
    // A canvas pixel for each real pixel, and the canvas sized to whole ones, centered on the head's box, so it stays as sharp as the words beside it.
    const dpr = scale * (window.devicePixelRatio || 1)
    const w = Math.round(room.size * dpr)
    const size = w / dpr
    element.width = w
    element.height = w
    element.style.width = `${size}px`
    element.style.height = `${size}px`
    element.style.left = `${(HEAD_SIZE - size) / 2}px`
    element.style.top = `${(HEAD_SIZE - size) / 2}px`
    const ctx = element.getContext("2d")
    if (!ctx) return
    const mind = crew && pilot ? crew.mind(pilot) : null
    mind?.heads.add(element)
    const head: Live = {
      canvas: element,
      ctx,
      acc: new Float32Array(w * w * 4),
      w,
      dpr,
      center: size / 2,
      tint: albedo(hex),
      dim: dimmed ? windowColor(element) : null,
      crew,
      mind,
      look: lookRef.current,
      part: element.closest("[data-fold-glide]"),
      n: 0,
      stale: true,
      box: [0, 0, 0, 0],
      drawn: mind ? mind.look : lookRef.current,
      still: 0,
    }
    lives.add(head)
    follow()
    if (!loop) loop = requestAnimationFrame(tick)
    return () => {
      lives.delete(head)
      mind?.heads.delete(element)
    }
  }, [canvas, hex, room, scale, crew, pilot, dimmed])
}
