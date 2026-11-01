// A notification as the banner draws it: information, a warning, or trouble that costs the pilot a feature, held
// while its cause lasts or shown once (record/areas/interface/decisions.md, "The banner carries what a pilot must see
// without the EFB, and the rest shows where it's acted on").

import type { Level } from "../../../engines/messages/ts/clients/Level.ts"
import type { Notification } from "../../../engines/messages/ts/clients/Notification.ts"
import type { CoreState } from "../../../engines/page-client/src/core-link.ts"

/**
 * Where a click on a card opens the EFB app: the Session tab, the header on the row that repeats the card, the
 * Figures tab, or wherever the app was, for the service gone, whose screen covers every tab.
 */
export type Landing = "session" | "header" | "figures" | "stay"

/**
 * The core's notification, with what the card draws beyond its `text`, each field optional, since the core raises
 * `text` alone until each joins its type. `text` is the card's title, and a note with no `once` is held.
 */
export type Note = Omit<Notification, "landing"> & {
  detail?: string
  /** Each thing a card counts, such as the controls that couldn't sync. */
  list?: string[]
  /** The pilot it's about, whose head leads it. */
  pilot?: string
  /** That pilot is out of the flight. */
  out?: boolean
  /** Something happening now that ends by itself, which a spinner leads. */
  busy?: boolean
  /** Goes after `ONCE_MS`, rather than staying while its cause lasts. */
  once?: boolean
  landing?: Landing
}

/** How long a one-time card stays, in milliseconds, paused under the pointer. */
export const ONCE_MS = 6000

/** Held cards keep their places by this order, when they don't all fit. */
export const LEVEL_RANK: Record<Level, number> = { trouble: 0, warning: 1, information: 2 }

/**
 * The card for the core's being gone, which no core can raise. It waits for the page's first connection, since the
 * page starts out with no core heard, and it hears the core's announcement a moment later.
 */
export function serviceNote(core: CoreState, everConnected: boolean): Note | null {
  if (core === "reconnecting") return { id: "banner.service", level: "trouble", text: "Reconnecting to the Dual Input service", detail: "Nothing syncs until it's back.", landing: "stay" }
  if (core === "not-running" && everConnected) return { id: "banner.service", level: "trouble", text: "Dual Input service isn't running", detail: "Nothing syncs until it's back. Open it from the Start menu.", landing: "stay" }
  return null
}
