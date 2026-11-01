/*
 * p24's EFB app: the kit's page in the sim's own EFB, registered and scaled by the product's own code
 * in src/platform/efb-shell, so a pilot can press it and efb.mjs can read how zoom behaves there.
 */

import { createRoot } from "react-dom/client"

import { KitPage } from "../../../../src/packages/ui/dev/kit-page.tsx"
import { releaseKeyboard } from "../../../../src/packages/ui/src/index.ts"
import { registerEfbApp } from "../../../../src/platform/efb-shell/src/register.ts"
import { useViewSize } from "../../../../src/platform/efb-shell/src/view.ts"

function App({ host }: { host: HTMLElement }) {
  const size = useViewSize(host)
  return <KitPage width={size.width} height={size.height} scale={size.scale} />
}

registerEfbApp({
  internalName: "DualInputP24",
  name: "Dual Input P24",
  version: "0.1.0",
  mount(host) {
    createRoot(host).render(<App host={host} />)
  },
  left: releaseKeyboard,
})
