// Draws a pilot's figure as SVG shapes, posed anew each frame, since Coherent GT's canvas takes no pixels and a
// figure has far too many to fill one by one (record/areas/interface/log.md, p26). The figure is balls and sticks
// with one fixed light, so a ball looks the same wherever it stands, and one gradient, sampled from the tracer's
// own shading, draws every ball of a tint. Matching the tracer leans on three of the engine's limits: a radial
// gradient with a focal point draws nothing, so it's centered on the highlight; a viewBox in units as small as
// meters draws nothing, so everything here is in the page's pixels; and a clip path wipes what's under it, so a
// shadow is a gradient on a circle the size of its ball, which keeps it on the ball
// (record/areas/architecture/coherent-gt.md, "CSS").

import { add, albedo, clamp01, display, lightAlbedo, scale, shade, sub, unit } from "@dualinput/crew/trace"
import type { Shape, V } from "@dualinput/crew/trace"

const SVG = "http://www.w3.org/2000/svg"

/** Where a point lands in the drawing, and how many of its pixels a meter is there. Nearer the camera is a smaller `depth`. */
export type Projected = { x: number; y: number; perMeter: number; depth: number }
export type Projection = (point: V) => Projected

/** The key light's direction across the picture, where a ball is brightest. */
const KEY: V = unit([-0.6, 0.75, 0.6])
const RIM_SIDE = unit([0.6, 0.5, 0])
const BALL: Shape[] = [{ ball: true, c: [0, 0, 0], r: 1 }]

/** The shadow of what touches a ball: how far it's thrown and how wide it reaches, in the toucher's radii, and its strength from center to edge. */
const SHADOW = { throw: 0.9, size: 1.5 }
const SHADOW_STOPS: [number, number][] = [
  [0, 0.26],
  [0.5, 0.14],
  [1, 0],
]
/** How much further back an arm or a leg counts than where it is, in meters, about the hips' radius: they start inside the body's balls and pass their edges, where the balls' surfaces come no nearer than their centers, so a limb shows in front only when it's well clear of them. */
const LIMB_BEHIND = 0.18
/** The light from behind on the right, a crescent along that edge. */
const RIM_STOPS: [number, number][] = [
  [0, 0],
  [0.62, 0],
  [0.82, 0.18],
  [0.94, 0.55],
  [1, 0.9],
]
const BALL_STOPS = 12
const STICK_STOPS = 7

let nextId = 1
const newId = (kind: string) => `dualinput-figure-${kind}-${nextId++}`

function make<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name)
  for (const key of Object.keys(attributes)) element.setAttribute(key, String(attributes[key]))
  return element
}

const channel = (n: number) => Math.round(clamp01(n) * 255).toString(16).padStart(2, "0")
const css = (c: V) => `#${channel(c[0])}${channel(c[1])}${channel(c[2])}`

/** The tracer's color for a surface whose normal is `n`, with nothing else near it. */
function surface(tint: V, n: V): string {
  const out: V = [0, 0, 0]
  shade(n[0], n[1], n[2], n[0], n[1], n[2], BALL, 0, tint, out)
  display(out)
  return css(out)
}

const normalAt = (x: number, y: number): V => {
  const r2 = x * x + y * y
  return r2 >= 1 ? [x / Math.sqrt(r2), y / Math.sqrt(r2), 0] : [x, y, Math.sqrt(1 - r2)]
}

/** Sets a ball's gradient for a tint: sampled along the line from the highlight, through the center, to the far edge. */
function paintBall(gradient: SVGRadialGradientElement, tint: V): void {
  const reach = Math.hypot(KEY[0], KEY[1])
  const far = [-KEY[0] / reach, -KEY[1] / reach]
  Array.from(gradient.children).forEach((stop, at) => {
    const t = at / BALL_STOPS
    stop.setAttribute("stop-color", surface(tint, normalAt(KEY[0] + (far[0]! - KEY[0]) * t, KEY[1] + (far[1]! - KEY[1]) * t)))
  })
}

function paintRim(gradient: SVGRadialGradientElement, tint: V): void {
  const color = surface(tint, [RIM_SIDE[0], RIM_SIDE[1], 0])
  Array.from(gradient.children).forEach((stop) => stop.setAttribute("stop-color", color))
}

type Part = { group: SVGGElement; depth: number; fill?: SVGCircleElement; rim?: SVGCircleElement; shadow?: SVGCircleElement; shadowFill?: SVGRadialGradientElement; path?: SVGPathElement; gradient?: SVGLinearGradientElement; stops?: SVGStopElement[] }

export class FigureDrawing {
  readonly svg: SVGSVGElement
  private readonly defs: SVGDefsElement
  private readonly main = make("radialGradient", { id: newId("ball"), cx: 0.5 + KEY[0] * 0.5, cy: 0.5 - KEY[1] * 0.5, r: (1 + Math.hypot(KEY[0], KEY[1])) / 2 })
  private readonly light = make("radialGradient", { id: newId("ball"), cx: 0.5 + KEY[0] * 0.5, cy: 0.5 - KEY[1] * 0.5, r: (1 + Math.hypot(KEY[0], KEY[1])) / 2 })
  private readonly rim = make("radialGradient", { id: newId("rim"), cx: 0.5 - RIM_SIDE[0] * 0.14, cy: 0.5 + RIM_SIDE[1] * 0.14, r: 0.64 })
  private readonly lightRim = make("radialGradient", { id: newId("rim"), cx: 0.5 - RIM_SIDE[0] * 0.14, cy: 0.5 + RIM_SIDE[1] * 0.14, r: 0.64 })
  private tint: V
  private parts: Part[] = []
  private order = ""

  constructor(hex: string, width: number, height: number) {
    this.svg = make("svg", { width, height, viewBox: `0 0 ${width} ${height}` })
    this.svg.style.display = "block"
    this.defs = make("defs")
    this.svg.appendChild(this.defs)
    for (const gradient of [this.main, this.light]) {
      for (let at = 0; at <= BALL_STOPS; at++) gradient.appendChild(make("stop", { offset: at / BALL_STOPS }))
      this.defs.appendChild(gradient)
    }
    for (const gradient of [this.rim, this.lightRim]) {
      for (const [offset, opacity] of RIM_STOPS) gradient.appendChild(make("stop", { offset, "stop-opacity": opacity }))
      this.defs.appendChild(gradient)
    }
    this.tint = albedo(hex)
    this.setColor(hex)
  }

  setColor(hex: string): void {
    this.tint = albedo(hex)
    const light = lightAlbedo(hex)
    paintBall(this.main, this.tint)
    paintBall(this.light, light)
    paintRim(this.rim, this.tint)
    paintRim(this.lightRim, light)
  }

  private ball(light: boolean): Part {
    const group = make("g")
    const fill = make("circle", { fill: `url(#${(light ? this.light : this.main).id})` })
    const rim = make("circle", { fill: `url(#${(light ? this.lightRim : this.rim).id})` })
    const shadowFill = make("radialGradient", { id: newId("shadow"), gradientUnits: "userSpaceOnUse" })
    for (const [offset, opacity] of SHADOW_STOPS) shadowFill.appendChild(make("stop", { offset, "stop-color": "#000", "stop-opacity": opacity }))
    this.defs.appendChild(shadowFill)
    const shadow = make("circle", { fill: `url(#${shadowFill.id})` })
    group.append(fill, rim, shadow)
    return { group, depth: 0, fill, rim, shadow, shadowFill }
  }

  private stick(): Part {
    const group = make("g")
    const gradient = make("linearGradient", { id: newId("stick"), gradientUnits: "userSpaceOnUse" })
    const stops = Array.from({ length: STICK_STOPS }, (_, at) => gradient.appendChild(make("stop", { offset: at / (STICK_STOPS - 1) })))
    this.defs.appendChild(gradient)
    const path = make("path", { fill: `url(#${gradient.id})` })
    group.appendChild(path)
    return { group, depth: 0, path, gradient, stops }
  }

  /** Poses the figure. `shapes` keeps one order from frame to frame, and each ball's shadow comes from the shape `shadows` names for it. */
  draw(shapes: Shape[], project: Projection, shadows: Map<number, number> = new Map()): void {
    if (this.parts.length !== shapes.length) {
      this.parts.forEach((part) => {
        part.group.remove()
        part.gradient?.remove()
        part.shadowFill?.remove()
      })
      this.parts = shapes.map((shape) => (shape.ball ? this.ball(!!shape.light) : this.stick()))
      this.order = ""
    }
    shapes.forEach((shape, at) => {
      const part = this.parts[at]!
      if (shape.ball) this.poseBall(part, shape, project, shadows.has(at) ? shapes[shadows.get(at)!] : undefined)
      else this.poseStick(part, shape, project)
    })
    // Furthest first, and the document only changes when the order does.
    const order = this.parts.map((part, index) => ({ index, depth: part.depth })).sort((a, b) => b.depth - a.depth).map((entry) => entry.index)
    const key = order.join()
    if (key !== this.order) {
      this.order = key
      order.forEach((at) => this.svg.appendChild(this.parts[at]!.group))
    }
  }

  private poseBall(part: Part, shape: Extract<Shape, { ball: true }>, project: Projection, caster: Shape | undefined): void {
    const at = project(shape.c)
    const r = shape.r * at.perMeter
    part.depth = at.depth
    for (const circle of [part.fill!, part.rim!, part.shadow!]) {
      circle.setAttribute("cx", String(at.x))
      circle.setAttribute("cy", String(at.y))
      circle.setAttribute("r", String(r))
    }
    const shadow = part.shadow!
    shadow.setAttribute("display", caster ? "inline" : "none")
    if (!caster) return
    // The shadow of what touches this ball, thrown away from the key light from where it touches.
    const touch = caster.ball ? caster.c : caster.a
    const radius = caster.ball ? caster.r : caster.ra
    const on = project(add(shape.c, scale(unit(sub(touch, shape.c)), shape.r)))
    const gradient = part.shadowFill!
    gradient.setAttribute("cx", String(on.x - KEY[0] * radius * at.perMeter * SHADOW.throw))
    gradient.setAttribute("cy", String(on.y + KEY[1] * radius * at.perMeter * SHADOW.throw))
    gradient.setAttribute("r", String(radius * at.perMeter * SHADOW.size))
  }

  private poseStick(part: Part, shape: Extract<Shape, { ball: false }>, project: Projection): void {
    const a = project(shape.a)
    const b = project(shape.b)
    const ra = shape.ra * a.perMeter
    const rb = shape.rb * b.perMeter
    part.depth = (a.depth + b.depth) / 2 + (shape.ra === shape.rb ? LIMB_BEHIND : 0)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy)
    const axis = unit(sub(shape.b, shape.a))
    const path = part.path!
    if (d <= Math.abs(ra - rb) + 0.05) {
      // Pointing straight at us, it's only its nearer end.
      const r = Math.max(ra, rb)
      path.setAttribute("d", `M ${a.x - r} ${a.y} A ${r} ${r} 0 1 1 ${a.x + r} ${a.y} A ${r} ${r} 0 1 1 ${a.x - r} ${a.y} Z`)
    } else {
      const ux = dx / d
      const uy = dy / d
      const cosA = (ra - rb) / d
      const sinA = Math.sqrt(1 - cosA * cosA)
      const e1 = [ux * cosA - uy * sinA, uy * cosA + ux * sinA]
      const e2 = [ux * cosA + uy * sinA, uy * cosA - ux * sinA]
      const tip = `L ${b.x + rb * e1[0]!} ${b.y + rb * e1[1]!} A ${rb} ${rb} 0 0 0 ${b.x + rb * e2[0]!} ${b.y + rb * e2[1]!}`
      if (shape.ra !== shape.rb) {
        // A nose leaves its ball on a circle seen at an angle, so an ellipse, whose half toward the ball's center shows.
        const sx = -uy * ra
        const sy = ux * ra
        const turn = (Math.atan2(uy, ux) * 180) / Math.PI
        path.setAttribute("d", `M ${a.x + sx} ${a.y + sy} ${tip} L ${a.x - sx} ${a.y - sy} A ${Math.max(0.5, ra * Math.abs(axis[2]))} ${ra} ${turn} 0 0 ${a.x + sx} ${a.y + sy} Z`)
      } else {
        path.setAttribute("d", `M ${a.x + ra * e1[0]!} ${a.y + ra * e1[1]!} ${tip} L ${a.x + ra * e2[0]!} ${a.y + ra * e2[1]!} A ${ra} ${ra} 0 1 0 ${a.x + ra * e1[0]!} ${a.y + ra * e1[1]!} Z`)
      }
    }
    // Across it, its shading sampled from the tracer at each place around it.
    const side = d > 0.05 ? [-dy / d, dx / d] : [1, 0]
    const midX = (a.x + b.x) / 2
    const midY = (a.y + b.y) / 2
    const half = (ra + rb) / 2
    const gradient = part.gradient!
    gradient.setAttribute("x1", String(midX - side[0]! * half))
    gradient.setAttribute("y1", String(midY - side[1]! * half))
    gradient.setAttribute("x2", String(midX + side[0]! * half))
    gradient.setAttribute("y2", String(midY + side[1]! * half))
    const across: V = [side[0]!, -side[1]!, 0]
    const round = unit([axis[1] * across[2] - axis[2] * across[1], axis[2] * across[0] - axis[0] * across[2], axis[0] * across[1] - axis[1] * across[0]])
    const toViewer = round[2] < 0 ? scale(round, -1) : round
    const length = Math.hypot(...sub(shape.b, shape.a))
    const sinB = (shape.ra - shape.rb) / length
    const cosB = Math.sqrt(1 - sinB * sinB)
    part.stops!.forEach((stop, at) => {
      const s = (at / (STICK_STOPS - 1)) * 2 - 1
      const c = Math.sqrt(Math.max(0, 1 - s * s))
      stop.setAttribute("stop-color", surface(this.tint, unit(add(add(scale(toViewer, cosB * c), scale(across, cosB * s)), scale(axis, sinB)))))
    })
  }
}
