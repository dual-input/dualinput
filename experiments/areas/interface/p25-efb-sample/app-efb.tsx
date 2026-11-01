/*
 * p25's EFB app: the product's EFB app on the dev loop's stand-in core, in the sim's own EFB, with a chooser
 * of its states over its corner, so a pilot can try its presses, hovers, scrolling, and motion at the EFB's
 * frame rate with no core and no session.
 */

import { releaseKeyboard } from "../../../../src/packages/ui/src/index.ts"
import { VERSION } from "../../../../src/engines/messages/ts/stamp.ts"
import { SAMPLE_PARTS } from "../../../../src/platform/efb-shell/dev/sample-parts.tsx"
import { mountSample } from "../../../../src/platform/efb-shell/dev/sample.tsx"
import { registerEfbApp } from "../../../../src/platform/efb-shell/src/register.ts"
import { viewShown } from "../../../../src/platform/efb-shell/src/view.ts"

registerEfbApp({
  internalName: "DualInputP25",
  name: "Dual Input",
  version: VERSION,
  mount(host) {
    const core = mountSample({ host, version: VERSION, parts: SAMPLE_PARTS })
    Object.assign(window, { DUALINPUT_DEV: { core } })
  },
  left: releaseKeyboard,
  shown: viewShown,
})
