// The EFB app in the dev loop: at the tablet's three sizes in portrait, as the EFB draws them in a 1,844 by 1,316 window
// (record/areas/interface/log.md, 2026-11-01), beside a navigator of its states. A state named in the address by its ID,
// as `?scene=preflight`, is the one it starts on, so tools/screenshots.ts can take a picture of each with no jump from
// another, and `&still` holds the standing figure still at rest, so each picture comes out the same every time. With none
// named, it starts on the state and size it last showed, so an edit's reload in the debugger keeps the state being worked on.

import { VERSION } from "../../../engines/messages/ts/stamp.ts"
import type { Part } from "../src/part.ts"
import { viewShown } from "../src/view.ts"
import { mountSample } from "./sample.tsx"
import { SCENE_NAMES, SCENE_TIMES, SCENES } from "./stand-in.ts"

const SIZES = { Small: [447, 632], Medium: [537, 759], Large: [621, 879] } as const
type Size = keyof typeof SIZES

/** Where the page keeps the state and size it last showed. */
const REMEMBERED = { scene: "dualinput-efb-dev-scene", size: "dualinput-efb-dev-size" }

/** What the page remembered, or nothing. Storage can be missing or refuse, as in a private window, and then nothing's remembered. */
function recall(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Nothing's remembered, and the page still works.
  }
}

/** Runs the app with `parts`, which src/sim-package/pages/parts.ts lists, since no shell names a feature. */
export function mountDev(parts: Part[]): void {
  const page = document.getElementById("page") as HTMLElement
  page.style.cssText = "display:flex;padding:16px;align-items:flex-start"
  const host = document.createElement("div")
  host.style.cssText = "position:relative;overflow:hidden;flex-shrink:0;box-shadow:0 0 0 1px #333"
  const aside = document.createElement("div")
  aside.style.cssText = "margin-left:24px"
  page.append(host, aside)

  /** Sets the view's size, as the pilot's choice in the EFB's Settings does, from the navigator, a console, or `/eval`. */
  function setSize(name: Size): void {
    const [width, height] = SIZES[name]
    host.style.width = `${width}px`
    host.style.height = `${height}px`
    viewShown()
    remember(REMEMBERED.size, name)
  }
  const asked = new URLSearchParams(window.location.search)
  // A picture always starts from the page's own defaults, so only a page with no state named picks up where it left off.
  const named = asked.get("scene") ?? undefined
  const held = named === undefined ? recall(REMEMBERED.size) : undefined
  const size: Size = held !== undefined && held in SIZES ? (held as Size) : "Medium"
  setSize(size)

  const { core, show } = mountSample({
    host,
    aside,
    version: VERSION,
    parts,
    scene: named ?? recall(REMEMBERED.scene),
    still: asked.has("still"),
    sizes: { names: Object.keys(SIZES), shown: size, set: (name) => setSize(name as Size) },
    shown: (scene) => remember(REMEMBERED.scene, scene),
  })
  // The handle tools/screenshots.ts drives: the states by ID in the navigator's order, the name a person reads for each,
  // how long a state runs where it isn't the tool's own time, a jump to one, and the element its picture is of.
  const scenes = SCENE_NAMES.map(([scene]) => scene)
  const names: Record<string, string> = {}
  for (const [scene, name] of SCENE_NAMES) names[scene] = name
  // A state left out of the navigator gets no button and no picture, so the page says so, and tools/dev.ts prints it.
  for (const scene of Object.keys(SCENES)) if (!(scene in names)) console.error(`the EFB dev page's navigator doesn't list the state ${scene}`)
  Object.assign(window, { DUALINPUT_DEV: { setSize, core, scenes, names, times: SCENE_TIMES, show, shot: host } })
}
