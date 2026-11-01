// The EFB app on the stand-in core, with a chooser of the states a person looks at: in the debugger's window
// beside the app, and in the sim's EFB over its corner, since the app is all that shows there.

import { Button, cx, Root } from "@dualinput/ui"
import { useState } from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"

import { CoreLink } from "../../../engines/page-client/src/core-link.ts"
import { Frame } from "../src/frame.tsx"
import type { Part } from "../src/part.ts"
import type { SimWindow } from "../src/sim-window.ts"
import { SCENES, StandInCore } from "./stand-in.ts"

const CONNECTIONS = ["reconnecting", "not-running", "closed", "back"] as const

function Chooser({ core, compact }: { core: StandInCore; compact: boolean }) {
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
                core.scene(name)
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
}

/** Mounts the app into `host`, on a stand-in core, with the chooser beside it in `aside`, or over its corner with none. */
export function mountSample({ host, aside, version, parts }: { host: HTMLElement; aside?: HTMLElement; version: string; parts: Part[] }): StandInCore {
  const core = new StandInCore()
  const link = new CoreLink("efb-app", core.env())
  link.start()
  const corner = document.createElement("div")
  corner.style.cssText = "position:absolute;right:8px;bottom:64px;z-index:997;pointer-events:none"
  host.appendChild(corner)
  const place = aside ?? corner
  const tree = (
    <>
      <Frame host={host} link={link} sim={NO_SIM} version={version} parts={parts} />
      {createPortal(
        <Root>
          <Chooser core={core} compact={!aside} />
        </Root>,
        place,
      )}
    </>
  )
  const mount = document.createElement("div")
  host.appendChild(mount)
  createRoot(mount).render(tree)
  return core
}
