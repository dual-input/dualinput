// banner.js: the banner's entry, one esbuild bundle of React, the kit, the banner, and page-client. The sim's in-game
// panel loads banner.html, which holds the `ingame-ui` element the sim's panel code looks for, as a custom element of
// our own around it, the shape an in-game panel takes (read in p42-util-chaseplane 2026.39.1.16,
// HTML_UI/InGamePanels/P42ChasePlane/P42ChasePlane_overlay.html).

import { createRoot } from "react-dom/client"

import { CoreLink } from "../../engines/page-client/src/core-link.ts"
import { simEnv } from "../../engines/page-client/src/sim-env.ts"
import { Banner, OPEN_EFB_VARIABLE } from "../../platform/banner/src/banner.tsx"

declare const TemplateElement: { new (): HTMLElement & { connectedCallback(): void } }
declare const SimVar: { GetSimVarValue(name: string, unit: string): number; SetSimVarValue(name: string, unit: string, value: number): unknown }
declare function checkAutoload(): void

/** `RESIZED_VARIABLE` and `ON_SCREEN_VARIABLE` in src/platform/efb-shell/src/sim-window.ts name the same two, so change both together. */
const RESIZED_VARIABLE = "L:DUALINPUT_BANNER_RESIZED"
const ON_SCREEN_VARIABLE = "L:DUALINPUT_EFB_ON_SCREEN"

class DualInputBanner extends TemplateElement {
  connectedCallback(): void {
    super.connectedCallback()
    const frame = this.querySelector("ingame-ui")
    // Sim Update 2 put a hide class on every ingame-ui, and removing it is the workaround developers report (MSFS
    // DevSupport, "In-game panels do not appear on the screen or there are issues with the windows").
    frame?.classList.remove("hide", "panelInvisible")
    const host = this.querySelector<HTMLElement>("#dualinput-banner")
    if (!host) return
    const link = new CoreLink("banner", simEnv())
    link.start()
    // The EFB app acts on a variable changing, so each ask writes a new value.
    const openWithoutCore = () => void SimVar.SetSimVarValue(OPEN_EFB_VARIABLE, "number", Date.now())
    const askToReopen = () => void SimVar.SetSimVarValue(RESIZED_VARIABLE, "number", Date.now())
    const efbAppOnScreen = () => SimVar.GetSimVarValue(ON_SCREEN_VARIABLE, "number") === 1
    createRoot(host).render(<Banner host={host} link={link} openWithoutCore={openWithoutCore} askToReopen={askToReopen} efbAppOnScreen={efbAppOnScreen} />)
  }
}

window.customElements.define("dualinput-banner-panel", DualInputBanner)
checkAutoload()
