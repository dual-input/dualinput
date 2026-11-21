// The EFB app in the dev loop: at the tablet's three sizes in portrait, as the EFB draws them in a 1,844 by 1,316 window
// (record/areas/interface/log.md, 2026-11-01), beside a chooser of its states. A scene named in the address, as
// `?scene=Preflight`, is the one it starts on, so tools/screenshots.ts can take a picture of each with no jump from another,
// and `&still` holds the standing figure still at rest, so each picture comes out the same every time.

import { VERSION } from "../../../engines/messages/ts/stamp.ts"
import type { Part } from "../src/part.ts"
import { viewShown } from "../src/view.ts"
import { mountSample } from "./sample.tsx"
import { SCENE_TIMES, SCENES } from "./stand-in.ts"

const SIZES = { Small: [447, 632], Medium: [537, 759], Large: [621, 879] } as const

/** Runs the app with `parts`, which src/sim-package/pages/parts.ts lists, since no shell names a feature. */
export function mountDev(parts: Part[]): void {
  const page = document.getElementById("page") as HTMLElement
  page.style.cssText = "display:flex;padding:16px;align-items:flex-start"
  const host = document.createElement("div")
  host.style.cssText = "position:relative;overflow:hidden;flex-shrink:0;box-shadow:0 0 0 1px #333"
  const aside = document.createElement("div")
  aside.style.cssText = "margin-left:16px"
  page.append(host, aside)

  /** Sets the view's size from a console or `/eval`, as the pilot's choice in the EFB's Settings does. */
  function setSize(name: keyof typeof SIZES): void {
    const [width, height] = SIZES[name]
    host.style.width = `${width}px`
    host.style.height = `${height}px`
    viewShown()
  }
  setSize("Medium")

  const asked = new URLSearchParams(window.location.search)
  const { core, show } = mountSample({ host, aside, version: VERSION, parts, scene: asked.get("scene") ?? undefined, still: asked.has("still") })
  // The handle tools/screenshots.ts drives: the scenes by name, how long a scene runs where it isn't the tool's own time,
  // a jump to one, and the element its picture is of.
  Object.assign(window, { DUALINPUT_DEV: { setSize, core, scenes: Object.keys(SCENES), times: SCENE_TIMES, show, shot: host } })
}
