// The bench's fake cockpit panel for pointer sync: the panel bridge and the `pointer-sync`
// panel module themselves, run in Node over the fake document, on a fake page's socket to a
// bench core, so a pilot's tap, drag, or hold there goes out as it would from the sim's panel,
// and another pilot's plays on its display (record/areas/build/02-testing.md, "The sim's
// pages").
//
// The display is the Baron 58P's tablet, which the tree's profile names, at 0,0, 800 by 600,
// with a 4 by 3 grid of buttons, each 200 by 200, whose events a scenario reads.

import { NAME, pointerSync } from "../../src/features/pointer-sync/panel/src/module.ts"
import { Bridge, keyFor } from "../../src/platform/panel-bridge/src/bridge.ts"
import { asDocument, asElement, type FakeElement, FakeDocument, type Heard } from "../../src/platform/panel-bridge/test/fake-document.ts"
import type { Core } from "./cores.ts"
import { FakePage } from "./pages.ts"

/** The Baron 58P's tablet (read in bksq-aircraft-baronpro 0.1.1, record/areas/aircraft/black-square-baron-pro/study.md). */
export const TABLET = "BlackSquareTablet"

const WIDTH = 800
const HEIGHT = 600
const BUTTON = 200

export class FakeCockpitPanel {
  readonly doc = new FakeDocument()
  readonly page: FakePage
  readonly bridge: Bridge
  readonly display: FakeElement
  /** The display's buttons, row by row. */
  readonly buttons: FakeElement[] = []
  readonly logs: string[] = []

  constructor(core: Core, name = "VCockpit60") {
    this.display = this.doc.instrument(TABLET, { left: 0, top: 0, width: WIDTH, height: HEIGHT })
    for (let row = 0; row < HEIGHT / BUTTON; row++) {
      for (let col = 0; col < WIDTH / BUTTON; col++) {
        this.buttons.push(this.display.add("button", { left: col * BUTTON, top: row * BUTTON, width: BUTTON, height: BUTTON }))
      }
    }
    const key = keyFor(asElement(this.display))
    this.page = new FakePage(core, { component: "panel-bridge", sessionOnly: true, panel: name, instruments: [key] })
    const panel = this
    this.bridge = new Bridge(
      {
        document: asDocument(this.doc),
        addScript(src, failed) {
          // The bridge loads each module from our package's file, which defines it as it runs.
          setImmediate(() => (src === `/DualInput/modules/${NAME}.js` ? panel.bridge.define(NAME, pointerSync()) : failed()))
        },
        mouseEvent: (type, init) => this.doc.mouseEvent(type, init) as unknown as Event,
        log: (message) => panel.logs.push(message),
      },
      this.page.client,
    )
    this.bridge.add(asElement(this.display))
  }

  /** Whether the bridge runs the pointer sync module. */
  loaded(): boolean {
    return this.bridge.status().modules.includes(NAME)
  }

  /** The point at fractions of the display, in its px. */
  at(x: number, y: number): [number, number] {
    return [Math.round(x * WIDTH), Math.round(y * HEIGHT)]
  }

  /** The pilot taps the display at fractions of it. */
  tap(x: number, y: number): void {
    this.doc.press(...this.at(x, y))
    this.doc.release(...this.at(x, y))
  }

  press(x: number, y: number): void {
    this.doc.press(...this.at(x, y))
  }

  move(x: number, y: number): void {
    this.doc.move(...this.at(x, y))
  }

  release(x: number, y: number): void {
    this.doc.release(...this.at(x, y))
  }

  /** What each button heard, row by row, and the document itself as the last. */
  heard(): Heard[][] {
    return [...this.buttons.map((b) => b.heard), this.doc.heard]
  }

  /** Every event the display's buttons and the document heard, in the order each heard them, of the types given. */
  events(...types: string[]): Heard[] {
    return this.heard()
      .flat()
      .filter((h) => types.length === 0 || types.includes(h.type))
  }

  /** The bridge's locks over the display. */
  locks(): FakeElement[] {
    return this.doc.querySelectorAll("[data-dualinput-lock]")
  }

  /** What the visible lock says, or `null` with no lock, or `""` for an unseen one. */
  lockText(): string | null {
    const lock = this.locks()[0]
    return lock ? lock.textContent : null
  }

  /** Whether a lock takes the pilot's presses. */
  blocked(): boolean {
    return this.locks().some((l) => l.style.pointerEvents !== "none")
  }

  /** Stops the panel: its page's timers and socket. */
  close(): void {
    this.page.close()
  }
}
