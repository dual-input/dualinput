// Pointer sync's panel module, which runs in each cockpit panel holding a synced display: it
// sends each gesture its pilot makes on one of its displays, as it happens, and plays each
// gesture another pilot made on its copy of that display, at the same fractions of the
// display's rect, under a lock that keeps its own pilot's presses off the display meanwhile
// (record/areas/pointer-sync/01-pointer-sync.md). It carries over the capture and the play of
// our FS Copilot fork's panel code (read in the FS Copilot fork, FsCopilot.Bridge/
// PackageSources/HTML_UI/FsCopilot/pointer.js), apart from when it sends.
//
// It only adds listeners and dispatches events, and the bridge owns every lock, so a module
// that fails partway blocks nothing for long (CLAUDE.md, "Before writing code that runs in a
// panel"). It runs in Coherent GT, so it keeps to ES2017, and esbuild compiles it to es2017.

import type { FromPanel } from "../../../../engines/messages/ts/pointer-sync/FromPanel.ts"
import type { Gesture } from "../../../../engines/messages/ts/pointer-sync/Gesture.ts"
import type { Lock } from "../../../../engines/messages/ts/pointer-sync/Lock.ts"
import type { Play } from "../../../../engines/messages/ts/pointer-sync/Play.ts"
import type { Point } from "../../../../engines/messages/ts/pointer-sync/Point.ts"
import { keyFor, type PanelCtx, type PanelModuleDef, type UnseenLock } from "../../../../platform/panel-bridge/src/bridge.ts"

/**
 * The module's name, its feature's, and its slice's. `pointer_sync::NAME` in
 * src/engines/messages/src/pointer_sync.rs names it too, and so does this module's file,
 * src/features/pointer-sync/panel/pointer-sync.ts, which the build makes the bridge's
 * /DualInput/modules/pointer-sync.js, so change all three together.
 */
export const NAME = "pointer-sync"

/** A move goes at most this often, as FS Copilot samples a drag (pointer.js, `DRAG_SAMPLE_MS`). */
const MOVE_EVERY_MS = 33
/** A move goes only once the pointer has moved this far from the last point sent, horizontally and vertically together (`DRAG_MIN_STEP_PX`). */
const MOVE_STEP_PX = 2
/** An up is a click when the pointer never got this far from the down (`DRAG_MIN_PX`). */
const CLICK_WITHIN_PX = 4
/** `Held` goes each time this passes with nothing else sent. */
const HELD_EVERY_MS = 1000
/**
 * A gesture whose pilot neither moves nor releases for this long ends with an up, and no
 * click, since an up the panel never hears, as when the pilot releases off the panel, would
 * otherwise keep the other pilot's display locked by its `Held` messages (user, 2026-10-25).
 */
const STILL_ENDS_MS = 30_000
/**
 * A gesture another pilot made ends here this long after its last message, as its lock lapses.
 * `UNSEEN_HOLDS_MS` in src/platform/panel-bridge/src/locks.ts is the same 2s, so change both
 * together: a lock that lapses first leaves the rest of the gesture playing unlocked.
 */
const LAPSES_MS = 2000
/** Where a press's target isn't an element, a point this far outside a display's rect, in fractions of it, still starts a gesture there (`EDGE_TOLERANCE`). */
const EDGE = 0.02

/** What the visible lock says, by why it holds (user, 2026-10-25). */
const LOCK_TEXT: Record<Lock, string | null> = {
  none: null,
  "no-link": "Lost the connection to the pilot flying. Take control to keep flying, or wait for the connection to come back.",
  "catching-up": "Catching up with the pilot flying's cockpit. This display unlocks when it's done.",
}

type Display = { key: string; el: Element }

/** This pilot's gesture, from its down to its up. */
type Open = {
  display: Display
  button: number
  /** Where the down was, and the last point sent, in the viewport's px. */
  downX: number
  downY: number
  sentX: number
  sentY: number
  sentAt: number
  /** When the pilot last moved, sent or not. */
  movedAt: number
  /** How far the pointer got from the down, horizontally and vertically together. */
  travelled: number
  held: ReturnType<typeof setTimeout>
}

/** Another pilot's gesture, playing on a display. */
type Playing = {
  /** Nothing was under its down, so none of it plays. */
  missed: boolean
  target: Element | null
  button: number
  last: Point
  lock: UnseenLock | null
  /** Its lock lapsed and it ended, so more of it starts it again. */
  lapsed: boolean
  lapse: ReturnType<typeof setTimeout> | null
}

/** The module's definition, which its file hands the bridge. */
export function pointerSync(): PanelModuleDef {
  let running: Running | null = null
  return {
    start(ctx) {
      running = new Running(ctx)
    },
    stop() {
      if (running) running.stop()
      running = null
    },
  }
}

class Running {
  private readonly ctx: PanelCtx
  private readonly displays: Display[]
  private open: Open | null = null
  private readonly playing = new Map<string, Playing>()
  /** The visible lock's words as the slice last gave them. */
  private visible: string | null = null
  private readonly listeners: Array<[string, (e: Event) => void]> = []

  constructor(ctx: PanelCtx) {
    this.ctx = ctx
    this.displays = ctx.instruments.map((el) => ({ key: keyFor(el), el }))
    // The capture phase on the document, since a display's own handlers may stop an event's
    // propagation, and the sim delivers each event to the deepest node (pointer.js, `_listen`).
    this.listen("mousedown", (e) => this.down(e as MouseEvent))
    this.listen("mousemove", (e) => this.move(e as MouseEvent))
    this.listen("mouseup", (e) => this.up(e as MouseEvent))
    ctx.on((body) => this.play(body as unknown as Play))
    ctx.watch(NAME, (value) => this.lockAll(LOCK_TEXT[value as Lock] || null))
    this.send({ t: "displays", displays: this.displays.map((d) => d.key) })
  }

  stop(): void {
    // The feature waits on no up from a panel whose module has stopped, as after
    // `window.DUALINPUT_BRIDGE_UNLOCK()`, which leaves the socket open.
    this.send({ t: "displays", displays: [] })
    for (const [type, f] of this.listeners) this.ctx.document.removeEventListener(type, f, true)
    if (this.open) clearTimeout(this.open.held)
    this.open = null
    // A gesture left playing would leave its display mid-press or mid-drag.
    this.playing.forEach((p, key) => this.end(key, p))
  }

  private listen(type: string, f: (e: Event) => void): void {
    this.ctx.document.addEventListener(type, f, true)
    this.listeners.push([type, f])
  }

  private send(message: FromPanel): void {
    this.ctx.send(message)
  }

  private gesture(display: Display, gesture: Gesture): void {
    this.send({ t: "gesture", display: display.key, gesture })
  }

  // Capture.

  private down(e: MouseEvent): void {
    if (this.ctx.ours(e)) return
    // A release the panel never heard ends no later than the pilot's next press, wherever it
    // lands.
    if (this.open) this.close(this.open.sentX, this.open.sentY, false)
    // A press on a lock starts no gesture, since the lock took it.
    if (this.ctx.onLock(e)) return
    const display = this.inside(e)
    if (!display) return
    const at = this.point(display, e.clientX, e.clientY)
    if (!at) return
    const now = Date.now()
    this.open = {
      display,
      button: e.button,
      downX: e.clientX,
      downY: e.clientY,
      sentX: e.clientX,
      sentY: e.clientY,
      sentAt: now,
      movedAt: now,
      travelled: 0,
      held: this.heldTimer(),
    }
    this.gesture(display, { down: { button: e.button, point: at } })
  }

  private move(e: MouseEvent): void {
    const open = this.open
    if (!open || this.ctx.ours(e)) return
    open.travelled = Math.max(open.travelled, Math.abs(e.clientX - open.downX) + Math.abs(e.clientY - open.downY))
    const now = Date.now()
    open.movedAt = now
    if (now - open.sentAt < MOVE_EVERY_MS) return
    if (Math.abs(e.clientX - open.sentX) + Math.abs(e.clientY - open.sentY) < MOVE_STEP_PX) return
    const at = this.point(open.display, e.clientX, e.clientY)
    if (!at) return
    open.sentX = e.clientX
    open.sentY = e.clientY
    open.sentAt = now
    this.rearm(open)
    this.gesture(open.display, { move: { point: at } })
  }

  private up(e: MouseEvent): void {
    const open = this.open
    // A mouseup with no gesture open sends nothing, since an up alone plays nothing on the
    // other display (user, 2026-10-18).
    if (!open || this.ctx.ours(e) || e.button !== open.button) return
    open.travelled = Math.max(open.travelled, Math.abs(e.clientX - open.downX) + Math.abs(e.clientY - open.downY))
    this.close(e.clientX, e.clientY, open.travelled < CLICK_WITHIN_PX)
  }

  /** Ends this pilot's open gesture with its up, then lets the locks it held back come. */
  private close(x: number, y: number, click: boolean): void {
    const open = this.open
    if (!open) return
    this.open = null
    clearTimeout(open.held)
    const at = this.point(open.display, x, y) || { x: 0, y: 0 }
    this.gesture(open.display, { up: { point: at, click } })
    const playing = this.playing.get(open.display.key)
    if (playing && !playing.missed && !playing.lapsed && !playing.lock) playing.lock = this.ctx.unseenLock(open.display.el)
    this.ctx.visibleLock(open.display.el, this.visible)
  }

  private heldTimer(): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const open = this.open
      if (!open) return
      const now = Date.now()
      if (now - open.movedAt >= STILL_ENDS_MS) return this.close(open.sentX, open.sentY, false)
      open.sentAt = now
      open.held = this.heldTimer()
      this.gesture(open.display, "held")
    }, HELD_EVERY_MS)
  }

  private rearm(open: Open): void {
    clearTimeout(open.held)
    open.held = this.heldTimer()
  }

  /**
   * The display a press starts a gesture on: the one its target lies in, or where the target
   * isn't an element, the one whose rect its point lies within 0.02 of (pointer.js, `_inside`).
   */
  private inside(e: MouseEvent): Display | null {
    const target = e.target as Node | null
    if (target && target.nodeType === 1) {
      for (const d of this.displays) if (d.el.contains(target)) return d
      return null
    }
    for (const d of this.displays) {
      const at = this.point(d, e.clientX, e.clientY)
      if (at && at.x >= -EDGE && at.x <= 1 + EDGE && at.y >= -EDGE && at.y <= 1 + EDGE) return d
    }
    return null
  }

  /** A point in the viewport as fractions of the display's rect, or `null` while it has no size. */
  private point(display: Display, x: number, y: number): Point | null {
    const r = display.el.getBoundingClientRect()
    if (!r.width || !r.height) return null
    return { x: (x - r.left) / r.width, y: (y - r.top) / r.height }
  }

  // Play.

  private play(message: Play): void {
    // The feature sends a panel only gestures for instruments it serves.
    const display = this.displays.find((d) => d.key === message.display)
    if (!display) return
    const g = message.gesture
    const key = display.key
    if (g === "held") {
      const p = this.playing.get(key)
      if (p && !p.missed) {
        if (p.lapsed) this.restart(display, p, p.last)
        this.renew(display, p)
      }
    } else if ("down" in g) {
      const before = this.playing.get(key)
      if (before) this.end(key, before)
      this.begin(display, g.down.button, g.down.point)
    } else if ("move" in g) {
      const p = this.playing.get(key)
      if (!p || p.missed) return
      if (p.lapsed) this.restart(display, p, g.move.point)
      const xy = this.pixels(display, g.move.point)
      if (xy) this.ctx.fire(this.ctx.hitTest(xy.x, xy.y) || p.target!, "mousemove", xy.x, xy.y, p.button)
      p.last = g.move.point
      this.renew(display, p)
    } else {
      const p = this.playing.get(key)
      if (p && !p.missed) {
        if (p.lapsed) this.restart(display, p, g.up.point)
        const xy = this.pixels(display, g.up.point)
        if (xy) {
          const target = this.ctx.hitTest(xy.x, xy.y) || p.target!
          this.ctx.fire(target, "mouseup", xy.x, xy.y, p.button)
          if (g.up.click) this.ctx.fire(target, "click", xy.x, xy.y, p.button)
        }
        this.finish(key, p)
      } else if (p) {
        this.finish(key, p)
      }
      if (message.up !== undefined) this.send({ t: "done", up: message.up })
    }
  }

  /** Another pilot's down: its press at whatever lies under the point, which plays nothing when nothing does. */
  private begin(display: Display, button: number, at: Point): void {
    const xy = this.pixels(display, at)
    const target = xy ? this.ctx.hitTest(xy.x, xy.y) : null
    const p: Playing = { missed: !target, target, button, last: at, lock: null, lapsed: false, lapse: null }
    this.playing.set(display.key, p)
    if (!target || !xy) return
    this.ctx.fire(target, "mousedown", xy.x, xy.y, button)
    this.renew(display, p)
  }

  /** More of a gesture whose lock lapsed, late over a path that stalled or in a replay: it starts again with a down at its point. */
  private restart(display: Display, p: Playing, at: Point): void {
    const xy = this.pixels(display, at)
    if (!xy) return
    p.target = this.ctx.hitTest(xy.x, xy.y) || p.target
    p.lapsed = false
    if (p.target) this.ctx.fire(p.target, "mousedown", xy.x, xy.y, p.button)
  }

  /**
   * Holds the gesture's lock another 2s, and asks for one once its own pilot's gesture on the
   * display has ended, so a pilot whose button is down there keeps their gesture whole.
   */
  private renew(display: Display, p: Playing): void {
    if (p.lapse) clearTimeout(p.lapse)
    p.lapse = setTimeout(() => this.lapsed(display.key, p), LAPSES_MS)
    if (p.lock) p.lock.renew()
    else if (!this.open || this.open.display !== display) p.lock = this.ctx.unseenLock(display.el)
  }

  /**
   * 2s with nothing more of the gesture: it ends with a `mouseup` on the document, which lands on
   * no control, so the display's own drag or hold ends without acting (unverified; a case in
   * the sim settles it).
   */
  private lapsed(key: string, p: Playing): void {
    if (this.playing.get(key) !== p) return
    p.lapse = null
    this.ctx.fire(this.ctx.document, "mouseup", 0, 0, p.button)
    p.lapsed = true
    if (p.lock) p.lock.release()
    p.lock = null
  }

  /** Ends a gesture before its up, as a lapse does, for a new down on its display or the module's stop. */
  private end(key: string, p: Playing): void {
    if (!p.missed && !p.lapsed) this.ctx.fire(this.ctx.document, "mouseup", 0, 0, p.button)
    this.finish(key, p)
  }

  private finish(key: string, p: Playing): void {
    if (p.lapse) clearTimeout(p.lapse)
    if (p.lock) p.lock.release()
    if (this.playing.get(key) === p) this.playing.delete(key)
  }

  /** A point as px in the viewport, from fractions of the display's rect. */
  private pixels(display: Display, at: Point): { x: number; y: number } | null {
    const r = display.el.getBoundingClientRect()
    if (!r.width || !r.height) return null
    return { x: Math.round(r.left + at.x * r.width), y: Math.round(r.top + at.y * r.height) }
  }

  // The visible lock.

  /** Locks every display, or unlocks them, each once its own pilot's gesture there has ended. */
  private lockAll(text: string | null): void {
    this.visible = text
    for (const d of this.displays) if (!this.open || this.open.display !== d) this.ctx.visibleLock(d.el, text)
  }
}
