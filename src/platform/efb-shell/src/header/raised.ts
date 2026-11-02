// The header's rows for what the core raised: each notification that lands on the header says its own title and detail,
// and only the pill's short word is the header's (record/areas/interface/decisions.md, "A notification's click opens the
// EFB app where it's explained or acted on").

import type { Notification } from "../../../../engines/messages/ts/clients/Notification.ts"

/** The pill's word for each notification, in the header's order, by the start of its ID. The first that fits names it. */
const WORDS: [string, string][] = [
  ["clients.no-panel", "Screens"],
  ["sim-service.", "WASM"],
  ["core-helper.down", "Helper"],
  ["core-helper.failed.mouse", "Mouse"],
  ["core-helper.failed.capture", "Audio"],
  ["core-helper.failed.stream", "Audio"],
  ["core-helper.failed.", "Keybind"],
]

/** A row of the core's: what `issuesOf` needs of it. */
export type RaisedRow = { id: string; word: string; title: string; detail: string; trouble: boolean }

const rank = (id: string) => {
  const at = WORDS.findIndex(([start]) => id.indexOf(start) === 0)
  return at < 0 ? WORDS.length : at
}

export function raisedRows(notifications: Notification[]): RaisedRow[] {
  return notifications
    .filter((notification) => notification.landing === "header")
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((notification) => ({
      id: notification.id,
      word: WORDS[rank(notification.id)]?.[1] ?? "Trouble",
      title: notification.text,
      detail: notification.detail ?? "",
      trouble: notification.level === "trouble",
    }))
}
