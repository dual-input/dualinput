// The extension's copy of the Sync log, between `serve`, which keeps the rows, and the log's webview, which draws them.
// `serve` sends each row that changed in its `dualInput/syncLog` notification, whose JSON the types in
// ../sync-log/src/view.ts read, and the mirror posts the webview what changed, at most every 100ms, and the whole log
// when the webview loads, since VS Code drops a hidden webview's page; Clear and each link's reveal go back to `serve`
// as its commands (record/areas/profiles/06-the-sync-log.md, "What `serve` keeps" and "The Sync log view"). It imports
// nothing of VS Code's, so Node's test runner tests it alone.

import type { FromSyncLog, ToSyncLog } from "../sync-log/src/messages.ts"
import type { Palette, RowView, Update } from "../sync-log/src/view.ts"
import type { Command } from "./bridge.ts"
import type { Syntax } from "./syntax.ts"

/**
 * The server's command for each of the log's calls. `serve` takes each by this name, in
 * tools/profile-builder/src/serve/sim.rs, so change both together.
 */
export const SYNC_LOG_COMMANDS = { clear: "dualInput.syncLog.clear", reveal: "dualInput.syncLog.reveal" } as const

/**
 * How long the mirror waits between posts, in ms, so a lever moving through a reading a frame posts one batch of its rows
 * rather than one a frame; a row's change reaches the view at most this much later than it reached the extension.
 */
export const PACE = 100

/** The clock the mirror paces its posts by, which a test fakes. */
export type Clock = { now(): number; after(ms: number, run: () => void): void }

const SYSTEM: Clock = { now: () => Date.now(), after: (ms, run) => void setTimeout(run, ms) }

export class SyncLogMirror {
  /** The rows `serve` keeps, by id in rising order, which a map keeps as the order they were first set. */
  private readonly rows = new Map<number, RowView>()
  /** The id of the oldest row `serve` keeps. */
  private first = 0
  /** What changed since the last post: the rows by id, and whether rows went. */
  private changed = new Set<number>()
  private dropped = false
  private post: ((message: ToSyncLog) => void) | null = null
  private palette: Palette
  private readonly execute: (command: Command) => void
  /** The token colors each palette gives keys, values, and a name call's parts, which the extension reads from its manifest. */
  private readonly syntax: Record<Palette, Syntax>
  private readonly clock: Clock
  private lastPost = Number.NEGATIVE_INFINITY
  private waiting = false

  constructor(palette: Palette, execute: (command: Command) => void, syntax: Record<Palette, Syntax>, clock: Clock = SYSTEM) {
    this.palette = palette
    this.execute = execute
    this.syntax = syntax
    this.clock = clock
  }

  /**
   * A webview resolved, which posts `ready` once its script listens; `post` sends it a message. Returns what detaches
   * it, which leaves alone a webview that resolved after it.
   */
  attach(post: (message: ToSyncLog) => void): () => void {
    this.post = post
    return () => {
      if (this.post === post) this.post = null
    }
  }

  /** The server's `dualInput/syncLog`. */
  show({ rows, first }: Update): void {
    // Every row before `first` goes, all of them after a Clear, which sends no rows at all.
    for (const id of this.rows.keys()) {
      if (id >= first) break
      this.rows.delete(id)
    }
    if (first !== this.first) this.dropped = true
    this.first = first
    for (const row of rows) {
      this.rows.set(row.id, row)
      this.changed.add(row.id)
    }
    this.pace()
  }

  /** The server stopped, and a new one numbers its rows afresh, so the log empties. */
  reset(): void {
    this.rows.clear()
    this.first = 0
    this.changed.clear()
    this.dropped = false
    this.post?.({ kind: "rows", rows: [], first: 0, whole: true })
  }

  /** The extension picked another palette, as the theme or `dualInput.colors` changed. */
  repaint(palette: Palette): void {
    if (palette === this.palette) return
    this.palette = palette
    this.post?.(this.painted())
  }

  private painted(): ToSyncLog {
    return { kind: "palette", palette: this.palette, syntax: this.syntax[this.palette] }
  }

  /** A message from the webview. */
  heard(message: FromSyncLog): void {
    switch (message.kind) {
      case "ready":
        this.changed.clear()
        this.dropped = false
        this.post?.(this.painted())
        this.post?.({ kind: "rows", rows: [...this.rows.values()], first: this.first, whole: true })
        return
      case "clear":
        return this.execute({ command: SYNC_LOG_COMMANDS.clear, arguments: [] })
      case "reveal":
        return this.execute({ command: SYNC_LOG_COMMANDS.reveal, arguments: [message.entry] })
    }
  }

  /** Posts now if the last post was a pace ago, and otherwise once it will be, with whatever changed by then. */
  private pace(): void {
    if (this.waiting) return
    const due = this.lastPost + PACE - this.clock.now()
    if (due <= 0) return this.flush()
    this.waiting = true
    this.clock.after(due, () => {
      this.waiting = false
      this.flush()
    })
  }

  private flush(): void {
    if (!this.changed.size && !this.dropped) return
    const rows = [...this.changed].sort((a, b) => a - b).flatMap((id) => this.rows.get(id) ?? [])
    this.changed.clear()
    this.dropped = false
    if (!this.post) return
    this.lastPost = this.clock.now()
    this.post({ kind: "rows", rows, first: this.first, whole: false })
  }
}
