// pointer-sync.js: pointer sync's panel module, which the panel bridge loads from
// /DualInput/modules/ into each cockpit panel that holds a synced display, once the core names
// it for the panel (record/areas/core/02-clients-and-panel-bridge.md, "Panel modules").

import type { PanelModuleDef } from "../../../platform/panel-bridge/src/bridge.ts"
import { NAME, pointerSync } from "./src/module.ts"

type Api = { DUALINPUT_BRIDGE_API?: { define(name: string, def: PanelModuleDef): void } }

try {
  const api = (window as unknown as Api).DUALINPUT_BRIDGE_API
  if (api) api.define(NAME, pointerSync())
} catch (e) {
  console.error(`Dual Input: the panel module ${NAME} didn't define itself: ${e}`)
}
