// DualInput.js: the EFB app's entry, one esbuild bundle of React, the kit, the EFB shell, and page-client.
// The EFB loads it from our folder under html_ui/efb_ui/efb_apps/, by whose name it finds the app.

import { releaseKeyboard } from "@dualinput/ui"
import { createRoot } from "react-dom/client"

import { simEnv } from "../../engines/page-client/src/sim-env.ts"
import { VERSION } from "../../engines/messages/ts/stamp.ts"
import { CoreLink } from "../../platform/efb-shell/src/core-link.ts"
import { Frame } from "../../platform/efb-shell/src/frame.tsx"
import type { Part } from "../../platform/efb-shell/src/part.ts"
import { registerEfbApp } from "../../platform/efb-shell/src/register.ts"
import { viewShown } from "../../platform/efb-shell/src/view.ts"

/** `EFB_APP` in tools/lib/pages.ts names the same folder, so change both together. */
const INTERNAL_NAME = "DualInput"

/** Each feature's part, one line each, in the order their tabs show. */
const PARTS: Part[] = []

registerEfbApp({
  internalName: INTERNAL_NAME,
  name: "Dual Input",
  version: VERSION,
  mount(host) {
    const link = new CoreLink(simEnv())
    link.start()
    createRoot(host).render(<Frame host={host} link={link} version={VERSION} parts={PARTS} />)
  },
  left: releaseKeyboard,
  shown: viewShown,
})
