// The Dual Input panel in its VS Code webview: it draws each view the extension posts, and posts each of the panel's calls
// back, which the extension sends on to `serve`. tools/lib/profile-extension.ts bundles this file as the webview's script.

import { createRoot } from "react-dom/client"

import type { FromPanel, ToPanel } from "./messages.ts"
import { Panel } from "./panel.tsx"
import type { PanelHost } from "./view.ts"

/** VS Code's handle on the webview's host, which a webview can take once. */
declare function acquireVsCodeApi(): { postMessage(message: FromPanel): void }

const vscode = acquireVsCodeApi()
const send = (message: FromPanel) => vscode.postMessage(message)

const host: PanelHost = {
  typed: (text) => send({ kind: "typed", text }),
  run: (text) => send({ kind: "run", text }),
  reveal: (where) => send({ kind: "reveal", where }),
  move: (row) => send({ kind: "move", row }),
  tick: (row) => send({ kind: "tick", row }),
  write: () => send({ kind: "write" }),
  leave: () => send({ kind: "leave" }),
  record: () => send({ kind: "record" }),
  stop: () => send({ kind: "stop" }),
  play: () => send({ kind: "play" }),
}

const root = createRoot(document.getElementById("root") as HTMLElement)
window.addEventListener("message", (event: MessageEvent<ToPanel>) => {
  if (event.data.kind === "view") root.render(<Panel view={event.data.view} host={host} />)
})
send({ kind: "ready" })
