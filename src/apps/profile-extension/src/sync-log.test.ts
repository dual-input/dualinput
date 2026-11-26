// Tests the extension's copy of the Sync log between `serve` and the log's webview, and the rows as the webview holds and
// says them (record/areas/profiles/06-the-sync-log.md, "What `serve` keeps" and "The Sync log view").
//
//   node --test src/apps/profile-extension/src/sync-log.test.ts

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import type { ToSyncLog } from "../sync-log/src/messages.ts"
import { actionParts, causeOf, type Held, isBug, later, named, namesIn, noteOf, type StepPart, stepParts, take, timeOfDay } from "../sync-log/src/rows.ts"
import type { RowView, StepView } from "../sync-log/src/view.ts"
import type { Command } from "./bridge.ts"
import { type Palette, palettes } from "./palette.ts"
import { type Clock, PACE, SyncLogMirror } from "./sync-log.ts"
import { SCOPES, type Syntax, syntaxOf } from "./syntax.ts"
import { textOf, WORDS } from "./words.ts"

/** A row of the battery's from Ana that landed, as `serve` sends one, with `id` and `verdict` to vary. */
function row(id: number, verdict: RowView["verdict"] = "landed"): RowView {
  return {
    id,
    time: new Date(2026, 10, 25, 14, 2, 11, 384).getTime(),
    entry: "battery",
    cause: { kind: "arrived", from: "Ana", playback: false },
    value: "1",
    verdict,
    open: false,
    steps: [
      { ms: 0, word: "arrived", detail: "1", also: null, links: [] },
      { ms: 0, word: "pending", detail: "1", also: null, links: [] },
      { ms: 84, word: "read-back", detail: "1", also: "landed", links: [] },
    ],
    notes: [],
  }
}

/** A clock whose time moves only when the test says, running what waits for it as it passes. */
function fakeClock() {
  let now = 1_000
  const waiting: { at: number; run: () => void }[] = []
  const clock: Clock = { now: () => now, after: (ms, run) => void waiting.push({ at: now + ms, run }) }
  const pass = (ms: number) => {
    now += ms
    for (const due of waiting.filter((one) => one.at <= now)) {
      waiting.splice(waiting.indexOf(due), 1)
      due.run()
    }
  }
  return { clock, pass }
}

/** Token colors for each palette, one part each, to tell which palette's the mirror posted. */
const SYNTAX: Record<Palette, Syntax> = {
  dark: { entry: { color: "#81b4f6", bold: true, italic: false } },
  light: { entry: { color: "#025eb8", bold: true, italic: false } },
}

/** A mirror in the dark palette with a webview attached, and what it posted and sent. */
function mirrored() {
  const posted: ToSyncLog[] = []
  const sent: Command[] = []
  const { clock, pass } = fakeClock()
  const mirror = new SyncLogMirror("dark", (command) => sent.push(command), SYNTAX, clock)
  const detach = mirror.attach((message) => posted.push(message))
  return { mirror, posted, sent, pass, detach }
}

test("a webview that's ready gets the palette and every row the mirror holds", () => {
  const { mirror, posted } = mirrored()
  mirror.show({ rows: [row(0), row(1)], first: 0 })
  posted.length = 0
  mirror.heard({ kind: "ready" })
  assert.deepEqual(posted, [
    { kind: "palette", palette: "dark", syntax: SYNTAX.dark },
    { kind: "rows", rows: [row(0), row(1)], first: 0, whole: true },
  ])
})

test("rows that change within a pace of the last post go together, once the pace has passed, each as it last stood", () => {
  const { mirror, posted, pass } = mirrored()
  mirror.show({ rows: [row(0, "pending")], first: 0 })
  mirror.show({ rows: [row(1, "pending")], first: 0 })
  mirror.show({ rows: [row(0, "landed")], first: 0 })
  assert.deepEqual(posted, [{ kind: "rows", rows: [row(0, "pending")], first: 0, whole: false }], "the first goes at once")
  pass(PACE - 1)
  assert.equal(posted.length, 1)
  pass(1)
  assert.deepEqual(posted[1], { kind: "rows", rows: [row(0, "landed"), row(1, "pending")], first: 0, whole: false })
  pass(PACE * 3)
  assert.equal(posted.length, 2, "nothing more changed")
})

test("rows before serve's first go from the mirror, and a Clear, which sends none, still reaches the webview", () => {
  const { mirror, posted, pass } = mirrored()
  mirror.show({ rows: [row(0), row(1), row(2)], first: 0 })
  pass(PACE)
  mirror.show({ rows: [], first: 3 })
  assert.deepEqual(posted.at(-1), { kind: "rows", rows: [], first: 3, whole: false })
  mirror.heard({ kind: "ready" })
  assert.deepEqual(posted.at(-1), { kind: "rows", rows: [], first: 3, whole: true })
})

test("a mirror with no webview keeps the rows and posts nothing, and the webview gets them all when it's ready", () => {
  const { mirror, posted, pass, detach } = mirrored()
  detach()
  mirror.show({ rows: [row(0)], first: 0 })
  pass(PACE)
  assert.deepEqual(posted, [])
  const again: ToSyncLog[] = []
  mirror.attach((message) => again.push(message))
  mirror.heard({ kind: "ready" })
  assert.deepEqual(again.at(-1), { kind: "rows", rows: [row(0)], first: 0, whole: true })
})

test("a stopped server empties the log, and another palette goes to the webview once", () => {
  const { mirror, posted } = mirrored()
  mirror.show({ rows: [row(0)], first: 0 })
  mirror.reset()
  assert.deepEqual(posted.at(-1), { kind: "rows", rows: [], first: 0, whole: true })
  mirror.repaint("dark")
  mirror.repaint("light")
  assert.deepEqual(posted.at(-1), { kind: "palette", palette: "light", syntax: SYNTAX.light })
  assert.equal(posted.filter((message) => message.kind === "palette").length, 1)
})

test("Clear and a link's reveal go to serve as its commands", () => {
  const { mirror, sent, posted } = mirrored()
  mirror.heard({ kind: "clear" })
  mirror.heard({ kind: "reveal", entry: "ap_altitude_hold" })
  assert.deepEqual(sent, [
    { command: "dualInput.syncLog.clear", arguments: [] },
    { command: "dualInput.syncLog.reveal", arguments: ["ap_altitude_hold"] },
  ])
  assert.deepEqual(posted, [])
})

test("the webview's rows take each message in place, and drop every row before its first", () => {
  const held: Held = new Map()
  take(held, { rows: [row(0), row(1), row(2)], first: 0, whole: true })
  take(held, { rows: [row(1, "never-landed"), row(3)], first: 1, whole: false })
  assert.deepEqual([...held.values()], [row(1, "never-landed"), row(2), row(3)])
  take(held, { rows: [row(7)], first: 7, whole: true })
  assert.deepEqual([...held.keys()], [7])
})

/** A step's pieces as the log reads them, each word by its label. */
function said(parts: StepPart[]): string {
  return parts.map((part) => ("word" in part ? WORDS[part.word].label : "also" in part ? WORDS[part.also].label : "link" in part ? part.link : "detail" in part ? part.detail : part.text)).join("")
}

test("a row says its time of day, its cause, and each step, with the sender on its first", () => {
  assert.equal(timeOfDay(new Date(2026, 10, 25, 14, 2, 11, 384).getTime()), "14:02:11.384")
  assert.equal(timeOfDay(new Date(2026, 10, 25, 9, 5, 1, 7).getTime()), "09:05:01.007")
  assert.equal(textOf(causeOf({ kind: "local-change" })), "local change")
  assert.equal(textOf(causeOf({ kind: "arrived", from: "Ana", playback: false })), "from Ana")
  assert.equal(textOf(causeOf({ kind: "arrived", from: null, playback: true })), "playback")
  assert.equal(textOf(causeOf({ kind: "catch-up", from: "Ana", playback: false })), "catch-up from Ana")
  assert.equal(textOf(causeOf({ kind: "catch-up", from: null, playback: true })), "catch-up, playback")
  assert.equal(textOf(causeOf({ kind: "control-passed" })), "control passed")
  const battery = row(0)
  assert.deepEqual(
    battery.steps.map((step, at) => said(stepParts(battery, step, at))),
    ["arrived from Ana 1", "pending 1", "read back 1, landed"],
  )
  const behind = stepParts(battery, { ms: 0, word: "waits-for", detail: "ap_altitude_hold, yaw_damper", also: null, links: ["ap_altitude_hold", "yaw_damper"] }, 1)
  assert.equal(said(behind), "waits for ap_altitude_hold, yaw_damper")
  assert.deepEqual(
    behind.flatMap((part) => ("link" in part ? [part.link] : [])),
    ["ap_altitude_hold", "yaw_damper"],
  )
  assert.equal(said(stepParts(battery, { ms: 0, word: "stopped", detail: null, also: "driven", links: [] }, 1)), "stopped: driven")
  assert.equal(said(stepParts(battery, { ms: 0, word: "withdrawn", detail: null, also: "lost", links: [] }, 1)), "withdrawn: lost")
  assert.equal(said(stepParts(battery, { ms: 0, word: "stopped", detail: "Unexpected token", also: null, links: [] }, 1)), "stopped: Unexpected token")
  assert.equal(said(stepParts(battery, { ms: 0, word: "function-failed", detail: "ReferenceError: valu is not defined", also: null, links: [] }, 1)), "function failed: ReferenceError: valu is not defined")
})

test("a step shows its time from the row's first only where time passed since the step before", () => {
  const battery = row(0)
  assert.deepEqual([0, 1, 2].map((at) => later(battery, at)), [null, null, "+84ms"])
  const slow: RowView = { ...battery, steps: [...battery.steps, { ms: 1712, word: "never-landed", detail: "0", also: null, links: [] }] }
  assert.equal(later(slow, 3), "+1.71s")
})

test("a note says when you ran the entry, its key and time standing out, or that the profile unloaded", () => {
  const ran = noteOf(row(0), { kind: "ran", ms: 40 })
  assert.equal(
    ran.map((part) => ("key" in part ? part.key : "time" in part ? part.time : part.text)).join(""),
    "You ran battery's write 40ms before this. Run writes outside the sync, so its write shows as a local change, without a sync's steps. To see those steps, record a change and play it back.",
  )
  assert.deepEqual(
    ran.filter((part) => !("text" in part)),
    [{ key: "battery" }, { time: "40ms" }],
  )
  assert.deepEqual(noteOf(row(0), { kind: "unloaded" }), [{ text: "The profile unloaded before this finished." }])
})

test("a write's actions split into the parts the profile grammar colors, a comma in a call's brackets separating its arguments", () => {
  const parts = (text: string) => actionParts(text).map(({ part, text }) => `${part}:${text}`)
  assert.deepEqual(parts("K('FLAPS_SET') 8192"), ["kind:K", "punctuation:('", "name:FLAPS_SET", "punctuation:')", "space: ", "value:8192"])
  assert.deepEqual(parts("L('BKSQ_Mixture_1', 'number') 0.75, H('BKSQ_Beacon')"), [
    "kind:L",
    "punctuation:('",
    "name:BKSQ_Mixture_1",
    "punctuation:', '",
    "argument:number",
    "punctuation:')",
    "space: ",
    "value:0.75",
    "punctuation:,",
    "space: ",
    "kind:H",
    "punctuation:('",
    "name:BKSQ_Beacon",
    "punctuation:')",
  ])
  assert.deepEqual(parts("K('HEADING_BUG_SET', 1, value) 270"), ["kind:K", "punctuation:('", "name:HEADING_BUG_SET", "punctuation:', ", "argument:1", "punctuation:, ", "argument:value", "punctuation:)", "space: ", "value:270"])
  // A K event's arguments come after its call too, as its values, which `serve` joins with spaces, as one piece.
  assert.deepEqual(parts("K('BUS_TOGGLE', 2, 6) 2 6").slice(-2), ["space: ", "value:2 6"])
  // A text value, a tab and a comma among its words, is one value up to the next action.
  assert.deepEqual(parts("L('ATIS') KILO\t1350Z, WIND 270, K('GO')"), [
    "kind:L",
    "punctuation:('",
    "name:ATIS",
    "punctuation:')",
    "space: ",
    "value:KILO\t1350Z, WIND 270",
    "punctuation:,",
    "space: ",
    "kind:K",
    "punctuation:('",
    "name:GO",
    "punctuation:')",
  ])
  assert.equal(
    actionParts("instrument('PFD', 'altitude')")
      .map((part) => part.text)
      .join(""),
    "instrument('PFD', 'altitude')",
  )
})

test("the manifest gives every part the log paints in the profile's colors a color in both palettes", () => {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  const all = palettes(manifest)
  for (const palette of ["dark", "light"] as const) {
    const syntax = syntaxOf(all[palette])
    for (const part of Object.keys(SCOPES) as (keyof typeof SCOPES)[]) assert.match(syntax[part]?.color ?? "", /^#[0-9a-f]{6}$/i, `${palette} ${part}`)
  }
  assert.ok(syntaxOf(all.dark).entry?.bold, "an entry's key is bold, as in the editor")
})

test("a profile's bug is a step of its own apart from the aircraft's trouble: a function that threw or stopped its entry, and a refused read", () => {
  const step = (word: StepView["word"], detail: string | null = null, also: StepView["also"] = null): StepView => ({ ms: 0, word, detail, also, links: [] })
  assert.ok(isBug(step("function-failed", "ReferenceError: valu is not defined")))
  assert.ok(isBug(step("stopped", "Unexpected token")))
  assert.ok(isBug(step("dropped-refused")))
  assert.ok(isBug(step("no-value")), "an entry whose write needs a value its event doesn't carry")
  assert.ok(!isBug(step("stopped", null, "driven")), "an entry the aircraft drives is the aircraft's doing")
  assert.ok(!isBug(step("never-landed", "0")))
})

test("a filter names entries by any part of their key, separated by commas", () => {
  assert.deepEqual(namesIn(" Battery, throttle ,, "), ["battery", "throttle"])
  assert.ok(named(row(0), ["batt"]))
  assert.ok(named(row(0), ["gear", "battery"]))
  assert.ok(!named(row(0), ["gear"]))
})
