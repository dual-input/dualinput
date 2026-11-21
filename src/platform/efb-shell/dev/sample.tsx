// The EFB app on the stand-in core, with a chooser of the states a person looks at: in the debugger's window
// beside the app, and in the sim's EFB over its corner, since the app is all that shows there.

import { Button, cx, Root } from "@dualinput/ui"
import { useState } from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"

import { CoreLink } from "../../../engines/page-client/src/core-link.ts"
import { DesktopLink } from "../src/desktop-link.ts"
import { FigureStill } from "../src/figure/standing-figure.tsx"
import { Frame } from "../src/frame.tsx"
import type { Part } from "../src/part.ts"
import type { SimWindow } from "../src/sim-window.ts"
import { SCENE_TABS, SCENES, StandInCore } from "./stand-in.ts"

const CONNECTIONS = ["reconnecting", "not-running", "closed", "back"] as const
/** How often, and how many times, showing a scene looks for its tab's button, which the frame draws only once the core is heard. */
const TAB_LOOK = { every: 50, times: 40 }

function Chooser({ core, show, compact }: { core: StandInCore; show: (name: string) => void; compact: boolean }) {
  const [open, setOpen] = useState(!compact)
  const [scene, setScene] = useState(core.sceneName)
  return (
    <div className={cx("flex flex-col", compact && "pointer-events-auto")}>
      {compact && (
        <Button size="xs" variant="secondary" onClick={() => setOpen(!open)}>
          States
        </Button>
      )}
      {open && (
        <div className={cx("flex w-52 flex-col space-y-1", compact && "mt-1 max-h-96 overflow-y-auto rounded-3xl bg-popover p-2 shadow-xl")}>
          {Object.keys(SCENES).map((name) => (
            <Button
              key={name}
              size="xs"
              variant={name === scene ? "default" : "ghost"}
              className="justify-start"
              onClick={() => {
                show(name)
                setScene(name)
              }}
            >
              {name}
            </Button>
          ))}
          {CONNECTIONS.map((state) => (
            <Button key={state} size="xs" variant="ghost" className="justify-start text-muted-foreground" onClick={() => core.connection(state)}>
              Service: {state}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The sim's window, where there's none: what the app asks of it goes to the console. */
const NO_SIM: SimWindow = {
  openEfb: () => console.log("the EFB opens onto our app"),
  toggleBanner: (open) => console.log(`the banner's panel ${open ? "opens" : "closes"}`),
  bannerAsked: () => 0,
  bannerResized: () => 0,
  tellBannerOnScreen: () => {},
  efbClosed: () => false,
}

/**
 * Mounts the app into `host`, on a stand-in core that starts on `scene`, with the chooser beside it in `aside`, or over
 * its corner with none, and with the standing figure held `still` for pictures. It returns the core, and `show`, which
 * jumps to a scene and opens the tab it's about.
 */
export function mountSample({ host, aside, version, parts, scene, still }: { host: HTMLElement; aside?: HTMLElement; version: string; parts: Part[]; scene?: string; still?: boolean }): { core: StandInCore; show: (name: string) => void } {
  const core = new StandInCore()
  if (scene !== undefined && scene in SCENES) core.sceneName = scene
  /** Opens a tab by pressing its button, as a pilot would, since the open tab is the app's own and no slice of the core's. */
  const openTab = (label: string) => {
    let looks = 0
    const look = () => {
      const button = host.querySelector<HTMLButtonElement>(`nav button[aria-label="${label}"]`)
      if (button) button.click()
      else if (++looks < TAB_LOOK.times) window.setTimeout(look, TAB_LOOK.every)
    }
    look()
  }
  const show = (name: string) => {
    core.scene(name)
    openTab(SCENE_TABS[name] ?? "Session")
  }
  const link = new CoreLink("efb-app", core.env())
  link.start()
  const desktop = new DesktopLink(core.desktopEnv())
  desktop.start()
  const corner = document.createElement("div")
  corner.style.cssText = "position:absolute;right:8px;bottom:64px;z-index:997;pointer-events:none"
  host.appendChild(corner)
  const place = aside ?? corner
  const tree = (
    <>
      <FigureStill.Provider value={!!still}>
        <Frame host={host} link={link} desktop={desktop} sim={NO_SIM} version={version} parts={parts} />
      </FigureStill.Provider>
      {createPortal(
        <Root>
          <Chooser core={core} show={show} compact={!aside} />
        </Root>,
        place,
      )}
    </>
  )
  const mount = document.createElement("div")
  host.appendChild(mount)
  createRoot(mount).render(tree)
  const tab = SCENE_TABS[core.sceneName]
  if (tab) openTab(tab)
  return { core, show }
}
