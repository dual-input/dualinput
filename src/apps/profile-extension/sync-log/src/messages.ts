// The messages between the Sync log's webview and the extension, which mirrors `serve`'s rows and posts them here, so the
// log draws in the webview as it draws on its dev page (record/areas/profiles/06-the-sync-log.md, "The Sync log view").

import type { Syntax } from "../../src/syntax.ts"
import type { Palette, RowView } from "./view.ts"

/**
 * From the extension: the palette, with the token colors it gives keys, values, and a name call's parts, when it
 * changes and once the webview is ready; or rows, which replace the rows of their ids after every row before `first`
 * goes, or with `whole`, replace every row, as when the webview loads afresh or `serve` stops.
 */
export type ToSyncLog = { kind: "palette"; palette: Palette; syntax: Syntax } | { kind: "rows"; rows: RowView[]; first: number; whole: boolean }

/** From the webview: `ready` once its script listens, since a message posted before then is lost; or a call of `SyncLogHost`'s. */
export type FromSyncLog = { kind: "ready" } | { kind: "clear" } | { kind: "reveal"; entry: string }
