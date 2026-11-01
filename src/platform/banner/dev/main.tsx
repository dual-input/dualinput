// The banner in the dev loop, as tools/dev.ts runs it: its box over a stand-in for the sky through the windshield, on
// a stand-in core, beside a chooser of the states a person looks at. The cards are opaque, so what's behind them
// doesn't change how they read.

import { Button, Root } from "@dualinput/ui"
import { useState } from "react"
import { createRoot } from "react-dom/client"

import { CoreLink } from "../../../engines/page-client/src/core-link.ts"
import { Banner } from "../src/banner.tsx"
import { BOX } from "../src/stack.tsx"
import { SCENES, StandInCore } from "./stand-in.ts"

const SKY = "linear-gradient(180deg, #56738f 0%, #7d96ab 60%, #a3b5c3 100%)"
const CONNECTIONS = ["reconnecting", "not-running", "closed", "back"] as const

function Chooser({ core }: { core: StandInCore }) {
  const [scene, setScene] = useState(core.sceneName)
  return (
    <div className="flex w-56 flex-col space-y-1">
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
  )
}

const page = document.getElementById("page") as HTMLElement
page.style.cssText = "display:flex;padding:16px;align-items:flex-start"
const sky = document.createElement("div")
sky.style.cssText = `flex-shrink:0;padding:16px;background:${SKY}`
const host = document.createElement("div")
host.style.cssText = `position:relative;width:${BOX.width}px;height:${BOX.height}px;box-shadow:0 0 0 1px rgba(125,211,252,0.8)`
sky.appendChild(host)
const aside = document.createElement("div")
aside.style.cssText = "margin-left:16px"
page.append(sky, aside)

const core = new StandInCore()
const link = new CoreLink("banner", core.env())
link.start()
createRoot(host).render(<Banner host={host} link={link} openWithoutCore={() => core.clicked("opened with no core")} />)
createRoot(aside).render(
  <Root>
    <Chooser core={core} />
  </Root>,
)
Object.assign(window, { DUALINPUT_DEV: { core } })
