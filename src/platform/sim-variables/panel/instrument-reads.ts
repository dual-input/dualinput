// instrument-reads.js: sim variables' panel module that reads a gauge's JavaScript, which the
// panel bridge loads from /DualInput/modules/ into each cockpit panel holding an instrument a
// feature watches through an `instrument()` (record/areas/core/02-clients-and-panel-bridge.md,
// "Panel modules").

import type { PanelModuleDef } from "../../../platform/panel-bridge/src/bridge.ts"
import { instrumentReads, NAME } from "./src/instrument-reads.ts"

type Api = { DUALINPUT_BRIDGE_API?: { define(name: string, def: PanelModuleDef): void } }

try {
  const api = (window as unknown as Api).DUALINPUT_BRIDGE_API
  if (api) api.define(NAME, instrumentReads())
} catch (e) {
  console.error(`Dual Input: the panel module ${NAME} didn't define itself: ${e}`)
}
