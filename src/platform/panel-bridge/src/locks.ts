// The bridge's locks, which keep a pilot's presses off a display while pointer sync can't sync
// them. Each is an overlay over one display's rect, on top of everything in the panel, that
// takes the presses meant for the display (record/areas/pointer-sync/01-pointer-sync.md,
// "Locks"; record/areas/architecture/02-code-map.md, "What the bridge owns").
//
// Anything in the pilot's input path must fail open, since a lock left standing takes every
// press on the display, as FS Copilot's probe that wrapped a sim API left an aircraft's clicks
// dead (CLAUDE.md, "Before writing code that runs in a panel"). So each lock ends on its own:
// an unseen lock 2s after its module last renewed it, and a visible lock turns into a warning
// that blocks nothing once the core has been silent for 8s. Every element of ours carries
// MARK, so `window.DUALINPUT_BRIDGE_UNLOCK()` removes them all even when the bridge has lost
// track of one.

/** An unseen lock, which blocks presses while another pilot's gesture plays on a display. */
export interface UnseenLock {
  /** Holds the lock another 2s. */
  renew(): void
  release(): void
}

/**
 * How long an unseen lock holds after its module last renewed it. `LAPSES_MS` in
 * src/features/pointer-sync/panel/src/module.ts is the same 2s, after which the module ends the
 * gesture, so change both together: a lock that lapses first leaves the rest of the gesture
 * playing unlocked.
 */
const UNSEEN_HOLDS_MS = 2000

/**
 * A press a lock took holds the lock until its up, and one whose up the panel never hears, as
 * when the pilot releases off the panel, holds it this long at most, so a lost up never
 * leaves a display blocking.
 */
const PRESS_HOLDS_MS = 10_000

/** The flash and the visible lock (user, 2026-10-17). */
const RED_ORANGE = "rgba(255, 69, 0, 0.6)"
/** The warning, which blocks nothing, so it looks unlike a lock. */
const GRAY = "rgba(48, 48, 48, 0.55)"

/** What the warning says, once the core has been silent for 8s (user, 2026-10-25). */
const WARNING = "Dual Input stopped responding, so presses on this display aren't shared with the other pilot."

/** The attribute on every element of ours. */
const MARK = "data-dualinput-lock"

/** The property the bridge sets on each event a module fires. */
export const FIRED = "dualInputFired"

/**
 * Whether we dispatched an event: a module fired it, or it's synthetic. The sim delivers the
 * pilot's input trusted, and no synthetic event can be (measured on MSFS 2024, 2026-08-30, FS
 * Copilot fork, record/pointer-forwarding/docs/build/log.md, "Q03 PASSES: a synthetic mouse
 * click drives a React/SVG display").
 */
export function fired(event: Event): boolean {
  return (event as Event & { [FIRED]?: boolean })[FIRED] === true || event.isTrusted === false
}

/** The events a press on a lock sends, none of which may reach the display or the page's own listeners. */
const POINTER_EVENTS = ["mousedown", "mouseup", "click", "dblclick", "mousemove", "contextmenu", "wheel"]

type Overlay = {
  module: string
  instrument: Element
  /** The unseen lock, with the timer that ends it. */
  unseen: { handle: object; timer: ReturnType<typeof setTimeout> } | null
  /** The visible lock's words. */
  visible: string | null
  /** A press the overlay took is down, so the overlay stays until its up. */
  pressed: boolean
  el: HTMLElement | null
  text: HTMLElement | null
}

export class Locks {
  private readonly doc: Document
  private readonly overlays: Overlay[] = []
  /** The core has been silent for 8s, so each visible lock shows as the warning. */
  private silent = false
  // A module's own `mouseup`, such as the one that ends another pilot's gesture, isn't the up of
  // the pilot's press.
  private readonly onUp = (e: Event): void => {
    if (!fired(e)) this.released()
  }
  private listeningForUp = false
  private pressDeadman: ReturnType<typeof setTimeout> | null = null

  constructor(doc: Document) {
    this.doc = doc
  }

  /** An unseen lock over `instrument` for `module`, which replaces any it held there. */
  unseen(module: string, instrument: Element): UnseenLock {
    const overlay = this.overlay(module, instrument)
    if (overlay.unseen) clearTimeout(overlay.unseen.timer)
    const handle = {}
    const lapse = (): ReturnType<typeof setTimeout> =>
      setTimeout(() => {
        if (overlay.unseen && overlay.unseen.handle === handle) {
          overlay.unseen = null
          this.render(overlay)
        }
      }, UNSEEN_HOLDS_MS)
    overlay.unseen = { handle, timer: lapse() }
    this.render(overlay)
    return {
      renew: () => {
        if (!overlay.unseen || overlay.unseen.handle !== handle) return
        clearTimeout(overlay.unseen.timer)
        overlay.unseen.timer = lapse()
        this.render(overlay)
      },
      release: () => {
        if (!overlay.unseen || overlay.unseen.handle !== handle) return
        clearTimeout(overlay.unseen.timer)
        overlay.unseen = null
        this.render(overlay)
      },
    }
  }

  /** Shows `text` as the visible lock over `instrument`, or takes the visible lock away with `null`. */
  visible(module: string, instrument: Element, text: string | null): void {
    const overlay = text === null ? this.find(module, instrument) : this.overlay(module, instrument)
    if (!overlay || overlay.visible === text) return
    overlay.visible = text
    this.render(overlay)
  }

  /** The core's silence began or ended. */
  setSilent(silent: boolean): void {
    if (this.silent === silent) return
    this.silent = silent
    for (const overlay of this.overlays.slice()) this.render(overlay)
  }

  /** Drops every lock `module` holds, at once, a press held on one included. */
  drop(module: string): void {
    for (const overlay of this.overlays.filter((o) => o.module === module)) this.remove(overlay)
  }

  /** Drops every lock, and every element of ours the bridge lost track of. */
  dropAll(): void {
    for (const overlay of this.overlays.slice()) this.remove(overlay)
    const strays = this.doc.querySelectorAll(`[${MARK}]`)
    for (let i = 0; i < strays.length; i++) {
      const stray = strays[i]!
      if (stray.parentNode) stray.parentNode.removeChild(stray)
    }
    this.stopListeningForUp()
  }

  /**
   * The element at a point, looking past every lock, so a gesture played under one reaches the
   * display. Each lock ignores hit-testing only for this one synchronous call, so no real press
   * gets through in between (read in the FS Copilot fork, FsCopilot.Bridge/PackageSources/
   * HTML_UI/FsCopilot/overlay.js, `hitTest`). That Coherent GT applies the style before
   * `elementFromPoint` runs is unverified, and a case in the sim settles it.
   */
  hitTest(x: number, y: number): Element | null {
    const shown = this.overlays.filter((o) => o.el !== null)
    const before = shown.map((o) => o.el!.style.pointerEvents)
    for (const o of shown) o.el!.style.pointerEvents = "none"
    try {
      return this.doc.elementFromPoint(x, y)
    } finally {
      shown.forEach((o, i) => (o.el!.style.pointerEvents = before[i]!))
    }
  }

  /** Whether `target` is one of the locks, or inside one. */
  isLock(target: EventTarget | null): boolean {
    return this.overlays.some((o) => o.el !== null && (o.el === target || o.el.contains(target as Node)))
  }

  private find(module: string, instrument: Element): Overlay | undefined {
    for (const o of this.overlays) if (o.module === module && o.instrument === instrument) return o
    return undefined
  }

  private overlay(module: string, instrument: Element): Overlay {
    const found = this.find(module, instrument)
    if (found) return found
    const overlay: Overlay = { module, instrument, unseen: null, visible: null, pressed: false, el: null, text: null }
    this.overlays.push(overlay)
    return overlay
  }

  /** Draws the overlay as its state has it, or takes it away once nothing holds it. */
  private render(overlay: Overlay): void {
    const lock = overlay.visible !== null && !this.silent
    const warning = overlay.visible !== null && this.silent
    const blocks = lock || overlay.unseen !== null || overlay.pressed
    if (!blocks && !warning) return this.remove(overlay)
    const el = overlay.el || this.create(overlay)
    const r = overlay.instrument.getBoundingClientRect()
    // A display not laid out yet has no size, and a lock over the whole panel is the one that
    // surely covers it.
    const place = r.width && r.height ? `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` : "left:0;top:0;width:100%;height:100%;"
    const fill = lock || overlay.pressed ? RED_ORANGE : warning ? GRAY : "transparent"
    el.style.cssText =
      `position:fixed;${place}z-index:2147483647;box-sizing:border-box;overflow:hidden;` +
      `display:flex;align-items:center;justify-content:center;background-color:${fill};` +
      `pointer-events:${blocks ? "auto" : "none"};`
    const words = lock ? overlay.visible! : warning ? WARNING : ""
    const size = Math.round(Math.min(32, Math.max(12, (r.height || 400) * 0.045)))
    overlay.text!.style.cssText =
      `max-width:85%;color:#fff;font-family:"Segoe UI",Roboto,Arial,sans-serif;font-size:${size}px;` +
      `font-weight:600;line-height:1.35;text-align:center;`
    overlay.text!.textContent = words
  }

  private create(overlay: Overlay): HTMLElement {
    const el = this.doc.createElement("div")
    el.setAttribute(MARK, overlay.module)
    const text = this.doc.createElement("div")
    el.appendChild(text)
    for (const type of POINTER_EVENTS) {
      el.addEventListener(type, (e) => {
        e.stopPropagation()
        if (type === "mousedown" && !fired(e)) this.pressed(overlay)
      })
    }
    this.doc.body.appendChild(el)
    overlay.el = el
    overlay.text = text
    return el
  }

  /** A press landed on the overlay, which flashes and stays until the press's up. */
  private pressed(overlay: Overlay): void {
    overlay.pressed = true
    if (!this.listeningForUp) {
      this.doc.addEventListener("mouseup", this.onUp, true)
      this.listeningForUp = true
    }
    if (this.pressDeadman) clearTimeout(this.pressDeadman)
    this.pressDeadman = setTimeout(() => this.released(), PRESS_HOLDS_MS)
    this.render(overlay)
  }

  /** A button went up, so each press a lock took has ended. */
  private released(): void {
    this.stopListeningForUp()
    for (const overlay of this.overlays.slice()) {
      if (!overlay.pressed) continue
      overlay.pressed = false
      this.render(overlay)
    }
  }

  private stopListeningForUp(): void {
    if (this.pressDeadman) clearTimeout(this.pressDeadman)
    this.pressDeadman = null
    if (!this.listeningForUp) return
    this.doc.removeEventListener("mouseup", this.onUp, true)
    this.listeningForUp = false
  }

  private remove(overlay: Overlay): void {
    if (overlay.unseen) clearTimeout(overlay.unseen.timer)
    const at = this.overlays.indexOf(overlay)
    if (at >= 0) this.overlays.splice(at, 1)
    const el = overlay.el
    overlay.el = null
    overlay.text = null
    try {
      if (el && el.parentNode) el.parentNode.removeChild(el)
    } catch (e) {
      // Already gone from the document.
    }
    if (!this.overlays.some((o) => o.pressed)) this.stopListeningForUp()
  }
}
