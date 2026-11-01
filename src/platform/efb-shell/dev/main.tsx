// The EFB app in the dev loop, as tools/dev.ts runs it: at the tablet's three sizes in portrait, as the EFB draws
// them in a 1,844 by 1,316 window (record/areas/interface/log.md, 2026-11-01), beside a chooser of its states.

import { VERSION } from "../../../engines/messages/ts/stamp.ts"
import { viewShown } from "../src/view.ts"
import { SAMPLE_PARTS } from "./sample-parts.tsx"
import { mountSample } from "./sample.tsx"

const SIZES = { Small: [447, 632], Medium: [537, 759], Large: [621, 879] } as const

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

const core = mountSample({ host, aside, version: VERSION, parts: SAMPLE_PARTS })
Object.assign(window, { DUALINPUT_DEV: { setSize, core } })
