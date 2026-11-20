// A notification as the banner draws it: information, a warning, or trouble that costs the pilot a feature, held
// while its cause lasts or shown once (record/areas/interface/decisions.md, "The banner carries what a pilot must see
// without the EFB, and the rest shows where it's acted on").

import type { Landing as CoreLanding } from "../../../engines/messages/ts/clients/Landing.ts"
import type { Level } from "../../../engines/messages/ts/clients/Level.ts"
import type { Notification } from "../../../engines/messages/ts/clients/Notification.ts"
import type { CoreState } from "../../../engines/page-client/src/core-link.ts"

/** Where a click on a card opens the EFB app: where the core says, or for the service gone, whose screen covers every tab, wherever the app was. */
export type Landing = CoreLanding | "stay"

/** The core's notification, and what the banner adds to it. */
export type Note = Omit<Notification, "landing"> & {
  landing: Landing
  /** Each thing a card counts, such as the controls that couldn't sync. */
  list?: string[]
}

/** How long a one-time card stays, in milliseconds, paused under the pointer. When this grows, `ONCE_STAYS` in src/platform/clients/src/lib.rs, which keeps the notification in the slice past this time, grows with it. */
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
