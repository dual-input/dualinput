// What the window reads from and asks of the desktop app's Rust side, src/apps/desktop/src/screens.rs.

import type { DesktopState } from "../../../engines/messages/ts/desktop/DesktopState.ts"
import type { ToDesktop } from "../../../engines/messages/ts/desktop/ToDesktop.ts"

export type Screen = "main" | "quit" | "welcome"

/** A moment's figures: memory in bytes, the share of all the PC's cores in percent, and the bytes downloaded since the sample before. */
export type Sample = { at: number; memory: number; cpu: number; network: number }

export type Usage = { samples: Sample[]; windowOpened: number[]; updateDownloaded: number[]; now: number }

export type View = { screen: Screen; usage: Usage; desktop: DesktopState; simRunning: boolean; sessionHeld: boolean; simHasRun: boolean }

export type DesktopLink = {
  view(): Promise<View>
  ask(ask: ToDesktop): void
  /** Sizes the window to the page, as far as the screen lets it, shows it the first time, and answers the height it took. */
  fit(height: number): Promise<number>
  /** Moves the window with the mouse, until the button comes up. */
  drag(): void
  close(): void
  quit(): void
}

declare global {
  interface Window {
    /** Tauri's API, which `withGlobalTauri` in src/apps/desktop/tauri.conf.json puts here. */
    __TAURI__: { core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } }
    /** How the tray turns an open window to another screen. */
    dualInputShow?: (screen: Screen) => void
  }
}

export const tauriLink: DesktopLink = {
  view: () => window.__TAURI__.core.invoke<View>("view"),
  ask: (ask) => void window.__TAURI__.core.invoke("ask", { ask }),
  fit: (height) => window.__TAURI__.core.invoke<number>("fit", { height }),
  drag: () => void window.__TAURI__.core.invoke("drag"),
  close: () => void window.__TAURI__.core.invoke("close"),
  quit: () => void window.__TAURI__.core.invoke("quit"),
}
