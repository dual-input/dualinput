// DualInput.js: the EFB app's entry, one esbuild bundle of React, the kit, the EFB shell, and page-client.
// The EFB loads it from our folder under html_ui/efb_ui/efb_apps/, by whose name it finds the app.

import { releaseKeyboard } from "@dualinput/ui"
import { createRoot } from "react-dom/client"

import { simEnv } from "../../engines/page-client/src/sim-env.ts"
import { VERSION } from "../../engines/messages/ts/stamp.ts"
import { CoreLink } from "../../engines/page-client/src/core-link.ts"
import { DesktopLink } from "../../platform/efb-shell/src/desktop-link.ts"
import { Frame } from "../../platform/efb-shell/src/frame.tsx"
import { registerEfbApp } from "../../platform/efb-shell/src/register.ts"
import { simWindow } from "../../platform/efb-shell/src/sim-window.ts"
import { viewLeft, viewShown } from "../../platform/efb-shell/src/view.ts"
import { PARTS } from "./parts.ts"

/** `EFB_APP` in tools/lib/pages.ts names the same folder, so change both together. */
const INTERNAL_NAME = "DualInput"

const SIM = simWindow(INTERNAL_NAME)

registerEfbApp({
  internalName: INTERNAL_NAME,
  name: "Dual Input",
  version: VERSION,
  mount(host) {
    const env = simEnv()
    const link = new CoreLink("efb-app", env)
    link.start()
    const desktop = new DesktopLink(env)
    desktop.start()
    createRoot(host).render(<Frame host={host} link={link} desktop={desktop} sim={SIM} version={VERSION} parts={PARTS} />)
  },
  left() {
    releaseKeyboard()
    viewLeft()
  },
  shown: viewShown,
})
