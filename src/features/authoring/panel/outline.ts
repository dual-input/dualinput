// outline.js: authoring's panel module, which outlines the display picker's row in the sim, and
// which the panel bridge loads from /DualInput/modules/ into every cockpit panel while the
// profile extension's language server is connected (record/areas/core/02-clients-and-panel-bridge.md,
// "Panel modules").

import type { PanelModuleDef } from "../../../platform/panel-bridge/src/bridge.ts"
import { NAME, outline } from "./src/outline.ts"

type Api = { DUALINPUT_BRIDGE_API?: { define(name: string, def: PanelModuleDef): void } }

try {
  const api = (window as unknown as Api).DUALINPUT_BRIDGE_API
  if (api) api.define(NAME, outline())
} catch (e) {
  console.error(`Dual Input: the panel module ${NAME} didn't define itself: ${e}`)
}
