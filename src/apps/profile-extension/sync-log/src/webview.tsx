// The Sync log in its VS Code webview: it holds the rows the extension posts and draws them, and posts Clear and each
// link's reveal back, which the extension sends on to `serve`. tools/lib/profile-extension.ts bundles this file as the
// webview's script.

import { createRoot } from "react-dom/client"

import type { Syntax } from "../../src/syntax.ts"
import type { FromSyncLog, ToSyncLog } from "./messages.ts"
import { type Held, take } from "./rows.ts"
import { SyncLog } from "./sync-log.tsx"
import type { Palette, SyncLogHost } from "./view.ts"

/** VS Code's handle on the webview's host, which a webview can take once. */
declare function acquireVsCodeApi(): { postMessage(message: FromSyncLog): void }

const vscode = acquireVsCodeApi()
const send = (message: FromSyncLog) => vscode.postMessage(message)

const host: SyncLogHost = {
  clear: () => send({ kind: "clear" }),
  reveal: (entry) => send({ kind: "reveal", entry }),
}

const held: Held = new Map()
let palette: Palette = "dark"
let syntax: Syntax = {}
const root = createRoot(document.getElementById("root") as HTMLElement)
const draw = () => root.render(<SyncLog rows={[...held.values()]} palette={palette} syntax={syntax} host={host} />)

window.addEventListener("message", (event: MessageEvent<ToSyncLog>) => {
  const message = event.data
  if (message.kind === "palette") ({ palette, syntax } = message)
  else take(held, message)
  draw()
})
send({ kind: "ready" })
