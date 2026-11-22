// What the Dual Input panel shows, and what it calls back. The extension builds a `PanelView` from `serve`'s messages and
// posts it to the webview, and the panel draws from it alone, so the panel holds none of the sim's state and the dev page
// can feed it any state by hand. A call on `PanelHost` goes back to the extension, which sends `serve` the matching
// `authoring.panel` or `authoring.run` (record/areas/profiles/04-the-extension-in-the-sim.md, "The Dual Input panel").

/** The look of VS Code's theme, picked as the extension picks the profile's token colors, `dualInput.colors` included. */
export type Palette = "dark" | "light"

export type PanelView = {
  palette: Palette
  status: Status
  /** Whether the open text differs from the bundle the session pinned, so a Run runs edits the crew's cockpits don't have until a save. */
  unpinned: boolean
  body: Body
}

/** The status line's state, from your Dual Input, the session, and the open file. */
export type Status =
  | { kind: "not-running" }
  /** The extension and Dual Input are of different releases, so the extension sends nothing until `update` names the side that catches up. */
  | { kind: "other-release"; extension: string; dualInput: string; update: "extension" | "dual-input" }
  /** Another VS Code window's `serve` connected later, and `authoring` serves only the last. */
  | { kind: "other-window" }
  | { kind: "no-session" }
  | { kind: "not-in-flight" }
  /**
   * In the session's flight. `aircraft` is its maker and model, as the EFB app names it. `runs` is whether the open file
   * is the profile the session flies or a module it imports: a file for another aircraft still shows live values, and
   * Run is off. `crew` is whether anyone else is in the session, whose cockpit runs the bundle it pinned.
   */
  | { kind: "in-flight"; aircraft: string; runs: boolean; crew: boolean }

/** What sits under the status line: nothing, Run for one entry, or the display picker. */
export type Body = { kind: "nothing" } | { kind: "run"; run: RunView } | { kind: "picker"; picker: PickerView }

export type RunView = {
  /** The entry's `name:`, as `Left mixture`. */
  name: string
  /** The entry's key, as `mixture_1`, which Run sends with the value. */
  key: string
  /** What the value field takes: a value; a value or none, for an event entry; or a step count, as `+3`, for a counting entry. */
  takes: "value" | "event" | "steps"
  /** What the entry's watch reads now, each as its box in the editor shows it, or none before its first reading. */
  live: Reading[]
  /** The value field's text as the panel opens on the entry. */
  field: string
  /** The values the watch has read since it was watched, in ascending order, at most 8, or `many` once it has read more. */
  seen: string[] | "many"
  /** What Run sends for the field's text, worked out as typing pauses. */
  preview: Preview
  /** Why Run is off for this entry whatever the field holds, or null when it runs. */
  refused: Refusal | null
  /** The aircraft's putting the value back after the last Run, or null when it held or moved nothing. */
  revert: Revert | null
}

/** One value of a watch, as `0.25`, `true`, or an event's firings, `×3`. */
export type Reading = {
  /** Which of the watch's names it's for, when it has several, as a counting map's `inc` and `dec`. */
  of: string | null
  value: string
  /** The last value an event carried, when it carried one. */
  carried?: string
  /** Whether `value` holds an error's words in place of a value, for a name the sim refused. */
  error?: boolean
}

export type Preview =
  /** Nothing typed yet, for an entry whose field needs a value. */
  | { kind: "waiting" }
  /** The actions in the order Run sends them, or none when the write sends nothing for this value. */
  | { kind: "sends"; actions: Action[] }
  /** The build's first error, since a file that doesn't build has no Run. `where` is its place, as `bksq-baronpro.yaml:270:42`. */
  | { kind: "error"; message: string; where: string }

/** One action of a Run, or a run of the same action from a chain's `.repeat()` or a counting entry's steps. */
export type Action = {
  /** Sets an `L:` or `A:` variable, fires a `K:` or `H:` event, or calls a `B:` input event's preset. */
  does: "set" | "fire" | "call"
  /** The name with its prefix, as `L:BKSQ_MixtureLeverPosition_1`. */
  name: string
  /** The values it carries, as the `0.5` a set writes or an event's arguments. */
  values: string[]
  times: number
  /** The pace between repeats, as `1 frame` or `50ms`, or null for one action. */
  apart: string | null
}

/** A PM's Run on an entry the PF owns, which state sync would put back. */
export type Refusal = { kind: "pilot-flying-only"; pilotFlying: string }

/** The watch's value left its reading from before the Run and came back to it, `afterMs` after the Run's last action. */
export type Revert = { to: string; afterMs: number }

export type PickerView = {
  groups: PickerGroup[]
  /** The row you're on, which the sim outlines: a row's key, or a shared identifier's heading. */
  active: string
}

/**
 * An identifier one instrument holds, or a full key several panels hold, is one row; an identifier several instruments
 * share is a heading over a row for each full key, since only a full key names one of them.
 */
export type PickerGroup = { kind: "single"; row: DisplayRow } | { kind: "shared"; identifier: string; rows: DisplayRow[] }

export type DisplayRow = {
  /** What a write puts in `displays` for the row: an identifier, as `KAS297B_1`, or a full key, as `KX155B|Index=1`. */
  key: string
  /** The instrument's full key, as its panel's `hello` names it, which differs from `key` when the row writes the identifier alone. */
  fullKey: string
  /** How many of the cockpit's panels hold it: more than 1 for a full key two panels hold, all of which the sim outlines. */
  panels: number
  /** Whether it's ticked, which a row already in `displays` starts as. */
  ticked: boolean
  /** Why it can't be ticked: a `WasmInstrument|` key fails the load, since v1's pointer sync reaches HTML displays only. */
  refused: "wasm-instrument" | null
}

/** What the panel calls back on the extension. */
export type PanelHost = {
  /** The value field's text changed, for the preview. */
  typed(text: string): void
  /** Runs the open entry with the value field's text. */
  run(text: string): void
  /** Opens the file at a build error's place, as `Preview`'s `where` names it. */
  reveal(where: string): void
  /** Moves the picker to a row or a heading, which the sim outlines in place of the last. */
  move(row: string): void
  /** Ticks a row, or unticks a ticked one; on a heading, ticks every row under it, or unticks them all once all are ticked. */
  tick(row: string): void
  /**
   * Writes the ticked rows into `displays`, one to a line: a shared identifier whose every key is ticked as the
   * identifier alone, since it then names them all, and survives liveries as an identifier does.
   */
  write(): void
  /** Leaves the picker, and the sim clears its outline. */
  leave(): void
}
