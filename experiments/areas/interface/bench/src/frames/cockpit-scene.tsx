// The session card's picture as a scene of its own: a simple airliner cockpit built from rounded
// boxes, with the figures seated in it, ray traced with the figures' own light, so the cockpit and
// the pilots share one look. This is its blockout: the cockpit all gray, to settle where the camera
// stands and how much room the code gets between the pilots before any color goes in.
//
// The axes are the figures': x to the viewer's right, y up, and z toward the back of the cockpit,
// in meters, from the floor between the seats at the pilots' hips. Forward, toward the nose, is -z.
import { useEffect, useRef } from "react"

import { AppFrame } from "./shell"
import { add, albedos, clamp01, cross, display, FILL, FLOOR, hitBall, hitNormal, hitStick, KEY, offset, present, RIM, scale, SKY, SPEC, sub, unit, type Shape, type V } from "./figure-portrait"
import type { Theme } from "@/bench/theme"

// A box with rounded edges: its center, its half sizes before the rounding, the rounding's radius,
// and how it's turned, by tilt about x, its top going back, then yaw about y. rot holds the turn
// as a matrix's rows, from the box's own axes to the scene's.
type Box = { c: V; b: V; r: number; rot: number[] }
function box(c: V, b: V, r: number, tilt = 0, yaw = 0): Box {
  const ct = Math.cos(tilt), st = Math.sin(tilt), cy = Math.cos(yaw), sy = Math.sin(yaw)
  // Ry(yaw) · Rx(tilt), where a positive tilt leans the box's top toward +z, the cockpit's back.
  return { c, b, r, rot: [cy, sy * st, sy * ct, 0, ct, -st, -sy, cy * st, cy * ct] }
}
// A box along a line from a to b, such as a window post: its long axis is the line, with the given
// half thickness, leaning back as the line does; the line runs in a plane of constant x.
function post(a: V, b: V, half: number, r: number): Box {
  const dy = b[1] - a[1], dz = b[2] - a[2]
  return box([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [half, Math.hypot(dy, dz) / 2, half], r, Math.atan2(dz, dy))
}

// A ray against a box: the slab test against the box grown by its rounding finds where the ray
// can first touch it, and from there the box's distance field steps the ray onto its surface,
// which takes a step or two on a face and a few more near an edge. It leaves the normal in
// hitNormal, as hitStick does.
function hitBox(rox: number, roy: number, roz: number, rdx: number, rdy: number, rdz: number, s: Box) {
  const m = s.rot
  const px = rox - s.c[0], py = roy - s.c[1], pz = roz - s.c[2]
  // Into the box's own axes, by the turn's transpose.
  const ox = m[0] * px + m[3] * py + m[6] * pz, oy = m[1] * px + m[4] * py + m[7] * pz, oz = m[2] * px + m[5] * py + m[8] * pz
  const dx = m[0] * rdx + m[3] * rdy + m[6] * rdz, dy = m[1] * rdx + m[4] * rdy + m[7] * rdz, dz = m[2] * rdx + m[5] * rdy + m[8] * rdz
  // The slab test, axis by axis, written out, since it runs for every box on every ray.
  let near = -Infinity, far = Infinity
  const ex = s.b[0] + s.r, ey = s.b[1] + s.r, ez = s.b[2] + s.r
  if (Math.abs(dx) < 1e-12) {
    if (Math.abs(ox) > ex) return -1
  } else {
    const t1 = (-ex - ox) / dx, t2 = (ex - ox) / dx
    near = Math.max(near, Math.min(t1, t2))
    far = Math.min(far, Math.max(t1, t2))
  }
  if (Math.abs(dy) < 1e-12) {
    if (Math.abs(oy) > ey) return -1
  } else {
    const t1 = (-ey - oy) / dy, t2 = (ey - oy) / dy
    near = Math.max(near, Math.min(t1, t2))
    far = Math.min(far, Math.max(t1, t2))
  }
  if (Math.abs(dz) < 1e-12) {
    if (Math.abs(oz) > ez) return -1
  } else {
    const t1 = (-ez - oz) / dz, t2 = (ez - oz) / dz
    near = Math.max(near, Math.min(t1, t2))
    far = Math.min(far, Math.max(t1, t2))
  }
  if (near > far || far < 0) return -1
  let t = Math.max(near, 0)
  for (let step = 0; step < 48; step++) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t
    const qx = Math.abs(x) - s.b[0], qy = Math.abs(y) - s.b[1], qz = Math.abs(z) - s.b[2]
    const ux = Math.max(qx, 0), uy = Math.max(qy, 0), uz = Math.max(qz, 0)
    const outside = Math.hypot(ux, uy, uz)
    const d = outside + Math.min(Math.max(qx, qy, qz), 0) - s.r
    if (d < 1e-4) {
      // The normal points from the inner box's nearest point, or straight out of its nearest face
      // where the point is over a face's flat middle.
      let nx = 0, ny = 0, nz = 0
      if (outside > 1e-9) {
        nx = (Math.sign(x) * ux) / outside
        ny = (Math.sign(y) * uy) / outside
        nz = (Math.sign(z) * uz) / outside
      } else if (qx >= qy && qx >= qz) nx = Math.sign(x)
      else if (qy >= qz) ny = Math.sign(y)
      else nz = Math.sign(z)
      hitNormal[0] = m[0] * nx + m[1] * ny + m[2] * nz
      hitNormal[1] = m[3] * nx + m[4] * ny + m[5] * nz
      hitNormal[2] = m[6] * nx + m[7] * ny + m[8] * nz
      return t
    }
    t += d
    if (t > far) return -1
  }
  return -1
}

// The cockpit, at an A320's proportions, in the figures' axes. Each seat is a cushion, a back
// leaning 12° back, and a headrest on it, its top 6cm under the pilot's eye; the pedestal runs
// forward between the seats, its two thrust levers standing from it; ahead are the main panel and
// the glareshield over it, then the windshield, framed by a post in the middle, a pillar at each
// side, and the header along its top; side windows beyond; and the floor, walls, and ceiling with
// the overhead panel close it in, so a ray that leaves the cockpit leaves through the glass.
// The proportions the cockpit bench (src/cockpit/bench.tsx) can change: each seat's center
// across, the backs' lean, the headrests' top, the ceiling's rise, both in degrees, and whether
// the overhead panel and the pedestal are there.
export type Dims = { seatX: number; recline: number; headrestTop: number; ceiling: number; overhead: boolean; pedestal: boolean }
export const DIMS: Dims = { seatX: 0.54, recline: 12, headrestTop: 0.61, ceiling: 13, overhead: true, pedestal: true }
const rad = (deg: number) => (deg * Math.PI) / 180
function cockpit(dims: Dims): Box[] {
  const RECLINE = rad(dims.recline), CEILING = rad(dims.ceiling)
  const boxes: Box[] = []
  for (const side of [-1, 1]) {
    const x = side * dims.seatX
    boxes.push(
      box([x, -0.17, -0.12], [0.24, 0.04, 0.24], 0.04),
      box([x, 0.12, 0.27], [0.25, 0.23, 0.05], 0.05, RECLINE),
      box([x, dims.headrestTop - 0.14, 0.33], [0.17, 0.09, 0.05], 0.05, RECLINE),
      // The side window's frame: the wall under it, the header over it, and the pillar behind it,
      // on a wall that slants out toward the back, the way the cockpit widens from the nose.
      box([side * 1.12, -0.12, -0.28], [0.05, 0.36, 0.42], 0.02, 0, side * 0.62),
      box([side * 1.12, 0.92, -0.28], [0.05, 0.12, 0.42], 0.02, 0, side * 0.62),
      box([side * 1.36, 0.4, 0.75], [0.05, 0.8, 0.7], 0.02),
      post([side * 0.87, 0.4, -0.85], [side * 0.87, 0.8, -0.35], 0.035, 0.03),
      box([side * 1.33, 0.55, 0.06], [0.04, 0.27, 0.04], 0.03),
      // The nose's corner, forward of the side window and outside the front pane, so no ray
      // leaves the cockpit there.
      box([side * 1.25, 0.25, -1.05], [0.32, 0.85, 0.4], 0.02),
    )
  }
  // The pedestal and its thrust levers.
  if (dims.pedestal)
    boxes.push(
      box([0, -0.36, -0.32], [0.24, 0.17, 0.4], 0.03),
      box([-0.035, -0.12, -0.4], [0.012, 0.06, 0.012], 0.008),
      box([0.035, -0.12, -0.4], [0.012, 0.06, 0.012], 0.008),
    )
  if (dims.overhead) boxes.push(box([0, 0.99, 0.2], [0.32, 0.08, 0.6], 0.04, -CEILING))
  boxes.push(
    // The main panel, the knee panel under it, and the glareshield.
    box([0, 0.06, -0.92], [0.98, 0.2, 0.12], 0.03),
    box([0, -0.36, -0.95], [0.98, 0.2, 0.1], 0.03),
    box([0, 0.37, -0.86], [0.84, 0.06, 0.28], 0.05),
    // The windshield's post, raked back as the glass is, and its header.
    post([0, 0.4, -1.05], [0, 0.8, -0.42], 0.02, 0.015),
    box([0, 0.81, -0.4], [0.95, 0.04, 0.06], 0.03),
    // The floor, and the ceiling with the overhead panel under it, both rising from the
    // windshield's header toward the back, 13°, as an airliner's do, so the windshield shows
    // under them from behind the seats.
    box([0, -0.62, 0.4], [1.45, 0.05, 1.6], 0.02),
    box([0, 1.13, 0.55], [1.45, 0.07, 1.0], 0.02, -CEILING),
  )
  return boxes
}

// A pilot in the seat at seatX, from the figures' seated pose: the head and chest where the pose
// puts them, each hand where it's given. The figure has no neck, and the portrait lowers its head
// to hide the gap, but here the headrest stands in front of it, so the head stays at the pose's
// eye. The hips sit on the seat, hidden by its back, so they aren't drawn.
function pilot(seatX: number, hands: [V, V]): Shape[] {
  const look: V = [0, 0, -1]
  const toHead: V = [0, 0.63, 0.05 + SPEC.head.eyeForward]
  const head: V = [seatX, toHead[1], toHead[2]]
  const chest: V = [seatX, toHead[1] * SPEC.chest.at, toHead[2] * SPEC.chest.at]
  const R = SPEC.head.radius, r = SPEC.nose.radius, rt = r * SPEC.nose.tip
  const out = Math.sqrt(R * R - r * r)
  const shapes: Shape[] = [
    { ball: true, c: chest, r: SPEC.chest.radius, light: true },
    { ball: true, c: head, r: R },
    { ball: false, a: add(head, scale(look, out)), b: add(head, scale(look, R + SPEC.nose.length - rt)), ra: r, rb: rt },
  ]
  for (const [side, hand] of [[-1, hands[0]], [1, hands[1]]] as const) {
    const shoulder: V = [seatX + (side * SPEC.shoulders.width) / 2, chest[1] - SPEC.shoulders.down, chest[2]]
    shapes.push({ ball: false, a: shoulder, b: hand, ra: SPEC.arm.radius, rb: SPEC.arm.radius }, { ball: true, c: hand, r: SPEC.hand.radius, hand: true })
  }
  return shapes
}
const lap = (seatX: number, side: number): V => [seatX + side * 0.12, 0.05, -0.3]
// The host flies from the left seat, their right hand on the left thrust lever's handle.
const ON_LEVER: V = [-0.035, -0.03, -0.4]

// Where the camera stands, what it looks at, and its field of view up and down, in degrees.
export type SceneCamera = { from: V; to: V; fov: number }
export const BLOCKOUT_CAMERAS: { name: string; camera: SceneCamera }[] = [
  { name: "Standing, close", camera: { from: [0, 1.05, 2.2], to: [0, 0.42, -0.8], fov: 34 } },
  { name: "Seated, close", camera: { from: [0, 0.78, 2.1], to: [0, 0.56, -0.8], fov: 32 } },
  { name: "Standing, far", camera: { from: [0, 1.2, 4.3], to: [0, 0.45, -0.6], fov: 18 } },
]

// The picture, 436 by 250 pixels, the card's width inside its padding.
export const PICTURE = { width: 436, height: 250 }
const GRAY = albedos("#8a8d94").main
// Through the glass, a pale sky, already in the screen's colors.
const SKY_SEEN: V = [0.72, 0.79, 0.88]

// One ray for every pixel, added into sum as the figures' passes do. A ray that leaves through the
// glass sees the sky. Each pass moves the key light a little within its soft size, so the shadows
// soften as the passes add up.
function pass(sum: Float32Array, w: number, h: number, cam: SceneCamera, boxes: Box[], shapes: Shape[], tints: { main: V; light: V }[], n: number) {
  const [ox, oy] = offset(n)
  const fwd = unit(sub(cam.to, cam.from))
  const right = unit(cross(fwd, [0, 1, 0]))
  const up = cross(right, fwd)
  const tan = Math.tan((cam.fov * Math.PI) / 360)
  const aspect = w / h
  const jitter = n === 0 ? [0, 0] : [Math.cos(n * 2.4) * 0.08, Math.sin(n * 2.4) * 0.08]
  const key = unit([KEY.dir[0] + jitter[0], KEY.dir[1], KEY.dir[2] + jitter[1]])
  const [rox, roy, roz] = cam.from
  const color: V = [0, 0, 0]
  const nearest = (x: number, y: number, z: number, dx: number, dy: number, dz: number, any: boolean) => {
    let best = Infinity, which = -1, nx = 0, ny = 0, nz = 0
    for (let k = 0; k < boxes.length; k++) {
      const t = hitBox(x, y, z, dx, dy, dz, boxes[k])
      if (t > 1e-4 && t < best) {
        best = t
        which = k
        nx = hitNormal[0]
        ny = hitNormal[1]
        nz = hitNormal[2]
        if (any) return { best, which, nx, ny, nz }
      }
    }
    for (let k = 0; k < shapes.length; k++) {
      const s = shapes[k]
      const t = s.ball ? hitBall(x, y, z, dx, dy, dz, s.c, s.r) : hitStick(x, y, z, dx, dy, dz, s)
      if (t > 1e-4 && t < best) {
        best = t
        which = boxes.length + k
        if (s.ball) {
          nx = (x + dx * t - s.c[0]) / s.r
          ny = (y + dy * t - s.c[1]) / s.r
          nz = (z + dz * t - s.c[2]) / s.r
        } else {
          nx = hitNormal[0]
          ny = hitNormal[1]
          nz = hitNormal[2]
        }
        if (any) return { best, which, nx, ny, nz }
      }
    }
    return { best, which, nx, ny, nz }
  }
  for (let j = 0; j < h; j++) {
    const v = (1 - ((j + oy) / h) * 2) * tan
    for (let i = 0; i < w; i++) {
      const u = (((i + ox) / w) * 2 - 1) * tan * aspect
      const rd = unit(add(fwd, add(scale(right, u), scale(up, v))))
      const hit = nearest(rox, roy, roz, rd[0], rd[1], rd[2], false)
      const o = (j * w + i) * 4
      if (hit.which < 0) {
        sum[o] += SKY_SEEN[0]
        sum[o + 1] += SKY_SEEN[1]
        sum[o + 2] += SKY_SEEN[2]
        sum[o + 3] += 1
        continue
      }
      const px = rox + rd[0] * hit.best, py = roy + rd[1] * hit.best, pz = roz + rd[2] * hit.best
      let { nx, ny, nz } = hit
      // A face seen from behind turns its normal to the camera.
      if (nx * rd[0] + ny * rd[1] + nz * rd[2] > 0) (nx = -nx), (ny = -ny), (nz = -nz)
      const shape = hit.which >= boxes.length ? shapes[hit.which - boxes.length] : null
      const albedo = shape ? (shape.ball && shape.light ? tints[hit.which - boxes.length].light : tints[hit.which - boxes.length].main) : GRAY
      const lit = nx * key[0] + ny * key[1] + nz * key[2]
      let shadow = 0
      if (lit > 0) shadow = nearest(px + nx * 1e-3, py + ny * 1e-3, pz + nz * 1e-3, key[0], key[1], key[2], true).which < 0 ? 1 : 0
      const sky = 0.5 + 0.5 * ny
      const fill = Math.max(0, nx * FILL.dir[0] + ny * FILL.dir[1] + nz * FILL.dir[2])
      const rim = Math.max(0, nx * RIM.dir[0] + ny * RIM.dir[1] + nz * RIM.dir[2])
      for (let c = 0; c < 3; c++) {
        const light = FLOOR[c] + (SKY[c] - FLOOR[c]) * sky + KEY.color[c] * KEY.power * Math.max(0, lit) * shadow + FILL.color[c] * FILL.power * fill + RIM.color[c] * RIM.power * rim * 0.5
        color[c] = albedo[c] * light
      }
      display(color)
      sum[o] += clamp01(color[0])
      sum[o + 1] += clamp01(color[1])
      sum[o + 2] += clamp01(color[2])
      sum[o + 3] += 1
    }
  }
}

// How many rays a pixel gets, over as many frames as that takes, each frame keeping to the budget,
// in milliseconds. The picture holds still, so it smooths once and stops.
const PASSES = 10
const FRAME_BUDGET = 12

// The picture at zoom times the card's size, crew pilots in it, none without figures. It renders
// afresh whenever any of those change.
export function CockpitScene({ camera, crew = 2, dims = DIMS, zoom = 1, figures: drawFigures = true }: { camera: SceneCamera; crew?: 1 | 2; dims?: Dims; zoom?: number; figures?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const key = JSON.stringify([camera, crew, dims, zoom, drawFigures])
  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext("2d")
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(PICTURE.width * zoom * dpr), h = Math.round(PICTURE.height * zoom * dpr)
    el.width = w
    el.height = h
    const boxes = cockpit(dims)
    const x = dims.seatX
    const figures = drawFigures ? [{ shapes: pilot(-x, [lap(-x, -1), ON_LEVER]), hex: "#f0862e" }, ...(crew === 2 ? [{ shapes: pilot(x, [lap(x, -1), lap(x, 1)]), hex: "#e2453c" }] : [])] : []
    const shapes = figures.flatMap((f) => f.shapes)
    const tints = figures.flatMap((f) => f.shapes.map(() => albedos(f.hex)))
    const sum = new Float32Array(w * h * 4)
    let passes = 0
    let frame = 0
    const tick = () => {
      const start = performance.now()
      while (passes < PASSES && (passes === 0 || performance.now() - start < FRAME_BUDGET)) pass(sum, w, h, camera, boxes, shapes, tints, passes++)
      present(ctx, sum, w, passes)
      if (passes < PASSES) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // The key stands for every prop the render reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return <canvas ref={canvas} className="block" style={{ width: PICTURE.width * zoom, height: PICTURE.height * zoom }} />
}

// Where a point in the scene lands on the picture, in its pixels at the card's size.
export function toPicture(p: V, cam: SceneCamera): [number, number] {
  const fwd = unit(sub(cam.to, cam.from))
  const right = unit(cross(fwd, [0, 1, 0]))
  const up = cross(right, fwd)
  const tan = Math.tan((cam.fov * Math.PI) / 360)
  const d = sub(p, cam.from)
  const z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2]
  const x = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / (z * tan * (PICTURE.width / PICTURE.height))
  const y = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / (z * tan)
  return [((x + 1) / 2) * PICTURE.width, ((1 - y) / 2) * PICTURE.height]
}

// A blockout frame: the picture in a card the session card's size, with the code where it would
// sit, in the glass between the pilots' heads, level with the top of the heads.
export function CockpitBlockoutFrame({ theme, camera, crew }: { theme: Theme; camera: SceneCamera; crew?: 1 | 2 }) {
  const [, codeY] = toPicture([0, 0.7, -0.75], camera)
  return (
    <AppFrame theme={theme} header={false} tabs={false} fixed>
      <div className="p-5">
        <div className="relative overflow-hidden rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <div className="relative">
            <CockpitScene camera={camera} crew={crew} />
            <div className="absolute left-0 flex w-full flex-col items-center gap-0.5" style={{ top: codeY - 22 }}>
              <span className="text-xs text-white/70">Invite code</span>
              <span className="font-mono text-2xl font-medium text-white">K7R-4XM</span>
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  )
}
