// What the Sync log shows, and what it calls back. `serve` keeps the rows and sends each one that changed in its
// `dualInput/syncLog` notification, whose JSON these types read, from the view's types in
// tools/profile-builder/src/serve/sync_log.rs, so change the two together; the extension mirrors the rows and posts them
// here, and the log draws from them alone, so the dev page can feed it any rows by hand
// (record/areas/profiles/06-the-sync-log.md, "What `serve` keeps" and "The Sync log view").

import type { Word } from "../../src/words.ts"

export type { Palette } from "../../panel/src/view.ts"

/**
 * The notification: the rows that changed since the last, each whole, which replace the rows of their ids, and the id of
 * the oldest row `serve` keeps, so every row before it goes, all of them after a Clear. Ids rise with the rows.
 */
export type Update = { rows: RowView[]; first: number }

/** One cause and every step the engine took for it. */
export type RowView = {
  id: number
  /** When its first step reached `serve`, in ms since the Unix epoch. */
  time: number
  /** The entry's key, which the log shows, since an author knows an entry by the key they wrote, and a link sends. */
  entry: string
  cause: Cause
  /** The value the cause brings, as a box shows a value. */
  value: string | null
  /** The latest step's word, as `landed` for the read back of the row's last value. */
  verdict: Word
  /** Whether the row waits on more of the engine, which `serve` decides, so the log marks it under way. */
  open: boolean
  steps: StepView[]
  notes: Note[]
}

/** A crew member by the session's name for them, or none, as for a playback, which the recorder's pretend sender plays. */
export type Cause = { kind: "local-change" } | { kind: "arrived"; from: string | null; playback: boolean } | { kind: "catch-up"; from: string | null; playback: boolean } | { kind: "control-passed" }

export type StepView = {
  /** The time from the row's first step, in ms. */
  ms: number
  word: Word
  /** A value, the actions written, or an error's words. */
  detail: string | null
  /** A second word the step carries, as `landed` on a read back. */
  also: Word | null
  /** The keys of the entries the step names, as the ones a write waits for, each a link to its line. */
  links: string[]
}

/**
 * A note `serve` adds under a row: that you ran the entry `ms` before the row began, or that the profile unloaded before
 * the row's write finished.
 */
export type Note = { kind: "ran"; ms: number } | { kind: "unloaded" }

/** What the log calls back on the extension. */
export type SyncLogHost = {
  /** Empties the log, in `serve` too. */
  clear(): void
  /** Opens the line of the entry with this key in the editor. */
  reveal(entry: string): void
}
