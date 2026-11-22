// Authoring's panel module, which outlines in the sim the instrument the profile extension's
// display picker is on, so an author walking the list sees which display each row is
// (record/areas/profiles/04-the-extension-in-the-sim.md, "The display picker"). Its box passes
// every press, with `pointer-events: none` and no listener, so nothing of it sits in the pilot's
// input path, and its `stop` removes every box, as `window.DUALINPUT_BRIDGE_UNLOCK()` stops it
// with every module. It runs in Coherent GT, so it keeps to ES2017, and esbuild compiles it to
// es2017.

import type { Outline } from "../../../../engines/messages/ts/authoring/Outline.ts"
import { keyFor, type PanelCtx, type PanelModuleDef } from "../../../../platform/panel-bridge/src/bridge.ts"

/**
 * The module's name, and the name its messages go under. `OUTLINE` in
 * src/engines/messages/src/authoring.rs names it too, and so does this module's file,
 * src/features/authoring/panel/outline.ts, so change all three together.
 */
export const NAME = "outline"

/** The attribute on each box, by which a test, or a person in the inspector, finds it. */
export const MARK = "data-dualinput-outline"

/**
 * Our palette's sky, `primary` in src/packages/ui/palette/palette.ts, which a panel module can't
 * import, so change both together: as the box's edge, a faint tint inside it, and the key's text.
 */
const SKY = "#74d4ff"
const TINT = "rgba(116, 212, 255, 0.12)"
/** The palette's `background`, at 80%, under the key, so it reads over any display; change it with the palette's too. */
const UNDER_KEY = "rgba(10, 10, 10, 0.8)"

export function outline(): PanelModuleDef {
  const boxes: HTMLElement[] = []
  const clear = (): void => {
    for (const box of boxes.splice(0, boxes.length)) {
      try {
        if (box.parentNode) box.parentNode.removeChild(box)
      } catch (e) {
        // Already gone from the document.
      }
    }
  }
  return {
    start(ctx: PanelCtx) {
      ctx.on((body) => {
        const message = body as unknown as Outline
        clear()
        for (const instrument of ctx.instruments) {
          const key = keyFor(instrument)
          if (message.instruments.indexOf(key) >= 0) boxes.push(draw(ctx.document, instrument, key))
        }
      })
    },
    stop() {
      clear()
    },
  }
}

/** A box over `instrument`, on top of the panel, with `key` in its middle. */
function draw(doc: Document, instrument: Element, key: string): HTMLElement {
  const r = instrument.getBoundingClientRect()
  // A display not laid out yet has no size, and an outline of the whole panel still says which
  // panel holds it.
  const place = r.width && r.height ? `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` : "left:0;top:0;width:100%;height:100%;"
  // A panel's pixels are drawn at the size of the cockpit's screen, so a 2px edge vanished on a
  // large display seen from the seat; the edge grows with the display, as fsc-editor's did.
  const edge = Math.max(4, Math.round(Math.min(r.width || 400, r.height || 400) / 90))
  const box = doc.createElement("div")
  box.setAttribute(MARK, key)
  box.style.cssText =
    `position:fixed;${place}z-index:2147483646;box-sizing:border-box;overflow:hidden;` +
    `display:flex;align-items:center;justify-content:center;border:${edge}px solid ${SKY};border-radius:${edge + 2}px;` +
    `background-color:${TINT};pointer-events:none;`
  const label = doc.createElement("div")
  const size = Math.round(Math.min(28, Math.max(12, (r.height || 400) * 0.06)))
  label.style.cssText =
    `max-width:90%;padding:2px 8px;border-radius:3px;background-color:${UNDER_KEY};color:${SKY};` +
    `font-family:"Segoe UI",Roboto,Arial,sans-serif;font-size:${size}px;font-weight:600;line-height:1.35;` +
    `text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;`
  label.textContent = key
  box.appendChild(label)
  doc.body.appendChild(box)
  return box
}
