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
function headShapes(): Shape[] {
  const look = unit([0.4, -0.1, 1])
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
// grows out of the window and swells past its edge before it rests.
const POP_MS = 360
export function Head({ hex, pop }: { hex: string; pop?: number }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: HEAD_SIZE, height: HEAD_SIZE }}>
      <HeadWindow />
      <span className="absolute inset-0" style={{ animation: pop === undefined ? undefined : `head-pop ${POP_MS}ms ${pop}ms both` }}>
        <Figures width={HEAD_SIZE} height={HEAD_SIZE} figures={[{ shapes: headShapes(), hex }]} cam={HEAD_CAMERA} />
      </span>
    </span>
  )
}

// Where a head goes in a row still waiting for its pilot: the window alone.
export function EmptyHead() {
  return (
    <span className="relative inline-block shrink-0" style={{ width: HEAD_SIZE, height: HEAD_SIZE }}>
      <HeadWindow />
    </span>
  )
}
