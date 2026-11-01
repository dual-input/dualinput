// The pilot's figure standing on home's page when the aircraft's profile has no notes. It stays a little alive at
// rest, breathing and shifting its weight, follows the cursor with its head, and grows impatient while the pilot
// moves the cursor around without hosting: a foot taps, it glances up at Host and back, its hands drum on its hips,
// and at last it shrugs, holding the shrug while the cursor is shaken at it. Hovering Host, the code field, or Join
// makes it hop and freeze mid-whatever, breath held, leaning toward it with its eyes on the cursor. Pressing Host or
// Join winds it up, and once our servers answer it jumps for joy and falls over backward, off the page.

import { useRoot } from "@dualinput/ui"
import { useEffect, useRef } from "react"
import type { RefObject } from "react"

import { add, scale, sub, unit } from "@dualinput/crew/trace"
import type { V } from "@dualinput/crew/trace"
import { FigureDrawing } from "./drawing.ts"
import { body, BODY_SHADOWS, CHEST_UP, cheerOver, cheerPose, FEET, FOOT, HANDS_ON_HIPS, HEAD_UP, HIPS_UP, lerp, newCheer, SHRUG_HANDS, smooth, standingProjection, stepCheer, TAKEOFF, turnAbout } from "./standing-pose.ts"
import type { Cheer, Pose } from "./standing-pose.ts"

/** Marks what the figure reacts to in the page around it: what it locks on to, what winds it up when pressed, and Host, which it looks at by default. */
export const FIGURE_MARKS = { target: "data-figure-target", press: "data-figure-press", host: "data-figure-host" }

/** What the page tells the figure of an attempt to host or join. */
export class FigureSignals {
  onAttempt = () => {}
  onAnswer = (_ok: boolean) => {}
  onCancel = () => {}
}

/** How it moves, in seconds and meters. Impatience grows with every pixel the cursor travels without hosting, and drains once the cursor rests; past each level the figure adds a gesture, and at the last it shrugs and calms down to the second. */
const IDLE = { breath: 4.2, breathe: 0.005, sway: 7.5, shift: 0.018, bend: 0.035 }
const IMPATIENCE = { tap: 250, glance: 700, drum: 1200, shrug: 1800, after: 900, rest: 1.5, drain: 500 }
const TAP = { rate: 2.4, lift: 0.035, knee: 1 }
const GLANCE = { every: 3.2, hold: 0.7 }
const DRUM = { rate: 5, lift: 0.012 }
const SHRUG = { rise: 0.3, hold: 0.7, fall: 0.5, lift: 0.035, tilt: 0.02, up: 0.25, tease: 900, window: 0.25 }
const PERK = { lean: [-0.035, 0, 0.02] as V, ease: 0.15, lock: 0.3, relax: 6 }
const PULL = { hips: 0.02, lean: 0.06, rate: 6 }
const HOP = { height: 0.03, peak: 0.1, decay: 8, length: 0.6 }
/** At rest it moves only by breathing and shifting, by under 2px, so it's posed at most this often then, in milliseconds. */
const IDLE_FRAME = 150

const envelope = (t: number, rise: number, hold: number, fall: number) => (t < 0 ? 0 : t < rise ? smooth(t / rise) : t < rise + hold ? 1 : t < rise + hold + fall ? 1 - smooth((t - rise - hold) / fall) : 0)
const hop = (t: number) => (t < 0 || t >= HOP.length ? 0 : (Math.exp(-HOP.decay * t) * Math.sin((Math.PI / 2 / HOP.peak) * t)) / Math.exp(-HOP.decay * HOP.peak))

export type StandingFigureProps = {
  hex: string
  /** The page around it, whose marked elements it reacts to, and whose cursor it follows. */
  page: RefObject<HTMLElement | null>
  signals: FigureSignals
  /** Once the leap has carried the whole figure off its drawing, it's gone for good. */
  onGone: () => void
}

export function StandingFigure({ hex, page: pageRef, signals, onGone }: StandingFigureProps) {
  const holder = useRef<HTMLDivElement>(null)
  const { scale: rootScale } = useRoot()
  const goneNow = useRef(onGone)
  goneNow.current = onGone

  useEffect(() => {
    const element = holder.current
    const page = pageRef.current
    if (!element || !page) return
    // It keeps the height it opens with, from the bottom of the room it's given, so it stays put when the start card grows over a refusal and the room shrinks from the top. The card covers its empty top.
    const width = element.offsetWidth
    const height = element.offsetHeight
    const drawing = new FigureDrawing(hex, width, height)
    drawing.svg.style.position = "absolute"
    drawing.svg.style.left = "0"
    drawing.svg.style.bottom = "0"
    element.appendChild(drawing.svg)
    const project = standingProjection(width, height)

    const host = page.querySelector<HTMLElement>(`[${FIGURE_MARKS.host}]`)
    let cursor: [number, number] | null = null
    let impatience = 0
    let lastMove = -Infinity
    let moves: [number, number][] = []
    let hopAt = -Infinity
    let cheer: Cheer | null = null
    let hovered: HTMLElement | null = null
    let focused: HTMLElement | null = null
    const attended = () => hovered ?? focused
    let lean = 0
    let pull = 0
    let look: V | null = null
    // The body's own clock, which stops while it attends to a target, so breathing, shifting, tapping, drumming, and the shrug all freeze where they are.
    let clock = 0
    let shrugAt = -Infinity
    let heldUntil = -Infinity
    let shrugShown = 0
    let tapAmount = 0
    let drumAmount = 0

    const onMove = (event: MouseEvent) => {
      const x = event.clientX / rootScale
      const y = event.clientY / rootScale
      if (cursor && !attended()) {
        const d = Math.hypot(x - cursor[0], y - cursor[1])
        impatience += d
        moves.push([performance.now(), d])
      }
      cursor = [x, y]
      lastMove = performance.now()
    }
    const onLeave = () => {
      cursor = null
    }
    // Attention starting makes it hop; ending, it forgets everything it was impatient about.
    const attend = (change: () => void) => {
      const before = attended()
      change()
      const after = attended()
      if (!before && after) hopAt = performance.now()
      if (before && !after) {
        impatience = 0
        shrugAt = heldUntil = -Infinity
      }
    }
    const targets = Array.from(page.querySelectorAll<HTMLElement>(`[${FIGURE_MARKS.target}]`))
    const listeners: [HTMLElement, string, () => void][] = []
    for (const target of targets) {
      listeners.push(
        [target, "mouseenter", () => attend(() => (hovered = target))],
        [target, "mouseleave", () => attend(() => hovered === target && (hovered = null))],
        [target, "focusin", () => attend(() => (focused = target))],
        [target, "focusout", () => attend(() => focused === target && (focused = null))],
      )
    }
    // A press on Host or Join winds it up; let go on the button, the click's attempt follows, and let go anywhere else, it straightens back up.
    let pressedOn: HTMLElement | null = null
    const presses = Array.from(page.querySelectorAll<HTMLElement>(`[${FIGURE_MARKS.press}]`))
    const fresh = () => !cheer || cheer.answer === "no" || cheer.canceling >= 0
    const onPress = (event: MouseEvent) => {
      if (event.button !== 0) return
      pressedOn = event.currentTarget as HTMLElement
      if (fresh()) cheer = newCheer("pressing")
    }
    const onRelease = (event: MouseEvent) => {
      if (!pressedOn) return
      if (cheer?.answer === "pressing") {
        if (pressedOn.contains(event.target as Node)) cheer.answer = "waiting"
        else cheer.canceling = 0
      }
      pressedOn = null
    }
    presses.forEach((press) => press.addEventListener("mousedown", onPress))
    window.addEventListener("mouseup", onRelease)
    page.addEventListener("mousemove", onMove)
    page.addEventListener("mouseleave", onLeave)
    for (const [target, type, listener] of listeners) target.addEventListener(type, listener)
    signals.onAttempt = () => {
      if (fresh()) cheer = newCheer("waiting")
      else if (cheer?.answer === "pressing") cheer.answer = "waiting"
    }
    signals.onAnswer = (ok) => {
      if (cheer?.answer !== "waiting") return
      cheer.answer = ok ? "ok" : "no"
      if (!ok) cheer.deflating = 0
    }
    signals.onCancel = () => {
      if (cheer && !fresh() && cheer.answer !== "ok") cheer.canceling = 0
    }

    const rectOf = () => element.getBoundingClientRect()
    /** The direction from the head toward a point on the page, as if the page were a window a little in front of the figure. */
    const toward = (x: number, y: number, head: V): V => {
      const r = rectOf()
      const at = project(head)
      return unit([x - (r.left + at.x), -(y - (r.top + r.height - height + at.y)), width * 1.6])
    }
    const center = (target: Element | null | undefined): [number, number] | null => {
      const r = target?.getBoundingClientRect()
      return r ? [r.left + r.width / 2, r.top + r.height / 2] : null
    }
    /** Where its eyes go on what it attends to: the cursor on a hovered one, and on a focused one the slot being typed in. */
    const spot = () => (hovered ? cursor : center(focused?.querySelector('[data-active="true"]') ?? focused))
    const across = () => {
      const r = attended()?.getBoundingClientRect()
      const s = spot()
      return r && s ? Math.max(-1, Math.min(1, ((s[0] - r.left) / r.width) * 2 - 1)) : 0
    }

    let drawn = false
    let posedAt = -Infinity
    let last = performance.now()
    let frame = 0
    const tick = () => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      const ease = (rate: number) => 1 - Math.exp(-rate * dt)
      if (now - lastMove > IMPATIENCE.rest * 1000) impatience = Math.max(0, impatience - IMPATIENCE.drain * dt)
      moves = moves.filter(([at]) => now - at < SHRUG.window * 1000)
      const speed = moves.reduce((sum, [, d]) => sum + d, 0) / SHRUG.window

      const attending = attended() !== null
      let shrugTarget = shrugShown
      const shrugBefore = shrugShown
      if (!attending) {
        clock += dt
        const hold = () => Math.max(SHRUG.hold, Number.isFinite(heldUntil) ? heldUntil - shrugAt - SHRUG.rise : 0)
        // Teasing, shaking the cursor at it, keeps a shrug that's under way at its height.
        const since = clock - shrugAt
        if (since >= 0 && since < SHRUG.rise + hold() && speed > SHRUG.tease) heldUntil = clock + 0.2
        if (impatience >= IMPATIENCE.shrug && !(since <= SHRUG.rise + hold() + SHRUG.fall)) {
          shrugAt = clock
          heldUntil = -Infinity
          impatience = IMPATIENCE.after
        }
        shrugTarget = envelope(clock - shrugAt, SHRUG.rise, hold(), SHRUG.fall)
        shrugShown += (shrugTarget - shrugShown) * ease(PERK.relax * 2)
        const calm = shrugTarget === 0
        tapAmount += ((calm && impatience >= IMPATIENCE.tap ? 1 : 0) - tapAmount) * ease(PERK.relax)
        drumAmount += ((calm && impatience >= IMPATIENCE.drum ? 1 : 0) - drumAmount) * ease(PERK.relax)
      }
      const shrug = shrugShown
      const glancing = !attending && shrugTarget === 0 && impatience >= IMPATIENCE.glance && clock % GLANCE.every < GLANCE.hold
      const leanBefore = lean
      const pullBefore = pull
      lean += ((attending ? 1 : 0) - lean) * PERK.ease
      pull += ((attending ? across() : 0) - pull) * ease(PULL.rate)

      const breathe = Math.sin((clock * 2 * Math.PI) / IDLE.breath)
      const sway = Math.sin((clock * 2 * Math.PI) / IDLE.sway)
      const hips: V = [IDLE.shift * sway + PULL.hips * pull, HIPS_UP + HOP.height * hop((now - hopAt) / 1000), 0]
      const leaning = add(scale(PERK.lean, lean), [PULL.lean * pull, 0, 0])
      const chest = add(hips, [0, CHEST_UP + IDLE.breathe * breathe + SHRUG.lift * shrug, 0])
      const head = add(hips, [SHRUG.tilt * shrug, HEAD_UP + IDLE.breathe * breathe + SHRUG.lift * shrug, 0])

      // The head eases toward Host at first, while glancing, and once the cursor leaves the page; toward the cursor otherwise, tipping up a little in the shrug; and on a target it locks on, quickly.
      const target = attending ? spot() : !cursor || glancing ? (center(host) ?? cursor) : cursor
      const aim = target ? toward(target[0], target[1], add(turnAbout(hips, head), leaning)) : ([0, 0, 1] as V)
      const from: V = look ?? aim
      const next = unit(add(from, scale(sub(unit(add(aim, [0, SHRUG.up * shrug, 0])), from), attending ? PERK.lock : 0.12)))
      const turning = Math.hypot(...sub(next, from)) > 2e-4
      look = next

      if (cheer) {
        stepCheer(cheer, dt)
        if (cheerOver(cheer)) cheer = null
      }
      // With the page hidden, it keeps time but draws nothing, since drawing is the cost.
      if (element.offsetParent === null) {
        frame = requestAnimationFrame(tick)
        return
      }
      const gesturing = !attending && (tapAmount > 0.01 || drumAmount > 0.01 || Math.abs(shrug - shrugBefore) > 1e-4)
      const moving = turning || gesturing || cheer !== null || Math.abs(lean - leanBefore) > 1e-4 || Math.abs(pull - pullBefore) > 1e-4 || now - hopAt < HOP.length * 1000
      if (moving || !drawn || (!attending && now - posedAt > IDLE_FRAME)) {
        const drum = [0, 1].map((k) => drumAmount * DRUM.lift * Math.max(0, Math.sin(clock * 2 * Math.PI * DRUM.rate + k * Math.PI)))
        const tap = tapAmount * TAP.lift * Math.max(0, Math.sin(clock * 2 * Math.PI * TAP.rate))
        const pose: Pose = {
          hips,
          chest,
          head,
          look: next,
          lean: leaning,
          hands: [0, 1].map((k): V => {
            const side = k === 0 ? -1 : 1
            const onHips = add(hips, [side * (HANDS_ON_HIPS.out + drum[k]! * 0.5), HANDS_ON_HIPS.up + drum[k]!, HANDS_ON_HIPS.fwd])
            return lerp(onHips, add(chest, [side * SHRUG_HANDS.out, SHRUG_HANDS.up, SHRUG_HANDS.fwd]), shrug)
          }) as [V, V],
          // The foot on the viewer's right taps.
          feet: [0, 1].map((k): V => [(k === 0 ? -1 : 1) * FEET.out, FOOT + (k === 1 ? tap : 0), FEET.fwd]) as [V, V],
          // The leg that carries less weight bends a little at the knee, and so does a tapping one.
          knees: [0, 1].map((k) => IDLE.bend * Math.max(0, (k === 0 ? 1 : -1) * sway) + (k === 1 ? tap * TAP.knee : 0)) as [number, number],
        }
        const shapes = body(cheer ? cheerPose(pose, cheer) : pose)
        if (cheer && cheer.t > TAKEOFF) {
          const off = shapes.every((shape) => {
            const at = project(shape.ball ? shape.c : shape.a)
            return at.y - 40 > height || at.x + 40 < 0 || at.x - 40 > width
          })
          if (off) {
            goneNow.current()
            return
          }
        }
        drawing.draw(shapes, project, BODY_SHADOWS)
        drawn = true
        posedAt = now
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      page.removeEventListener("mousemove", onMove)
      page.removeEventListener("mouseleave", onLeave)
      for (const [target, type, listener] of listeners) target.removeEventListener(type, listener)
      presses.forEach((press) => press.removeEventListener("mousedown", onPress))
      window.removeEventListener("mouseup", onRelease)
      signals.onAttempt = () => {}
      signals.onAnswer = () => {}
      signals.onCancel = () => {}
      drawing.svg.remove()
    }
    // A new color draws anew; the rest are fixed for the figure's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex])

  return <div ref={holder} className="absolute inset-x-0 bottom-0 top-0" />
}
