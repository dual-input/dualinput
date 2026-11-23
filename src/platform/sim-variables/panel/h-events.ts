// h-events.js: sim variables' panel module that hears `H:` events, which the panel bridge loads
// from /DualInput/modules/ into one cockpit panel, once the core names it for the panel
// (record/areas/core/02-clients-and-panel-bridge.md, "Panel modules").

import type { PanelModuleDef } from "../../../platform/panel-bridge/src/bridge.ts"
import { type Coherent, hEvents, NAME } from "./src/h-events.ts"

type Api = { DUALINPUT_BRIDGE_API?: { define(name: string, def: PanelModuleDef): void } }

try {
  const api = (window as unknown as Api).DUALINPUT_BRIDGE_API
  if (api) api.define(NAME, hEvents(() => (window as unknown as { Coherent: Coherent }).Coherent))
} catch (e) {
  console.error(`Dual Input: the panel module ${NAME} didn't define itself: ${e}`)
}
