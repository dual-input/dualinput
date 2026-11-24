// The bridge between the Dual Input panel's webview and the language server, `serve`, which owns everything the panel
// shows. The server sends the panel's view whole, in its `dualInput/panel` notification, and the bridge hands it to the
// webview with the palette the extension picked; each of the panel's calls goes back to the server as one of its
// commands, but a reveal, which opens a file and only VS Code can do (record/areas/profiles/04-the-extension-in-the-sim.md,
// "The connection"). It imports nothing of VS Code's, so Node's test runner tests it alone.

import type { FromPanel, ToPanel } from "../panel/src/messages.ts"
import type { PanelView } from "../panel/src/view.ts"
import type { Palette } from "./palette.ts"

/** The view as the server sends it, which knows nothing of VS Code's theme. A `palette` it carries is replaced. */
export type ServerView = Omit<PanelView, "palette">

/** What the panel shows until the server sends a view, and again once the server stops. */
export const NOT_RUNNING: ServerView = { status: { kind: "not-running" }, unpinned: false, body: { kind: "nothing" }, recorder: { kind: "off", why: "no-flight", lengthMs: null } }

/**
 * The server's command for each of the panel's calls but `reveal`, which takes the call's one value, or none. `serve`
 * takes each by this name, in tools/profile-builder/src/serve.rs, so change both together.
 */
export const PANEL_COMMANDS = {
  typed: "dualInput.panel.typed",
  run: "dualInput.panel.run",
  move: "dualInput.panel.move",
  tick: "dualInput.panel.tick",
  write: "dualInput.panel.write",
  leave: "dualInput.panel.leave",
  record: "dualInput.panel.record",
  stop: "dualInput.panel.stop",
  play: "dualInput.panel.play",
} as const

/** A command for the server, as LSP's `workspace/executeCommand` carries it. */
export type Command = { command: string; arguments: unknown[] }

/** What the bridge asks of the extension: sending the server a command, and opening a file at a build error's place. */
export type Ends = { execute(command: Command): void; reveal(where: string): void }

/** The server's command for one of the panel's calls, or null for the two that stay in the extension. */
export function commandFor(message: FromPanel): Command | null {
  switch (message.kind) {
    case "typed":
    case "run":
      return { command: PANEL_COMMANDS[message.kind], arguments: [message.text] }
    case "move":
    case "tick":
      return { command: PANEL_COMMANDS[message.kind], arguments: [message.row] }
    case "write":
    case "leave":
    case "record":
    case "stop":
    case "play":
      return { command: PANEL_COMMANDS[message.kind], arguments: [] }
    case "ready":
    case "reveal":
      return null
  }
}

/** The panel's view and palette, and the webview it posts them to while one is open. */
export class PanelBridge {
  private view: ServerView = NOT_RUNNING
  private post: ((message: ToPanel) => void) | null = null
  private palette: Palette
  private readonly ends: Ends

  constructor(palette: Palette, ends: Ends) {
    this.palette = palette
    this.ends = ends
  }

  /**
   * A webview resolved, which posts `ready` once its script listens; `post` sends it a message. Returns what detaches
   * it, which leaves alone a webview that resolved after it, so the order in which VS Code disposes one webview and
   * resolves the next doesn't matter.
   */
  attach(post: (message: ToPanel) => void): () => void {
    this.post = post
    return () => {
      if (this.post === post) this.post = null
    }
  }

  /** The server's `dualInput/panel`. */
  show(view: ServerView): void {
    this.view = view
    this.send()
  }

  /** The server stopped, so nothing tells the panel its state any more. */
  reset(): void {
    this.show(NOT_RUNNING)
  }

  /** The extension picked another palette, as the theme or `dualInput.colors` changed. */
  repaint(palette: Palette): void {
    if (palette === this.palette) return
    this.palette = palette
    this.send()
  }

  /** A message from the webview. */
  heard(message: FromPanel): void {
    if (message.kind === "ready") return this.send()
    if (message.kind === "reveal") return this.ends.reveal(message.where)
    const command = commandFor(message)
    if (command) this.ends.execute(command)
  }

  private send(): void {
    this.post?.({ kind: "view", view: { ...this.view, palette: this.palette } })
  }
}

/** A place in a file, with its line and character counted from 0, as VS Code counts them. */
export type Place = { file: string; line: number; character: number }

/**
 * The place a build error's `where` names, as `bksq-baronpro.yaml:270:45`, a file and its line and column counted from
 * 1, or null for text of another shape. The file may be a whole path, a drive's colon included, since only the last
 * colons part it from the line and column; a `where` with no column names the line's start.
 */
export function placeOf(where: string): Place | null {
  const parts = /^(.+?):(\d+)(?::(\d+))?$/.exec(where.trim())
  if (!parts) return null
  const line = Number(parts[2])
  const column = parts[3] === undefined ? 1 : Number(parts[3])
  if (line < 1 || column < 1) return null
  return { file: parts[1]!, line: line - 1, character: column - 1 }
}
