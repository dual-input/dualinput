// What the EFB app asks of the sim around it: opening the EFB onto our app, and opening and closing the banner's panel.
// It stands behind a type of its own, so the app runs on a stand-in with no sim.

import { OPEN_EFB_VARIABLE } from "./landing.ts"

declare const Coherent: { call(name: string, ...args: unknown[]): unknown }
declare const engine: { trigger(name: string, ...args: unknown[]): void }
declare const SimVar: { GetSimVarValue(name: string, unit: string): number; SetSimVarValue(name: string, unit: string, value: number): unknown }

export type SimWindow = {
  openEfb(): void
  toggleBanner(open: boolean): void
  /** What the banner last wrote to ask for the EFB with no core to carry the click, which changes with each ask. */
  bannerAsked(): number
  /** What the banner last wrote to ask for a new opening once the sim's window changed, which changes with each ask, and reads 0 after a flight load. */
  bannerResized(): number
  /** Tells the banner whether our app is on screen. */
  tellBannerOnScreen(on: boolean): void
  /** Whether the EFB is closed, which nothing tells the app: closing it doesn't pause the app on screen (measured on MSFS 2024, 2026-10-06, record/areas/interface/log.md). */
  efbClosed(): boolean
}

/** The panel's ID. `src/sim-package/panel/InGamePanels/dualinput-banner.xml` and `src/sim-package/pages/banner.html` name the same panel, so change all three together. */
const BANNER_PANEL = "PANEL_DUALINPUT_BANNER"

/**
 * The two pages share no document and this is no business of the core's, so they speak through `L:` variables, as the
 * banner's click does (src/platform/efb-shell/src/landing.ts). `RESIZED_VARIABLE` and `ON_SCREEN_VARIABLE` in
 * src/sim-package/pages/banner.tsx name the same two, so change both together.
 */
const RESIZED_VARIABLE = "L:DUALINPUT_BANNER_RESIZED"
const ON_SCREEN_VARIABLE = "L:DUALINPUT_EFB_ON_SCREEN"

/** How long after opening the EFB it takes the page key, in milliseconds (record/areas/interface/log.md, 2026-10-06). */
const OPEN_THEN_KEY = 300

/**
 * `TOGGLE_EFB` closes an open EFB, so it's called only while the EFB's action bar carries the class it carries exactly
 * while the EFB is closed (measured on MSFS 2024, 2026-10-04, record/areas/interface/log.md). `OPEN_BY_KEY` then opens
 * our app wherever it sits in the EFB (measured on MSFS 2024, 2026-10-06, same log).
 */
export function simWindow(internalName: string): SimWindow {
  const efbClosed = () => {
    const actions = document.querySelector(".panel-ui-actions")
    return !!actions && actions.className.indexOf("panel-ui-actions--hidden") >= 0
  }
  return {
    efbClosed,
    openEfb() {
      if (efbClosed()) Coherent.call("TOGGLE_EFB")
      window.setTimeout(() => engine.trigger("OPEN_BY_KEY", internalName, "", ""), OPEN_THEN_KEY)
    },
    toggleBanner(open) {
      Coherent.call("TOOLBAR_BUTTON_TOGGLE", BANNER_PANEL, open)
    },
    bannerAsked() {
      return SimVar.GetSimVarValue(OPEN_EFB_VARIABLE, "number")
    },
    bannerResized() {
      return SimVar.GetSimVarValue(RESIZED_VARIABLE, "number")
    },
    // It reads first, since a flight load resets the variable and only this call puts it back.
    tellBannerOnScreen(on) {
      const value = on ? 1 : 0
      if (SimVar.GetSimVarValue(ON_SCREEN_VARIABLE, "number") !== value) void SimVar.SetSimVarValue(ON_SCREEN_VARIABLE, "number", value)
    },
  }
}
