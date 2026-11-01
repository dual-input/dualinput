/*
 * p26: can a pilot's figure draw in Coherent GT as well as the frames' ray tracer does, with no pixels?
 * Beside the traced head, drawn here by a 1px fillRect each, it draws the same head from SVG shapes, whose
 * gradients are sampled from the tracer's own shading, at a head's size and large enough to judge.
 * At a figure's size the two match, and at a head's the SVG's edges are stepped, since Coherent GT smooths no
 * filled shape. A hairline stroke, drawing it larger and scaling it down, and a CSS ball all stayed stepped, and
 * a blur's least radius softens the whole picture. So heads stay traced, and figures draw as SVG
 * (record/areas/interface/log.md).
 *
 *   node tools/dev.ts experiments/areas/interface/p26-figure-drawing/main.tsx
 */

import { albedo, display, headShapes, lightAlbedo, hitBall, hitNormal, hitStick, offset, shade, SPEC, unit } from "../../../../src/platform/efb-shell/src/heads/trace.ts"
import type { Shape, V } from "../../../../src/platform/efb-shell/src/heads/trace.ts"
import { FigureDrawing } from "../../../../src/platform/efb-shell/src/figure/drawing.ts"
import type { Projection } from "../../../../src/platform/efb-shell/src/figure/drawing.ts"
import { body, BODY_SHADOWS, CHEST_UP, FEET, FOOT, HANDS_ON_HIPS, HEAD_UP, HIPS_UP, standingProjection } from "../../../../src/platform/efb-shell/src/figure/standing-pose.ts"
import type { Pose } from "../../../../src/platform/efb-shell/src/figure/standing-pose.ts"

const SVG = "http://www.w3.org/2000/svg"
/** The SVG's units a meter, since Coherent GT draws nothing of a viewBox in units this small. */
const K = 1000
/** What the picture spans, either side of the head's center, in meters. */
const SPAN = (SPEC.head.radius + SPEC.nose.length) * 1.1
const KEY_XY: [number, number] = [-0.6 / Math.hypot(0.6, 0.75, 0.6), 0.75 / Math.hypot(0.6, 0.75, 0.6)]

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0")
const css = (c: V) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`

/** What the tracer says a ball's surface looks like where its normal is `n`, with nothing else near it. */
function surface(tint: V, n: V): V {
  const shapes: Shape[] = [{ ball: true, c: [0, 0, 0], r: 1 }]
  const out: V = [0, 0, 0]
  shade(n[0], n[1], n[2], n[0], n[1], n[2], shapes, 0, tint, out)
  display(out)
  return out
}

const onBall = (x: number, y: number): V => {
  const r2 = x * x + y * y
  return r2 >= 1 ? [x / Math.sqrt(r2), y / Math.sqrt(r2), 0] : [x, y, Math.sqrt(1 - r2)]
}

let nextId = 1
const el = (name: string, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(SVG, name)
  for (const key of Object.keys(attrs)) e.setAttribute(key, String(attrs[key]))
  return e
}

/** A radial gradient for any ball of this tint: its stops sampled along the line from the highlight, through the center, to the far edge. */
function ballGradient(defs: Element, tint: V, stops = 12): string {
  const id = `b${nextId++}`
  const [hx, hy] = KEY_XY
  const far = [-hx / Math.hypot(hx, hy), -hy / Math.hypot(hx, hy)] as const
  // Centered on the highlight, since Coherent GT draws nothing of a radial gradient with a focal point.
  const g = el("radialGradient", { id, cx: 0.5 + hx * 0.5, cy: 0.5 - hy * 0.5, r: (1 + Math.hypot(hx, hy)) / 2 })
  for (let i = 0; i <= stops; i++) {
    const t = i / stops
    g.appendChild(el("stop", { offset: t, "stop-color": css(surface(tint, onBall(hx + (far[0] - hx) * t, hy + (far[1] - hy) * t))) }))
  }
  defs.appendChild(g)
  return `url(#${id})`
}

/** The light from behind on the right, a crescent along that edge: alpha over the ball, rising toward the rim. */
function rimGradient(defs: Element, tint: V): string {
  const id = `r${nextId++}`
  const rim = unit([0.6, 0.5, 0])
  const g = el("radialGradient", { id, cx: 0.5 - rim[0] * 0.14, cy: 0.5 + rim[1] * 0.14, r: 0.64 })
  const edge = surface(tint, [rim[0], rim[1], 0])
  const color = css(edge)
  for (const [t, a] of [[0, 0], [0.62, 0], [0.82, 0.18], [0.94, 0.55], [1, 0.9]] as const) g.appendChild(el("stop", { offset: t, "stop-color": color, "stop-opacity": a }))
  defs.appendChild(g)
  return `url(#${id})`
}

/** The head as SVG shapes, which `update` poses for a look. */
function svgHead(size: number, hex: string) {
  const tint = albedo(hex)
  const svg = el("svg", { width: size, height: size, viewBox: `${-SPAN * K} ${-SPAN * K} ${SPAN * 2 * K} ${SPAN * 2 * K}` })
  const defs = el("defs")
  svg.appendChild(defs)
  const R = SPEC.head.radius * K
  const ballFill = ballGradient(defs, tint)
  const rimFill = rimGradient(defs, tint)
  const shadowId = `s${nextId++}`
  const shadowGradient = el("radialGradient", { id: shadowId })
  for (const [t, a] of [[0, 0.5], [0.5, 0.3], [1, 0]] as const) shadowGradient.appendChild(el("stop", { offset: t, "stop-color": "#000", "stop-opacity": a }))
  defs.appendChild(shadowGradient)
  const noseId = `n${nextId++}`
  const noseGradient = el("linearGradient", { id: noseId, gradientUnits: "userSpaceOnUse" })
  const noseStops = Array.from({ length: 7 }, (_, i) => {
    const stop = el("stop", { offset: i / 6 })
    noseGradient.appendChild(stop)
    return stop
  })
  defs.appendChild(noseGradient)

  const shadow = el("ellipse", { fill: `url(#${shadowId})` })
  const nose = el("path", { fill: `url(#${noseId})` })
  const tip = el("circle", { fill: ballFill })
  svg.append(el("circle", { cx: 0, cy: 0, r: R, fill: ballFill }), el("circle", { cx: 0, cy: 0, r: R, fill: rimFill }), shadow, nose)

  const r = SPEC.nose.radius * K
  const rb = r * SPEC.nose.tip
  const out = Math.sqrt(R * R - r * r)
  const end = R + SPEC.nose.length * K - rb
  const sinB = (r - rb) / (end - out)
  const cosB = Math.sqrt(1 - sinB * sinB)

  const update = (look: V) => {
    const a = [look[0] * out, -look[1] * out] as const
    const b = [look[0] * end, -look[1] * end] as const
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const d = Math.hypot(dx, dy)
    const hidden = look[2] < -0.05
    nose.setAttribute("display", hidden ? "none" : "inline")
    tip.setAttribute("display", hidden ? "none" : "inline")
    shadow.setAttribute("display", hidden ? "none" : "inline")
    if (hidden) return
    tip.setAttribute("cx", String(b[0]))
    tip.setAttribute("cy", String(b[1]))
    tip.setAttribute("r", String(rb))
    // Its soft shadow on the ball, thrown away from the key light, and longer as the nose turns to the side.
    const cx = a[0] - KEY_XY[0] * r * 0.9
    const cy = a[1] + KEY_XY[1] * r * 0.9
    shadow.setAttribute("cx", String(cx))
    shadow.setAttribute("cy", String(cy))
    // No clip, which wiped what lay under it in Coherent GT: the shadow shrinks to stay on the ball.
    const room = Math.max(0, Math.min(r * 1.7, R - Math.hypot(cx, cy)))
    shadow.setAttribute("rx", String(room))
    shadow.setAttribute("ry", String(room))
    if (d <= r - rb + 0.1) {
      // Pointing straight at us, the nose is its two ends.
      nose.setAttribute("d", `M ${a[0] - r} ${a[1]} A ${r} ${r} 0 1 1 ${a[0] + r} ${a[1]} A ${r} ${r} 0 1 1 ${a[0] - r} ${a[1]} Z`)
    } else {
      const ux = dx / d
      const uy = dy / d
      const cosA = (r - rb) / d
      const sinA = Math.sqrt(1 - cosA * cosA)
      const e1 = [ux * cosA - uy * sinA, uy * cosA + ux * sinA] as const
      const e2 = [ux * cosA + uy * sinA, uy * cosA - ux * sinA] as const
      // Its foot is where it leaves the ball, a circle seen at an angle, so an ellipse, whose half toward the ball's center shows.
      const sx = -uy * r
      const sy = ux * r
      const turn = (Math.atan2(uy, ux) * 180) / Math.PI
      nose.setAttribute("d", `M ${a[0] + sx} ${a[1] + sy} L ${b[0] + rb * e1[0]} ${b[1] + rb * e1[1]} A ${rb} ${rb} 0 0 0 ${b[0] + rb * e2[0]} ${b[1] + rb * e2[1]} L ${a[0] - sx} ${a[1] - sy} A ${Math.max(0.5, r * Math.abs(look[2]))} ${r} ${turn} 0 0 ${a[0] + sx} ${a[1] + sy} Z`)
    }
    // Across the nose, its shading sampled from the tracer at each place around it.
    const side = d > 0.1 ? ([-dy / d, dx / d] as const) : ([1, 0] as const)
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const
    const half = (r + rb) / 2
    noseGradient.setAttribute("x1", String(mid[0] - side[0] * half))
    noseGradient.setAttribute("y1", String(mid[1] - side[1] * half))
    noseGradient.setAttribute("x2", String(mid[0] + side[0] * half))
    noseGradient.setAttribute("y2", String(mid[1] + side[1] * half))
    // The axis's frame: Q is the screen's sideways, in world axes (y up), and P the way round toward the viewer.
    const Q: V = [side[0], -side[1], 0]
    const P = unit([look[1] * Q[2] - look[2] * Q[1], look[2] * Q[0] - look[0] * Q[2], look[0] * Q[1] - look[1] * Q[0]])
    const toViewer = P[2] < 0 ? ([-P[0], -P[1], -P[2]] as V) : P
    noseStops.forEach((stop, i) => {
      const s = (i / 6) * 2 - 1
      const c = Math.sqrt(Math.max(0, 1 - s * s))
      const n = unit([
        cosB * (toViewer[0] * c + Q[0] * s) + sinB * look[0],
        cosB * (toViewer[1] * c + Q[1] * s) + sinB * look[1],
        cosB * (toViewer[2] * c + Q[2] * s) + sinB * look[2],
      ])
      stop.setAttribute("stop-color", css(surface(tint, n)))
    })
  }
  return { svg, update }
}

/** The same head as the frames' tracer draws it, a 1px rectangle a pixel, averaged over 16 passes. */
function tracedHead(size: number, hex: string, look: V) {
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  canvas.style.cssText = `display:block;width:${size}px;height:${size}px`
  const ctx = canvas.getContext("2d")!
  const tint = albedo(hex)
  const shapes = headShapes(look)
  const sum = new Float32Array(size * size * 4)
  const color: V = [0, 0, 0]
  const perMeter = size / (SPAN * 2)
  const PASSES = 16
  for (let n = 0; n < PASSES; n++) {
    const [ox, oy] = offset(n)
    for (let j = 0; j < size; j++) {
      const roy = (size / 2 - (j + oy)) / perMeter
      for (let i = 0; i < size; i++) {
        const rox = (i + ox - size / 2) / perMeter
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
        if (self < 0) continue
        const shape = shapes[self]!
        const pz = 10 - best
        if (shape.ball) {
          nx = (rox - shape.c[0]) / shape.r
          ny = (roy - shape.c[1]) / shape.r
          nz = (pz - shape.c[2]) / shape.r
        }
        shade(rox, roy, pz, nx, ny, nz, shapes, self, tint, color)
        display(color)
        const o = (j * size + i) * 4
        sum[o] = sum[o]! + color[0]
        sum[o + 1] = sum[o + 1]! + color[1]
        sum[o + 2] = sum[o + 2]! + color[2]
        sum[o + 3] = sum[o + 3]! + 1
      }
    }
  }
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const o = (j * size + i) * 4
      const a = sum[o + 3]!
      if (!a) continue
      ctx.fillStyle = `rgba(${Math.round((sum[o]! / a) * 255)},${Math.round((sum[o + 1]! / a) * 255)},${Math.round((sum[o + 2]! / a) * 255)},${a / PASSES})`
      ctx.fillRect(i, j, 1, 1)
    }
  }
  return canvas
}

const LOOKS: V[] = [unit([0.4, -0.1, 1]), unit([0.5, 0.5, 0.75]), unit([-0.4, -0.4, 0.8]), unit([1, -0.7, 1]), unit([0.95, 0.05, 0.3])]
const COLORS = ["#3fae5a", "#3b7fe0", "#f0862e"]

const page = document.getElementById("page") as HTMLElement
page.style.cssText = "padding:12px;background:#171717;color:#aaa;font:12px sans-serif"
function row(label: string, size: number, make: (look: V, hex: string) => Element) {
  const line = document.createElement("div")
  line.style.cssText = "display:flex;align-items:center;margin-bottom:8px"
  const name = document.createElement("div")
  name.textContent = label
  name.style.cssText = "width:70px;flex-shrink:0"
  line.appendChild(name)
  LOOKS.forEach((look, i) => {
    const holder = document.createElement("div")
    holder.style.cssText = `width:${size}px;height:${size}px;margin-right:8px;flex-shrink:0`
    holder.appendChild(make(look, COLORS[i % COLORS.length]!))
    line.appendChild(holder)
  })
  page.appendChild(line)
}
const asSvg = (size: number) => (look: V, hex: string) => {
  const head = svgHead(size, hex)
  head.update(look)
  return head.svg
}
const asTrace = (size: number) => (look: V, hex: string) => tracedHead(size, hex, look)
row("traced 44", 44, asTrace(44))
row("SVG 44", 44, asSvg(44))

// The whole figure on foot, traced and as the product's SVG drawing, in one pose.
function tracedFigure(width: number, height: number, hex: string, shapes: Shape[], project: Projection) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  canvas.style.cssText = `display:block;width:${width}px;height:${height}px`
  const ctx = canvas.getContext("2d")!
  const perMeter = project([0, 1, 0]).perMeter
  const depth0 = project([0, 1, 0]).depth
  // The camera's long lens is close to parallel, so the scene is laid out in its own axes, in meters.
  const inView = (p: V): V => {
    const at = project(p)
    return [(at.x - width / 2) / perMeter, (height / 2 - at.y) / perMeter, depth0 - at.depth]
  }
  const scene: Shape[] = shapes.map((s) => (s.ball ? { ...s, c: inView(s.c) } : { ...s, a: inView(s.a), b: inView(s.b) }))
  const main = albedo(hex)
  const light = lightAlbedo(hex)
  const color: V = [0, 0, 0]
  const PASSES = 4
  const sum = new Float32Array(width * height * 4)
  for (let n = 0; n < PASSES; n++) {
    const [ox, oy] = offset(n)
    for (let j = 0; j < height; j++) {
      const roy = (height / 2 - (j + oy)) / perMeter
      for (let i = 0; i < width; i++) {
        const rox = (i + ox - width / 2) / perMeter
        let best = Infinity
        let self = -1
        let nx = 0
        let ny = 0
        let nz = 0
        for (let k = 0; k < scene.length; k++) {
          const s = scene[k]!
          const t = s.ball ? hitBall(rox, roy, 10, 0, 0, -1, s.c, s.r) : hitStick(rox, roy, 10, 0, 0, -1, s)
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
        if (self < 0) continue
        const s = scene[self]!
        const pz = 10 - best
        if (s.ball) {
          nx = (rox - s.c[0]) / s.r
          ny = (roy - s.c[1]) / s.r
          nz = (pz - s.c[2]) / s.r
        }
        shade(rox, roy, pz, nx, ny, nz, scene, self, s.ball && s.light ? light : main, color)
        display(color)
        const o = (j * width + i) * 4
        sum[o] = sum[o]! + color[0]
        sum[o + 1] = sum[o + 1]! + color[1]
        sum[o + 2] = sum[o + 2]! + color[2]
        sum[o + 3] = sum[o + 3]! + 1
      }
    }
  }
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const o = (j * width + i) * 4
      const a = sum[o + 3]!
      if (!a) continue
      ctx.fillStyle = `rgba(${Math.round((sum[o]! / a) * 255)},${Math.round((sum[o + 1]! / a) * 255)},${Math.round((sum[o + 2]! / a) * 255)},${a / PASSES})`
      ctx.fillRect(i, j, 1, 1)
    }
  }
  return canvas
}

const W = 260
const H = 400
const hips: V = [0, HIPS_UP, 0]
const pose: Pose = {
  hips,
  chest: [0, HIPS_UP + CHEST_UP, 0],
  head: [0, HIPS_UP + HEAD_UP, 0],
  look: unit([-0.45, 0.2, 0.85]),
  lean: [0, 0, 0],
  hands: [
    [-HANDS_ON_HIPS.out, HIPS_UP + HANDS_ON_HIPS.up, HANDS_ON_HIPS.fwd],
    [HANDS_ON_HIPS.out, HIPS_UP + HANDS_ON_HIPS.up, HANDS_ON_HIPS.fwd],
  ],
  feet: [
    [-FEET.out, FOOT, FEET.fwd],
    [FEET.out, FOOT, FEET.fwd],
  ],
  knees: [0.02, 0],
}
const project = standingProjection(W, H)
const shapes = body(pose)
const figures = document.createElement("div")
figures.style.cssText = "display:flex;margin-top:12px"
const left = document.createElement("div")
left.style.cssText = `width:${W}px;height:${H}px;margin-right:12px;flex-shrink:0`
// At half size, since a canvas of tens of thousands of fillRects closed the debugger.
const traced = tracedFigure(W / 2, H / 2, "#f0862e", shapes, standingProjection(W / 2, H / 2))
traced.style.width = `${W}px`
traced.style.height = `${H}px`
left.appendChild(traced)
const right = document.createElement("div")
right.style.cssText = `width:${W}px;height:${H}px;flex-shrink:0`
const drawing = new FigureDrawing("#f0862e", W, H)
drawing.draw(shapes, project, BODY_SHADOWS)
right.appendChild(drawing.svg)
figures.append(left, right)
page.appendChild(figures)
