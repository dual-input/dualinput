// bridge.js: one esbuild bundle of the panel bridge and page-client, which our VCockpit.js
// loads into every cockpit panel (record/areas/core/02-clients-and-panel-bridge.md, "Our
// VCockpit.js").

import { startBridge } from "../../platform/panel-bridge/src/start.ts"

try {
  startBridge()
} catch (e) {
  console.error(`Dual Input: the panel bridge didn't start: ${e}`)
}
