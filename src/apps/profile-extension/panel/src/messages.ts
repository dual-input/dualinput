// The messages between the Dual Input panel's webview and the extension. The extension posts each `PanelView` that
// `serve` sends, and the webview posts each of `PanelHost`'s calls back, so the panel draws in the webview as it draws on
// its dev page, with the extension standing where the dev page's stand-in stands
// (record/areas/profiles/04-the-extension-in-the-sim.md, "The connection").

import type { Adding, PanelView } from "./view.ts"

/** From the extension: the view to draw, whole. */
export type ToPanel = { kind: "view"; view: PanelView }

/**
 * From the webview: `ready` once its script listens, since a view posted before then is lost, and a webview VS Code
 * hid and showed again loads afresh and asks again; or one of `PanelHost`'s calls, by its name.
 */
export type FromPanel =
  | { kind: "ready" }
  | { kind: "typed"; text: string }
  | { kind: "run"; text: string }
  | { kind: "reveal"; where: string }
  | { kind: "move"; row: string }
  | { kind: "tick"; row: string }
  | { kind: "write" }
  | { kind: "add"; adding: Adding }
  | { kind: "leave" }
  | { kind: "record" }
  | { kind: "stop" }
  | { kind: "play" }
