// A pilot's head on its own, for wherever the app lists its pilots: the figure their crew sees in
// the sim, in that pilot's color, facing us and turned a little toward the viewer's right, where a
// row's name sits. It's drawn by the portrait's ray tracer (figure-portrait.tsx) through an
// orthographic camera, whose rays run parallel, as the cockpit picture's pilots are (cockpit.tsx).
import { useEffect, useRef } from "react"

import { albedos, display, hitBall, hitNormal, hitStick, offset, present, scale, shade, SPEC, unit, type Shape, type V } from "./figure-portrait"

// An orthographic camera, on the portrait's axes, x to the viewer's right, y up, and z toward the
// camera: where the origin lands on the picture, in pixels, how many pixels a meter is, and how far
// it looks down, in radians.
export type Camera = { cx: number; cy: number; k: number; tilt: number }

// Where a point lands on a camera's picture.
export function project(p: V, cam: Camera): [number, number] {
  return [cam.cx + cam.k * p[0], cam.cy - cam.k * (p[1] * Math.cos(cam.tilt) - p[2] * Math.sin(cam.tilt))]
}

// One ray for every pixel inside box, a picture's pixels from its left, top, right, and bottom,
// added into sum, as the portrait's pass does. Its rays run parallel, along the camera's view, from
// a plane 10m behind the picture.
function pass(sum: Float32Array, w: number, dpr: number, shapes: Shape[], tints: { main: V; light: V }[], cam: Camera, n: number, box: number[]) {
  const [ox, oy] = offset(n)
  const s = Math.sin(cam.tilt), c = Math.cos(cam.tilt)
  const rdx = 0, rdy = -s, rdz = -c
  const color: V = [0, 0, 0]
  for (let j = box[1]; j < box[3]; j++) {
    const up = (cam.cy - (j + oy) / dpr) / cam.k
    const roy = up * c + 10 * s, roz = -up * s + 10 * c
    for (let i = box[0]; i < box[2]; i++) {
      const rox = ((i + ox) / dpr - cam.cx) / cam.k
      let best = Infinity, self = -1, nx = 0, ny = 0, nz = 0
      for (let k = 0; k < shapes.length; k++) {
        const sh = shapes[k]
        const t = sh.ball ? hitBall(rox, roy, roz, rdx, rdy, rdz, sh.c, sh.r) : hitStick(rox, roy, roz, rdx, rdy, rdz, sh)
        if (t > 0 && t < best) {
          best = t
          self = k
          if (!sh.ball) {
            nx = hitNormal[0]
            ny = hitNormal[1]
            nz = hitNormal[2]
          }
        }
      }
      if (self < 0) continue
      const sh = shapes[self]
      const px = rox + rdx * best, py = roy + rdy * best, pz = roz + rdz * best
      if (sh.ball) {
        nx = (px - sh.c[0]) / sh.r
        ny = (py - sh.c[1]) / sh.r
        nz = (pz - sh.c[2]) / sh.r
      }
      shade(px, py, pz, nx, ny, nz, -rdx, -rdy, -rdz, shapes, self, sh.ball && sh.light ? tints[self].light : tints[self].main, color)
      display(color)
      const o = (j * w + i) * 4
      sum[o] += color[0]
      sum[o + 1] += color[1]
      sum[o + 2] += color[2]
      sum[o + 3] += 1
    }
  }
}

// How many rays a pixel gets, over as many frames as that takes, each frame keeping to the budget,
// in milliseconds. The picture holds still, so it smooths once and stops.
const PASSES = 16
const FRAME_BUDGET = 8

// Figures, each a list of shapes in one color, drawn by a camera onto a transparent canvas of the
// given size in CSS pixels. Only the pixels the shapes can reach are traced.
export function Figures({ width, height, figures, cam }: { width: number; height: number; figures: { shapes: Shape[]; hex: string }[]; cam: Camera }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const key = figures.map((f) => f.hex + f.shapes.length).join()
  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext("2d")
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(width * dpr), h = Math.round(height * dpr)
    el.width = w
    el.height = h
    const shapes = figures.flatMap((f) => f.shapes)
    const tints = figures.flatMap((f) => f.shapes.map(() => albedos(f.hex)))
    // The box around every shape, in canvas pixels, with a pixel to spare.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const s of shapes)
      for (const [p, r] of s.ball ? [[s.c, s.r] as const] : [[s.a, s.ra] as const, [s.b, s.rb] as const]) {
        const [x, y] = project(p, cam)
        x0 = Math.min(x0, x - r * cam.k)
        x1 = Math.max(x1, x + r * cam.k)
        y0 = Math.min(y0, y - r * cam.k)
        y1 = Math.max(y1, y + r * cam.k)
      }
    const box = [Math.max(0, Math.floor((x0 - 1) * dpr)), Math.max(0, Math.floor((y0 - 1) * dpr)), Math.min(w, Math.ceil((x1 + 1) * dpr)), Math.min(h, Math.ceil((y1 + 1) * dpr))]
    const sum = new Float32Array(w * h * 4)
    let passes = 0
    let frame = 0
    const tick = () => {
      const start = performance.now()
      while (passes < PASSES && (passes === 0 || performance.now() - start < FRAME_BUDGET)) pass(sum, w, dpr, shapes, tints, cam, passes++, box)
      present(ctx, sum, w, passes)
      if (passes < PASSES) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // The figures redraw when who they are changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, width, height])
  return <canvas ref={canvas} className="pointer-events-none absolute top-0 left-0" style={{ width, height }} />
}

// Each head has a window, a circle filling its box in the color of the setup portrait's backdrop
// (setup-check.tsx), and looks to have popped out of it, so the head fills the box too: the
// camera's meter is as many pixels as makes the head the window's width. The head's box, in pixels;
// the nose stays inside it.
const HEAD_SIZE = 28
const HEAD_CAMERA: Camera = { cx: HEAD_SIZE / 2, cy: HEAD_SIZE / 2, k: HEAD_SIZE / (2 * SPEC.head.radius), tilt: 0 }
// A head at rest looks toward the viewer's right, where a row's name sits, and a little down.
const REST_LOOK = unit([0.4, -0.1, 1])
function headShapes(look: V = REST_LOOK): Shape[] {
  const R = SPEC.head.radius, r = SPEC.nose.radius, rt = r * SPEC.nose.tip
  const out = Math.sqrt(R * R - r * r)
  return [
    { ball: true, c: [0, 0, 0], r: R },
    { ball: false, a: scale(look, out), b: scale(look, R + SPEC.nose.length - rt), ra: r, rb: rt },
  ]
}
function HeadWindow() {
  return <span className="absolute inset-0 rounded-full bg-muted" />
}

// A head given pop pops in when it first shows, after that many milliseconds, hidden until then
// (index.css, head-pop). The window shows at once and holds still, and only the head pops, so it
// grows out of the window and swells past its edge before it rests. A head given alive, the
// pilot's name, watches the cursor (LiveFigure), and one that also turns, a folded row's, turns its
// back to us as it docks. A slumped head, a pilot's out of the flight, hangs still, looking down and
// toward the viewer's right, at 40% opacity, so who's gone reads apart from the crew still watching
// (user, 2026-10-31; tried and dropped: gray); its nose reaches past the box no further than a list
// head's cone takes one.
const POP_MS = 360
const SLUMP_LOOK = unit([1, -0.7, 1])
export function Head({ hex, pop, alive, turns, slumped }: { hex: string; pop?: number; alive?: string; turns?: boolean; slumped?: boolean }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: HEAD_SIZE, height: HEAD_SIZE }}>
      <HeadWindow />
      <span className="absolute inset-0" style={{ animation: pop === undefined ? undefined : `head-pop ${POP_MS}ms ${pop}ms both` }}>
        {slumped ? (
          <span className="absolute opacity-40" style={{ left: -LIST_ROOM.px, top: -LIST_ROOM.px }}>
            <Figures width={LIST_ROOM.size} height={LIST_ROOM.size} figures={[{ shapes: headShapes(SLUMP_LOOK), hex }]} cam={LIST_ROOM.cam} />
          </span>
        ) : alive ? (
          <LiveFigure hex={hex} name={alive} room={turns ? TURN_ROOM : LIST_ROOM} />
        ) : (
          <Figures width={HEAD_SIZE} height={HEAD_SIZE} figures={[{ shapes: headShapes(), hex }]} cam={HEAD_CAMERA} />
        )}
      </span>
    </span>
  )
}

// A head that's alive, as heads in preflight are, eager to go flying, as the pilot's figure has been
// since home: it watches the cursor while it's on the EFB, so it's always looking at what the pilot
// does, and rests looking toward its name when the cursor leaves (user, 2026-10-31). Each head
// answers the cursor a little late and turns at its own pace, both seeded by its pilot's name, so a
// sweep of the cursor ripples across the crew rather than turning every head at once. It turns no
// further than a small cone, so its nose pokes out of its window by a few pixels at most. While the
// cursor rests on this pilot's Ready, not yet pressed, every head looks at it and bobs, urging the
// press, and stops the moment it's pressed; while it rests on Leave, every head shakes, slowly. It
// answers the crew too: a pilot who readies nods, and the others turn to them at once for a beat,
// as anyone turns at something happening. A pilot's heads in one card share one mind, so the crew
// list's head and the folded row's look the same way, and the row's takes over from the list's as
// the card folds without a jump; the row's then turns its back to us as it docks, so in the folded
// row, where its ready ring sits on it, it's a plain ball that never redraws (turned). Tried and
// dropped: each head looking around the room on its own, which read as bored rather than eager, and
// went chaotic with a wide reach; every head facing us through the countdown, which read as odd.
// It's drawn by one pass of the ray tracer a frame, blended into the passes before, so its edges
// smooth over a few frames rather than taking 16 passes a frame, and only while its gaze moves and
// for a few frames after, so a still cursor costs nothing. Only heads showing are drawn, in one
// loop for every head, at 30 frames a second, in at most a few milliseconds a frame: none while the
// page is hidden, nor one its card or its list's window hides, nor one too small on screen to see
// move. Coherent GT has no IntersectionObserver (record/areas/architecture/coherent-gt.md), so the
// loop measures. A turning head took 0.40ms a frame on the development PC at a device pixel ratio
// of 1 (measured in the bench, 2026-10-31).
// Times in milliseconds, angles in degrees. A head reaches toward a point lookDepth pixels in front
// of the page, so the cursor anywhere in the card turns it partway, and only the card's far corners
// take it to its cone.
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
  converge: 8,
  minPx: 10,
}
const DEG = Math.PI / 180
// A turned nose reaches past the window, and a head's canvas reaches as far past it on every side,
// a pixel to spare, as far as the head's nose can turn there. A list scrolls in a window of its
// own (home.tsx, ScrollWindow), and a canvas reaching past that window gives it room to scroll, so
// a list's head has room for its cone and a nod's dip, about 7px. A folded row's head passes
// through profile as it turns its back, so it has room for the head's radius and the nose's length,
// about 15px.
type Room = { px: number; size: number; cam: Camera }
function roomFor(reach: number): Room {
  const px = Math.ceil(reach * HEAD_CAMERA.k - HEAD_SIZE / 2) + 1
  const size = HEAD_SIZE + 2 * px
  return { px, size, cam: { ...HEAD_CAMERA, cx: size / 2, cy: size / 2 } }
}
const NOSE_REACH = SPEC.head.radius + SPEC.nose.length
const LIST_ROOM = roomFor(NOSE_REACH * Math.sin((LIVE.cone + LIVE.nodDeg) * DEG))
const TURN_ROOM = roomFor(NOSE_REACH)
const norm = (v: V): V => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
// A look turned a about the head's upright axis.
const yawed = (v: V, a: number): V => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)]
// A head with its back to us, its nose hidden behind it.
const AWAY: V = [0, 0, -1]
// A look turned t of the way round, 0 to 1, to the back, settling on AWAY at the end.
function turned(v: V, t: number): V {
  if (t <= 0) return v
  const r = yawed(v, Math.PI * t)
  return norm([r[0] + (AWAY[0] - r[0]) * t, r[1] + (AWAY[1] - r[1]) * t, r[2] + (AWAY[2] - r[2]) * t])
}
// A look toward a point dx right and dy down of a head's center, in CSS pixels, turned no further
// than the cone.
function lookToward(dx: number, dy: number): V {
  const r = Math.hypot(dx, dy)
  if (!r) return [0, 0, 1]
  const turn = Math.min(Math.atan2(r, LIVE.lookDepth), LIVE.cone * DEG)
  return [(Math.sin(turn) * dx) / r, (Math.sin(turn) * -dy) / r, Math.cos(turn)]
}

// Where the cursor has been, for the last half second: on the screen, which app frame it was in,
// and whether it rested on this pilot's Ready or on Leave there. Each head reads it a little late.
type Sample = { t: number; x: number; y: number; app: Element | null; ready: HTMLElement | null; leave: boolean }
const trail: Sample[] = []
let following = false
function follow() {
  if (following) return
  following = true
  addEventListener("mousemove", (e) => {
    const at = e.target instanceof Element ? e.target : null
    trail.push({ t: performance.now(), x: e.clientX, y: e.clientY, app: at?.closest("[data-app-frame]") ?? null, ready: at?.closest<HTMLElement>('[data-fold-morph="ready"]') ?? null, leave: !!at?.closest("[data-leave]") })
    while (trail.length > 2 && trail[0].t < performance.now() - 500) trail.shift()
  })
  document.addEventListener("mouseleave", () => trail.push({ t: performance.now(), x: 0, y: 0, app: null, ready: null, leave: false }))
}
const sampleAt = (t: number) => {
  for (let i = trail.length - 1; i >= 0; i--) if (trail[i].t <= t) return trail[i]
  return trail[0]
}

type Mind = {
  look: V
  t: number
  delay: number
  settle: number
  rng: () => number
  nodAt: number
  glance?: { at: Mind; until: number }
  heads: Set<HTMLElement>
}
const crews = new WeakMap<Element, Map<string, Mind>>()
// A pilot's name, hashed, seeds their head's own random numbers (mulberry32).
function seeded(name: string) {
  let a = [...name].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761), 1779033703) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// The head of a mind that shows, to look from or at.
const shownHead = (m: Mind) => [...m.heads].find(onScreen) ?? [...m.heads][0]
// Where a head's center is on screen, and how many screen pixels a CSS pixel is there, from the
// head's own box, which its canvas reaches past.
const boxOf = (el: HTMLElement) => (el.parentElement ?? el).getBoundingClientRect()
function centerOf(el: HTMLElement) {
  const r = boxOf(el)
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, zoom: r.width / HEAD_SIZE || 1 }
}
function lookAtPoint(from: HTMLElement | undefined, x: number, y: number): V {
  if (!from) return REST_LOOK
  const c = centerOf(from)
  return lookToward((x - c.x) / c.zoom, (y - c.y) / c.zoom)
}
function lookAtHead(from: HTMLElement | undefined, at: HTMLElement | undefined): V {
  if (!at) return REST_LOOK
  const c = centerOf(at)
  return lookAtPoint(from, c.x, c.y)
}
// Where a mind wants to look now, how fast it gets there, and whether it bobs or shakes. Whether
// Ready is pressed is read as it looks, so the bob stops on the press though the cursor stays put.
function aim(m: Mind, now: number): { to: V; settle: number; bob: boolean; shake: boolean } {
  const head = shownHead(m)
  if (m.glance && now < m.glance.until) return { to: lookAtHead(head, shownHead(m.glance.at)), settle: LIVE.reflexSettle, bob: false, shake: false }
  const s = sampleAt(now - m.delay)
  if (!s || !head || s.app !== head.closest("[data-app-frame]")) return { to: REST_LOOK, settle: m.settle, bob: false, shake: false }
  if (s.ready?.isConnected && !s.ready.hasAttribute("data-pressed")) {
    const r = s.ready.getBoundingClientRect()
    return { to: lookAtPoint(head, r.left + r.width / 2, r.top + r.height / 2), settle: m.settle, bob: true, shake: false }
  }
  return { to: lookAtPoint(head, s.x, s.y), settle: m.settle, bob: false, shake: s.leave }
}
// A mind's look this frame, eased toward where it aims as a first-order lag, which settles in about
// three of its settle constants, plus a nod's dip, the bob over Ready, or the shake over Leave.
function lookOf(m: Mind, now: number): V {
  const { to, settle, bob, shake } = aim(m, now)
  if (now !== m.t) {
    const k = 1 - Math.exp(-(now - m.t) / (settle / 3))
    m.look = norm([m.look[0] + (to[0] - m.look[0]) * k, m.look[1] + (to[1] - m.look[1]) * k, m.look[2] + (to[2] - m.look[2]) * k])
    m.t = now
  }
  const s = now / 1000
  const nod = (now - m.nodAt) / LIVE.nodMs
  const dip = (nod >= 0 && nod < 1 ? LIVE.nodDeg * Math.sin(Math.PI * nod) : 0) + (bob ? LIVE.bobDeg * Math.max(0, Math.sin(s * 2 * Math.PI * LIVE.bobHz)) : 0)
  const look = dip ? norm([m.look[0], m.look[1] - Math.tan(dip * DEG), m.look[2]]) : m.look
  return shake ? yawed(look, LIVE.shakeDeg * DEG * Math.sin(s * 2 * Math.PI * LIVE.shakeHz)) : look
}

// What a card tells its heads: a pilot readied.
export type HeadsCue = { kind: "ready"; name: string }
export function cueHeads(crew: Element | null, cue: HeadsCue) {
  crew?.dispatchEvent(new CustomEvent<HeadsCue>("heads", { detail: cue }))
}
function mindOf(crewBox: Element, name: string): Mind {
  let crew = crews.get(crewBox)
  if (!crew) {
    const minds = new Map<string, Mind>()
    crew = minds
    crews.set(crewBox, crew)
    crewBox.addEventListener("heads", (e) => {
      const cue = (e as CustomEvent<HeadsCue>).detail
      const now = performance.now()
      const readied = minds.get(cue.name)
      for (const m of minds.values()) {
        if (m === readied) m.nodAt = now
        else if (readied) m.glance = { at: readied, until: now + LIVE.glanceMs + m.rng() * 600 }
      }
    })
  }
  let m = crew.get(name)
  if (!m) {
    const rng = seeded(name)
    const [d0, d1] = LIVE.delay
    const [s0, s1] = LIVE.settle
    m = { look: REST_LOOK, t: performance.now(), delay: d0 + rng() * (d1 - d0), settle: s0 + rng() * (s1 - s0), rng, nodAt: -Infinity, heads: new Set() }
    crew.set(name, m)
  }
  return m
}

// Whether a head shows: on the page and big enough to see move, inside its card and its list's
// window, and neither faded out by the card's fold.
function onScreen(el: HTMLElement) {
  const r = boxOf(el)
  if (r.width < LIVE.minPx || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false
  for (const clip of [el.closest("[data-fold-window]"), el.closest("[data-fold-clip]")]) {
    if (!clip) continue
    const c = clip.getBoundingClientRect()
    if (r.bottom <= c.top || r.top >= c.bottom) return false
  }
  const part = el.closest<HTMLElement>("[data-fold-morph]")
  if (part?.style.opacity === "0") return false
  const form = el.closest<HTMLElement>("[data-fold-form]")
  return !form || getComputedStyle(form).opacity !== "0"
}

// The canvas pixels a head's shapes can reach, from its left, top, right, and bottom, a pixel to
// spare.
function reach(shapes: Shape[], w: number, dpr: number, cam: Camera): number[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of shapes)
    for (const [p, r] of s.ball ? [[s.c, s.r] as const] : [[s.a, s.ra] as const, [s.b, s.rb] as const]) {
      const [x, y] = project(p, cam)
      x0 = Math.min(x0, x - r * cam.k)
      x1 = Math.max(x1, x + r * cam.k)
      y0 = Math.min(y0, y - r * cam.k)
      y1 = Math.max(y1, y + r * cam.k)
    }
  return [Math.max(0, Math.floor((x0 - 1) * dpr)), Math.max(0, Math.floor((y0 - 1) * dpr)), Math.min(w, Math.ceil((x1 + 1) * dpr)), Math.min(w, Math.ceil((y1 + 1) * dpr))]
}

// One pass of a head at its gaze into acc, blended at blend with what acc held, over the pixels
// its shapes reach now and reached last frame: inside now's, a hit adds its color and a miss fades
// what was there; outside it, where the nose has just left, the pixel clears, or a fading trail
// would stay where no later frame reaches.
function livePass(acc: Float32Array, w: number, dpr: number, cam: Camera, shapes: Shape[], tints: { main: V; light: V }[], n: number, blend: number, now: number[], before: number[]) {
  const [ox, oy] = offset(n)
  const keep = 1 - blend
  const color: V = [0, 0, 0]
  for (let j = Math.min(now[1], before[1]); j < Math.max(now[3], before[3]); j++) {
    const roy = (cam.cy - (j + oy) / dpr) / cam.k
    for (let i = Math.min(now[0], before[0]); i < Math.max(now[2], before[2]); i++) {
      if (i < now[0] || i >= now[2] || j < now[1] || j >= now[3]) {
        acc.fill(0, (j * w + i) * 4, (j * w + i) * 4 + 4)
        continue
      }
      const rox = ((i + ox) / dpr - cam.cx) / cam.k
      let best = Infinity, self = -1, nx = 0, ny = 0, nz = 0
      for (let k = 0; k < shapes.length; k++) {
        const sh = shapes[k]
        const t = sh.ball ? hitBall(rox, roy, 10, 0, 0, -1, sh.c, sh.r) : hitStick(rox, roy, 10, 0, 0, -1, sh)
        if (t > 0 && t < best) {
          best = t
          self = k
          if (!sh.ball) {
            nx = hitNormal[0]
            ny = hitNormal[1]
            nz = hitNormal[2]
          }
        }
      }
      const o = (j * w + i) * 4
      acc[o] *= keep
      acc[o + 1] *= keep
      acc[o + 2] *= keep
      acc[o + 3] *= keep
      if (self < 0) continue
      const sh = shapes[self]
      const pz = 10 - best
      if (sh.ball) {
        nx = (rox - sh.c[0]) / sh.r
        ny = (roy - sh.c[1]) / sh.r
        nz = (pz - sh.c[2]) / sh.r
      }
      shade(rox, roy, pz, nx, ny, nz, 0, 0, 1, shapes, self, tints[self].main, color)
      display(color)
      acc[o] += color[0] * blend
      acc[o + 1] += color[1] * blend
      acc[o + 2] += color[2] * blend
      acc[o + 3] += blend
    }
  }
}

type Live = { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D; acc: Float32Array; w: number; dpr: number; cam: Camera; mind: Mind; tints: { main: V; light: V }[]; n: number; stale: boolean; box: number[]; drawn: V; still: number }
const lives = new Set<Live>()
let loop = 0
let lastFrame = 0
let firstLive = 0
function liveTick(now: number) {
  loop = lives.size ? requestAnimationFrame(liveTick) : 0
  if (document.hidden || now - lastFrame < 1000 / LIVE.fps - 2) return
  lastFrame = now
  const all = [...lives]
  const start = performance.now()
  // Round the list from where the last frame stopped, so a crowded page shares the budget.
  const from = firstLive % (all.length || 1)
  let k = 0
  for (; k < all.length && performance.now() - start < LIVE.budget; k++) {
    const l = all[(from + k) % all.length]
    if (!onScreen(l.el)) {
      l.stale = true
      continue
    }
    // How far round to its back a row's head has turned, which the card's fold sets as it docks.
    const look = turned(lookOf(l.mind, now), parseFloat(l.el.closest<HTMLElement>("[data-fold-morph]")?.style.getPropertyValue("--fold-turn") || "0"))
    // A head that hasn't moved since it last drew keeps drawing until its edges have smoothed over
    // converge frames, then rests.
    const moved = Math.acos(Math.min(1, look[0] * l.drawn[0] + look[1] * l.drawn[1] + look[2] * l.drawn[2])) > 0.2 * DEG
    l.still = moved || l.stale ? 0 : l.still + 1
    if (l.still > LIVE.converge) continue
    const shapes = headShapes(look)
    const box = reach(shapes, l.w, l.dpr, l.cam)
    if (l.stale) l.acc.fill(0)
    livePass(l.acc, l.w, l.dpr, l.cam, shapes, l.tints, l.n++ % 16, l.stale ? 1 : LIVE.blend, box, l.stale ? box : l.box)
    l.box = box
    l.drawn = look
    l.stale = false
    present(l.ctx, l.acc, l.w, 1)
  }
  firstLive = (from + k) % (all.length || 1)
}
function LiveFigure({ hex, name, room }: { hex: string; name: string; room: Room }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext("2d")
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(room.size * dpr)
    el.width = w
    el.height = w
    const mind = mindOf(el.closest("[data-heads]") ?? document.body, name)
    mind.heads.add(el)
    const live: Live = { el, ctx, acc: new Float32Array(w * w * 4), w, dpr, cam: room.cam, mind, tints: [albedos(hex), albedos(hex)], n: 0, stale: true, box: [0, 0, 0, 0], drawn: mind.look, still: 0 }
    lives.add(live)
    follow()
    if (!loop) loop = requestAnimationFrame(liveTick)
    return () => {
      lives.delete(live)
      mind.heads.delete(el)
    }
  }, [hex, name, room])
  return <canvas ref={canvas} className="pointer-events-none absolute" style={{ width: room.size, height: room.size, left: -room.px, top: -room.px }} />
}

// Where a head goes in a row still waiting for its pilot: the window alone.
export function EmptyHead() {
  return (
    <span className="relative inline-block shrink-0" style={{ width: HEAD_SIZE, height: HEAD_SIZE }}>
      <HeadWindow />
    </span>
  )
}
