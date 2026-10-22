// Starts the panel bridge in a cockpit panel: the page client that joins the core, the bridge's
// globals, and the instruments our VCockpit.js queued before this file loaded
// (record/areas/core/02-clients-and-panel-bridge.md, "Our VCockpit.js").

import { PageClient } from "../../../engines/page-client/src/page-client.ts"
import { simEnv } from "../../../engines/page-client/src/sim-env.ts"
import { Bridge, type BridgeStatus, type PanelModuleDef } from "./bridge.ts"

/** The bridge's globals, each `DUALINPUT_BRIDGE_`, since every package shares a panel's `window` (record/areas/architecture/02-code-map.md, "Names the sim shares"). */
declare global {
  interface Window {
    DUALINPUT_BRIDGE_API?: {
      add(instrument: Element): void
      define(name: string, def: PanelModuleDef): void
      status(): BridgeStatus
    }
    /** The instruments our VCockpit.js created before this file loaded, which it queued here. */
    DUALINPUT_BRIDGE_PENDING?: Element[]
    /** Stops every panel module in this document, from the inspector or any console. */
    DUALINPUT_BRIDGE_UNLOCK?: () => void
    /** The sim's VCockpit.js keeps the panel's data here, its name, such as `VCockpit66`, among it (read in the sim's stock VCockpit.js, `ShowVCockpitPanel`). */
    globalPanelData?: { sName?: string } | null
  }
}

/** The component a cockpit panel's `hello` names. `component::PANEL_BRIDGE` in engines/messages/src/clients.rs names it too. */
const COMPONENT = "panel-bridge"

export function startBridge(): void {
  const env = simEnv()
  const keys = (): string[] => bridge.keys()
  const panel = (): string | undefined => (window.globalPanelData && window.globalPanelData.sName) || undefined
  const client = new PageClient({ component: COMPONENT, sessionOnly: true, panel, instruments: keys }, env)
  const bridge = new Bridge(
    {
      addScript(src, failed) {
        const script = document.createElement("script")
        script.src = src
        script.onerror = failed
        document.head.appendChild(script)
      },
      log: env.log,
    },
    client,
  )
  window.DUALINPUT_BRIDGE_API = {
    add: (instrument) => bridge.add(instrument),
    define: (name, def) => bridge.define(name, def),
    status: () => bridge.status(),
  }
  window.DUALINPUT_BRIDGE_UNLOCK = () => bridge.unlock()
  const pending = window.DUALINPUT_BRIDGE_PENDING || []
  window.DUALINPUT_BRIDGE_PENDING = []
  for (const instrument of pending) bridge.add(instrument)
  client.start()
}
