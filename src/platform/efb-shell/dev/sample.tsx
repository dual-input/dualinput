// The EFB app on the stand-in core, with a navigator of the states a person looks at: in the debugger's window beside
// the app, every state at once, and in the sim's EFB over its corner, since the app is all that shows there.

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
import { NAVIGATOR, SCENE_TABS, SCENES, StandInCore } from "./stand-in.ts"
import type { NavigatorEntry } from "./stand-in.ts"

/** How often, and how many times, showing a scene looks for its tab's button, which the frame draws only once the core is heard. */
const TAB_LOOK = { every: 50, times: 40 }

/** The view's sizes the navigator offers, the one shown, and how to change it, where the page has them. */
export type Sizes = { names: readonly string[]; shown: string; set: (name: string) => void }

/** What the navigator last picked: a state by its ID, or a connection's line by its label, which stays lit until another pick. */
const picked = (entry: NavigatorEntry) => ("scene" in entry ? entry.scene : entry.label)

function Navigator({ core, show, compact, sizes }: { core: StandInCore; show: (scene: string) => void; compact: boolean; sizes?: Sizes }) {
  const [open, setOpen] = useState(!compact)
  const [lit, setLit] = useState(core.sceneName)
  const [size, setSize] = useState(sizes?.shown)
  const pick = (entry: NavigatorEntry) => {
    if ("scene" in entry) show(entry.scene)
    else core.connection(entry.connection)
    setLit(picked(entry))
  }
  return (
    <div className={cx("flex flex-col", compact && "pointer-events-auto items-end")}>
      {compact && (
        <Button size="xs" variant="secondary" onClick={() => setOpen(!open)}>
          States
        </Button>
      )}
      {open && (
        <div className={cx(compact && "mt-1 max-h-96 w-56 overflow-y-auto rounded-3xl bg-popover p-3 shadow-xl")}>
          {sizes && (
            <div className="mb-4 flex items-center space-x-1">
              <span className="mr-2 text-xs text-muted-foreground">Size</span>
              {sizes.names.map((name) => (
                <Button
                  key={name}
                  size="xs"
                  variant={name === size ? "default" : "ghost"}
                  onClick={() => {
                    sizes.set(name)
                    setSize(name)
                  }}
                >
                  {name}
                </Button>
              ))}
            </div>
          )}
          {/* In the sim's corner the columns stack into one list, since the EFB is too narrow for four. */}
          <div className={cx("flex items-start", compact ? "flex-col" : "space-x-5")}>
            {NAVIGATOR.map((column, at) => (
              <div key={at} className={cx("flex flex-col", !compact && "w-48")}>
                {column.map((section, sectionAt) => (
                  <div key={sectionAt} className={cx(sectionAt > 0 && "mt-2")}>
                    {/* A section with no heading keeps its line, so the first blocks of every column start level. */}
                    <div className="mb-1 h-4 text-xs text-muted-foreground">{section.heading}</div>
                    {section.blocks.map(({ situation, entries }) => (
                      <div key={situation} className="mb-4">
                        <div className="mb-0.5 text-xs font-semibold text-foreground">{situation}</div>
                        {entries.map((entry) => (
                          <Button
                            key={entry.label}
                            size="xs"
                            variant={picked(entry) === lit ? "default" : "ghost"}
                            className={cx("w-full", picked(entry) !== lit && "text-muted-foreground")}
                            onClick={() => pick(entry)}
                          >
                            {/* The kit's button centers its content, so the label pushes itself to the left. */}
                            <span className="mr-auto truncate">{entry.label}</span>
                          </Button>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
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

type Sample = { host: HTMLElement; aside?: HTMLElement; version: string; parts: Part[]; scene?: string; still?: boolean; sizes?: Sizes; shown?: (scene: string) => void }

/**
 * Mounts the app into `host`, on a stand-in core that starts on `scene`, with the navigator beside it in `aside`, or over
 * its corner with none, and with the standing figure held `still` for pictures. Each state shown is told to `shown`. It
 * returns the core, and `show`, which jumps to a state by its ID and opens the tab it's about.
 */
export function mountSample({ host, aside, version, parts, scene, still, sizes, shown }: Sample): { core: StandInCore; show: (scene: string) => void } {
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
    shown?.(name)
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
          <Navigator core={core} show={show} compact={!aside} sizes={sizes} />
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
