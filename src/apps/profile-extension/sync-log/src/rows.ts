// The Sync log's rows as the webview holds them, and each one's words as it shows them. It imports no React, so a test
// or the extension can take it alone.

import { apart, type Part, reasoned, type Word } from "../../src/words.ts"
import type { Cause, Note, RowView, StepView } from "./view.ts"

/** The rows by id, in rising order, as `serve` numbers them. */
export type Held = Map<number, RowView>

/**
 * Takes a message's rows into `held`: with `whole`, in place of every row, and otherwise after dropping each row before
 * `first`, each in place of the row of its id. A new row's id is higher than every row held, so a map's order of
 * insertion stays the order of ids.
 */
export function take(held: Held, { rows, first, whole }: { rows: RowView[]; first: number; whole: boolean }): void {
  if (whole) held.clear()
  for (const id of held.keys()) {
    if (id >= first) break
    held.delete(id)
  }
  for (const row of rows) held.set(row.id, row)
}

/** A row's time of day, on this PC's clock, to the millisecond, as `14:02:11.384`. */
export function timeOfDay(time: number): string {
  const at = new Date(time)
  const two = (n: number) => String(n).padStart(2, "0")
  return `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}.${String(at.getMilliseconds()).padStart(3, "0")}`
}

/**
 * A step's time from its row's first, as `+212ms`, and past a second `+1.71s`, or null where no time passed since the
 * step before, since most steps take none and an author reads their order, not their milliseconds. The first step
 * shows none.
 */
export function later(row: RowView, at: number): string | null {
  const ms = row.steps[at]?.ms ?? 0
  if (at === 0 || ms <= (row.steps[at - 1]?.ms ?? 0)) return null
  return ms < 1000 ? `+${ms}ms` : `+${(ms / 1000).toFixed(2)}s`
}

/** Who a catch-up's value came from, after its word, as ` from Ana` or `, playback`. */
function source(from: string | null, playback: boolean): string {
  if (from !== null) return ` from ${from}`
  return playback ? ", playback" : ""
}

/** A row's cause, as `local change`, `from Ana`, `playback`, `catch-up from Ana`, or `control passed`. */
export function causeOf(cause: Cause): Part[] {
  switch (cause.kind) {
    case "local-change":
    case "control-passed":
      return [{ word: cause.kind }]
    case "arrived":
      if (cause.from !== null) return [{ text: `from ${cause.from}` }]
      return cause.playback ? [{ text: "playback" }] : [{ word: "arrived" }]
    case "catch-up":
      return [{ word: "catch-up" }, { text: source(cause.from, cause.playback) }]
  }
}

/**
 * A piece of a step as the log says it: one of the engine's words, text, muted where it only says who, an entry's key
 * that opens its line, what the step carries, which the view draws by the step's word, or a second word, muted.
 */
export type StepPart = { word: Word } | { text: string; muted?: true } | { link: string } | { detail: string; of: Word } | { also: Word }

/**
 * A step in pieces: its word, then what it carries, as `pending 1` and `read back 1, landed`. The row's first step names
 * who sent its value, as `arrived from Ana 1`; a second word that says why follows a colon, as `withdrawn: lost`, as
 * `reasoned` in words.ts decides; and a step that names entries shows their keys, as `waits for ap_altitude_hold`, which
 * its detail also carries.
 */
export function stepParts(row: RowView, step: StepView, at: number): StepPart[] {
  const parts: StepPart[] = [{ word: step.word }]
  const carried = (detail: string | null): StepPart[] => (detail ? [{ text: apart(step.word) }, { detail, of: step.word }] : [])
  const why = step.also !== null && reasoned(step.word)
  if (why && step.also) parts.push({ text: ": " }, { word: step.also })
  if (at === 0 && (row.cause.kind === "arrived" || row.cause.kind === "catch-up")) {
    const from = row.cause.from !== null ? `from ${row.cause.from}` : row.cause.playback ? "from the playback" : null
    if (from) parts.push({ text: ` ${from}`, muted: true })
    return [...parts, ...carried(step.detail)]
  }
  step.links.forEach((link, place) => parts.push({ text: place ? ", " : " " }, { link }))
  if (!step.links.length) parts.push(...carried(step.detail))
  if (step.also && !why) parts.push({ text: ", ", muted: true }, { also: step.also })
  return parts
}

/**
 * A piece of a write's actions as the log colors it, after the parts the profile grammar gives a name call in the editor:
 * the call's kind, as `K`, its name, its other arguments, as a unit or an index, the punctuation around them, and the
 * values the write sends after the call.
 */
export type ActionPart = { part: "kind" | "name" | "argument" | "punctuation" | "value" | "space"; text: string }

/** The kinds a name call opens with, as the profile grammar's `name-call` reads them. */
const CALL = /^(L|A|B|K|H|instrument)\(/
const QUOTED = /^(['"])((?:\\.|(?!\1).)*)\1/
/** Where the next action starts after an action's values: `, ` before a name call. */
const NEXT = /, (?=(?:L|A|B|K|H|instrument)\()/

/**
 * A `writes` step's detail in pieces. `serve` writes each action as the profile writes its name, then the values it
 * sends, and joins the actions with `, `, as `K('FLAPS_SET') 8192, B('LIGHTING_BEACON_1_Toggle')`; a comma inside a
 * call's brackets separates its arguments instead. An action's values run to the next action as one piece, so a 4 KB
 * text, spaces and all, is one value the log can clip.
 */
export function actionParts(text: string): ActionPart[] {
  const parts: ActionPart[] = []
  const add = (part: ActionPart["part"], piece: string) => {
    const last = parts[parts.length - 1]
    if (last && last.part === part && part !== "name" && part !== "kind") last.text += piece
    else parts.push({ part, text: piece })
  }
  let at = 0
  let depth = 0
  // Whether the call's next quoted string is its name, which only the first is.
  let named = false
  while (at < text.length) {
    const rest = text.slice(at)
    const char = text[at]!
    if (depth === 0) {
      const call = CALL.exec(rest)
      if (call) {
        add("kind", call[1]!)
        add("punctuation", "(")
        depth = 1
        named = true
        at += call[0].length
      } else if (char === "," || char === " ") {
        add(char === "," ? "punctuation" : "space", char)
        at += 1
      } else {
        const next = NEXT.exec(rest)
        const value = next ? rest.slice(0, next.index) : rest
        add("value", value)
        at += value.length
      }
      continue
    }
    const quoted = QUOTED.exec(rest)
    if (quoted) {
      add("punctuation", quoted[1]!)
      add(named ? "name" : "argument", quoted[2]!)
      add("punctuation", quoted[1]!)
      named = false
      at += quoted[0].length
    } else if (char === "(" || char === ")" || char === "," || char === " ") {
      if (char === "(") depth += 1
      if (char === ")") depth -= 1
      add("punctuation", char)
      at += 1
    } else {
      const argument = /^[^\s,()'"]+/.exec(rest)?.[0] ?? char
      add("argument", argument)
      at += argument.length
    }
  }
  return parts
}

/** A piece of a note: text, an entry's key, which the view draws as a key and opens its line, or a time to stand out. */
export type NotePart = { text: string } | { key: string } | { time: string }

/** A note under a row, in pieces. */
export function noteOf(row: RowView, note: Note): NotePart[] {
  switch (note.kind) {
    case "ran":
      return [
        { text: "You ran " },
        { key: row.entry },
        { text: "'s write " },
        { time: `${note.ms}ms` },
        { text: " before this. Run writes outside the sync, so its write shows as a local change, without a sync's steps. To see those steps, record a change and play it back." },
      ]
    case "unloaded":
      return [{ text: "The profile unloaded before this finished." }]
  }
}

/** The names a filter's text gives, as `battery, throttle` gives two, in lowercase. */
export function namesIn(filter: string): string[] {
  return filter
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
}

/** Whether a row's entry is one of `names`, by any part of its key, as the Problems panel's filter matches. */
export function named(row: RowView, names: string[]): boolean {
  const key = row.entry.toLowerCase()
  return names.some((one) => key.includes(one))
}

/**
 * Whether a step says the profile has a bug to fix, which the log draws in the trouble color rather than the warning
 * color the aircraft's and the sim's trouble takes: a write function that threw, an entry stopped since its function
 * failed to compile or ran out of time or memory, which `serve` sends as the error's words, a read the sim refused, and
 * an event entry whose write sets a variable from an event that carried no value to set it to.
 */
export function isBug(step: StepView): boolean {
  if (step.word === "stopped") return step.also !== "driven" && step.detail !== null
  return step.word === "function-failed" || step.word === "dropped-refused" || step.word === "no-value"
}

/** The verdicts the log draws in the warning color, since each says a write or a change didn't do what it set out to. */
export const TROUBLE = new Set<Word>(["never-landed", "lost", "differs", "stopped", "function-failed", "too-large", "dropped-refused", "token-expired", "ignore-expired", "no-value", "skipped-stopped"])
