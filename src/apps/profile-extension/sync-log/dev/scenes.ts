// The Sync log's scenes, each state an author looks at, as `serve` would send their rows. The entries and their writes
// are the Black Square Baron 58P's, from profiles/aircraft/bksq-baronpro.yaml, and every value and time is made up, the
// first rows after the sketch in record/areas/profiles/06-the-sync-log.md, "What an author sees". Each row's steps are
// ones the engine logs in that order, as its tests in src/engines/sync-engine/tests/engine.rs show them, so change a
// row here when the engine's sequence changes. Each value is a number or text, the two `serve` writes, so a switch
// reads 1 or 0 as it does live.

import type { Word } from "../../src/words.ts"
import type { Cause, Note, RowView, StepView } from "../src/view.ts"

/** What the log starts with: its rows, the filter's text, and the rows open, by id. */
export type Scene = { rows: RowView[]; filter?: string; open?: number[] }

/** A step as `serve` writes one: its time from the row's first, its word, what it carries, and the keys of the entries it names. */
function step(ms: number, word: Word, detail: string | null = null, also: Word | null = null, links: string[] = []): StepView {
  return { ms, word, detail, also, links }
}

const local: Cause = { kind: "local-change" }
const ana: Cause = { kind: "arrived", from: "Ana", playback: false }
const playback: Cause = { kind: "arrived", from: null, playback: true }
const catchUp: Cause = { kind: "catch-up", from: "Ana", playback: false }
const control: Cause = { kind: "control-passed" }

/**
 * Builds rows with rising ids and times, from the time of day the first one shows. A row is `open` only where it says
 * so, as `serve` says of a row still waiting on the engine.
 */
function rows(start: Date) {
  const made: RowView[] = []
  let time = start.getTime()
  const row = (later: number, entry: string, cause: Cause, value: string | null, steps: StepView[], { notes = [], open = false }: { notes?: Note[]; open?: boolean } = {}): RowView => {
    time += later
    const last = steps[steps.length - 1]!
    // A row's verdict is its latest step's word, and `landed` for the read back of its last value, as `serve` gives it.
    const verdict: Word = last.word === "read-back" && last.also === "landed" ? "landed" : last.word
    const one = { id: made.length, time, entry, cause, value, verdict, open, steps, notes }
    made.push(one)
    return one
  }
  return { made, row }
}

/** Every cause, and most of the steps the engine takes, in the order a short flight with Ana might give them. */
function busy(): RowView[] {
  const { made, row } = rows(new Date(2026, 10, 25, 14, 1, 52, 118))
  row(0, "beacon", local, "1", [step(0, "local-change", "1"), step(0, "not-sent-during-preflight")])
  row(9_266, "battery", ana, "1", [step(0, "arrived", "1"), step(0, "writes", "B('ELECTRICAL_Battery_1_Toggle')"), step(0, "pending", "1"), step(84, "read-back", "1", "landed")])
  row(3_118, "ap_vs_hold", ana, "0", [
    step(0, "arrived", "0"),
    step(0, "waits-for", "ap_altitude_hold", null, ["ap_altitude_hold"]),
    step(38, "now-reads", "0"),
    step(52, "already-matches"),
  ])
  row(8_198, "throttle_1", local, "6554", [step(0, "local-change", "6554"), step(0, "put-back", "13435"), step(0, "writes", `${THROTTLE} 13435`)])
  row(31, "throttle_1", local, "13435", [step(0, "local-change", "13435"), step(0, "matches-synced-value")])
  row(1_904, "battery", local, "0", [step(0, "local-change", "0"), step(0, "sent"), step(33, "reported-twice")])
  row(2_311, "yaw_damper", ana, "1", [
    step(0, "arrived", "1"),
    step(0, "waits-for-first-reading"),
    step(212, "first-reading", "0"),
    step(212, "writes", "K('YAW_DAMPER_TOGGLE')"),
    step(212, "pending", "1"),
    step(1_712, "never-landed", "0"),
  ])
  row(4_087, "heading_bug", playback, "270", [step(0, "arrived", "270"), step(0, "writes", "B('INSTRUMENT_Heading_Bug_Set') 270"), step(0, "pending", "270"), step(16, "replaced")])
  row(16, "heading_bug", playback, "274", [step(0, "arrived", "274"), step(0, "writes", "B('INSTRUMENT_Heading_Bug_Set') 274"), step(0, "pending", "274"), step(61, "read-back", "274", "landed")])
  // A stepping write's steps go pending one by one, which logs no `pending` of their own.
  row(2_540, "hsi_course", catchUp, "92", [
    step(0, "catch-up", "92"),
    step(0, "writes", "K('VOR1_OBI_INC')"),
    step(33, "writes", "K('VOR1_OBI_INC')"),
    step(71, "read-back", "91"),
    step(104, "read-back", "92", "landed"),
  ])
  row(0, "battery", { kind: "catch-up", from: null, playback: true }, "1", [step(0, "catch-up", "1"), step(0, "already-matches")])
  row(5_610, "flaps", local, "16384", [step(0, "local-change", "16384"), step(48, "withdrawn", null, "lost")])
  row(48, "flaps", ana, "8192", [step(0, "arrived", "8192"), step(0, "won"), step(0, "writes", "K('FLAPS_SET') 8192"), step(0, "pending", "8192"), step(122, "read-back", "8192", "landed")])
  row(3_402, "ap_master", ana, "1", [step(0, "arrived", "1"), step(0, "lost")])
  row(2_216, "transponder_ident", local, null, [step(0, "local-change"), step(0, "sent")])
  row(1_980, "gear_pump", ana, null, [step(0, "arrived"), step(0, "writes", "K('GEAR_PUMP')"), step(9, "token-used")])
  row(1_011, "go_around", ana, null, [step(0, "arrived"), step(0, "writes", "K('AUTO_THROTTLE_TO_GA')"), step(1_000, "token-expired")])
  row(3_775, "pms50_apga_running", ana, "1", [step(0, "arrived", "1"), step(0, "compared"), step(1_500, "differs", "0")])
  row(2_004, "radar_mode", ana, "2", [step(0, "arrived", "2"), step(0, "waits-for-first-reading"), step(640, "dropped-refused")])
  row(6_330, "elevator_trim", ana, "4.2", [step(0, "arrived", "4.2"), step(0, "writes", "K('ELEVATOR_TRIM_SET') 688"), step(0, "pending", "4.2"), step(1_500, "warning-skipped")])
  row(1_207, "ap_altitude", ana, "9000", [step(0, "arrived", "9000"), step(0, "function-failed", "ReferenceError: valu is not defined"), step(0, "pending", "9000"), step(1_500, "never-landed", "8500")])
  row(4_890, "cabin_climb_rate", local, "500", [step(0, "local-change", "500"), step(0, "stopped", null, "driven")])
  row(2_960, "cabin_climb_rate", ana, "700", [step(0, "arrived", "700"), step(0, "skipped-stopped")])
  // Control passing writes with no check, as a put-back does, so its row ends on the write.
  row(7_442, "mixture_1", control, "0.75", [step(0, "control-passed", "0.75"), step(0, "writes", "L('BKSQ_MixtureLeverPosition_1') 0.75")])
  row(3_130, "com1_active", local, "121500000", [step(0, "local-change", "121500000"), step(0, "sent")])
  row(5_270, "beacon", ana, "0", [step(0, "arrived", "0"), step(0, "writes", "B('LIGHTING_BEACON_1_Toggle')"), step(0, "pending", "0")], { open: true })
  return made
}

/** The left throttle's write, a variable in the sim's own unit. */
const THROTTLE = "A('GENERAL ENG THROTTLE LEVER POSITION:1', 'Position 16k')"

/**
 * Every piece of the log's copy in place, for reviewing its words: each cause, each of the engine's words, both notes,
 * and a write's actions of each kind, in rows that are all open. Each row ends on a word no other row ends on where the
 * engine allows, and a word such as `writes` or `pending` comes up again only where a row needs it to reach its own.
 */
function everyWord(): RowView[] {
  const { made, row } = rows(new Date(2026, 10, 25, 14, 1, 52, 118))
  const unnamed: Cause = { kind: "arrived", from: null, playback: false }
  const replayed: Cause = { kind: "catch-up", from: null, playback: true }
  // A text past the 4 KB an entry's value can carry, as an ATIS a profile might sync.
  const atis = "KILO 1350Z WIND 270 AT 12 VISIBILITY 10 SKY CLEAR TEMPERATURE 18 DEWPOINT 9 ALTIMETER 2992 ".repeat(48).trim()
  row(0, "beacon", local, "1", [step(0, "local-change", "1"), step(0, "not-sent-during-preflight")])
  row(9_266, "battery", ana, "1", [step(0, "arrived", "1"), step(0, "writes", "B('ELECTRICAL_Battery_1_Toggle')"), step(0, "pending", "1"), step(84, "read-back", "1", "landed")])
  row(3_118, "ap_vs_hold", ana, "0", [step(0, "arrived", "0"), step(0, "waits-for", "ap_altitude_hold", null, ["ap_altitude_hold"]), step(38, "now-reads", "0"), step(52, "already-matches")])
  row(2_311, "yaw_damper", ana, "1", [
    step(0, "arrived", "1"),
    step(0, "waits-for-first-reading"),
    step(212, "first-reading", "0"),
    step(212, "writes", "K('YAW_DAMPER_TOGGLE')"),
    step(212, "pending", "1"),
    step(1_712, "never-landed", "0"),
  ])
  row(2_004, "radar_mode", ana, "2", [step(0, "arrived", "2"), step(0, "waits-for-first-reading"), step(640, "dropped-refused")])
  row(1_207, "ap_altitude", ana, "9000", [step(0, "arrived", "9000"), step(0, "function-failed", "ReferenceError: valu is not defined"), step(0, "pending", "9000")], { open: true })
  row(6_330, "elevator_trim", ana, "4.2", [step(0, "arrived", "4.2"), step(0, "writes", "K('ELEVATOR_TRIM_SET') 688"), step(0, "pending", "4.2"), step(1_500, "warning-skipped")])
  row(1_980, "gear_pump", ana, null, [step(0, "arrived"), step(0, "writes", "K('GEAR_PUMP')"), step(9, "token-used")])
  row(1_011, "go_around", ana, null, [step(0, "arrived"), step(0, "writes", "K('AUTO_THROTTLE_TO_GA')"), step(1_000, "token-expired")])
  // An entry's `ignore` starts with a change this PC sends, and logs on that change's row.
  row(1_204, "starter_1", local, null, [step(0, "local-change"), step(0, "sent"), step(120, "ignored", "K('TOGGLE_STARTER1')")])
  row(1_406, "fuel_pump_1", local, "1", [step(0, "local-change", "1"), step(0, "sent"), step(1_000, "ignore-expired", "K('ELECT_FUEL_PUMP1_SET')")])
  row(2_120, "gear_handle", ana, null, [step(0, "arrived"), step(0, "no-value")])
  row(3_775, "pms50_apga_running", ana, "1", [step(0, "arrived", "1"), step(0, "compared"), step(1_500, "differs", "0")])
  row(1_310, "pms50_power", ana, "1", [step(0, "arrived", "1"), step(0, "compared"), step(1_500, "matches")])
  row(3_402, "ap_master", ana, "1", [step(0, "arrived", "1"), step(0, "lost")])
  row(5_610, "flaps", local, "16384", [step(0, "local-change", "16384"), step(48, "withdrawn", null, "lost")])
  row(48, "flaps", ana, "8192", [step(0, "arrived", "8192"), step(0, "won"), step(0, "writes", "K('FLAPS_SET') 8192"), step(0, "pending", "8192"), step(122, "read-back", "8192", "landed")])
  // A switch flicked off and back on before the stream sent the first: both rows end undone.
  row(2_310, "beacon", local, "0", [step(0, "local-change", "0"), step(90, "withdrawn", null, "undone")])
  row(90, "beacon", local, "1", [step(0, "local-change", "1"), step(0, "withdrawn", null, "undone")])
  row(8_198, "throttle_1", local, "6554", [step(0, "local-change", "6554"), step(0, "put-back", "13435"), step(0, "writes", `${THROTTLE} 13435`)])
  row(16, "throttle_1", local, "9830", [step(0, "local-change", "9830"), step(0, "put-back-carries-on")])
  row(15, "throttle_1", local, "13435", [step(0, "local-change", "13435"), step(0, "matches-synced-value")])
  row(1_904, "transponder_ident", local, null, [step(0, "local-change"), step(0, "sent"), step(33, "reported-twice")])
  row(2_216, "com1_active", local, "121500000", [step(0, "local-change", "121500000"), step(0, "not-sent")])
  row(1_530, "atis", local, atis, [step(0, "local-change", atis), step(0, "too-large", `${atis.length} bytes`)])
  row(4_890, "cabin_climb_rate", local, "500", [step(0, "local-change", "500"), step(0, "stopped", null, "driven")])
  row(2_960, "cabin_climb_rate", ana, "700", [step(0, "arrived", "700"), step(0, "skipped-stopped")])
  // A row stops on a limit, as it does on a function that fails to compile at its first run.
  row(1_812, "ap_heading", ana, "270", [step(0, "arrived", "270"), step(0, "stopped", "the call reached the sandbox's time limit")])
  row(4_087, "heading_bug", playback, "270", [step(0, "arrived", "270"), step(0, "writes", "L('BKSQ_HeadingBug', 'degrees') 270"), step(0, "pending", "270"), step(16, "replaced")])
  row(2_540, "com1_volume", catchUp, "7", [step(0, "catch-up", "7"), step(0, "shadow-restored", "7")])
  row(0, "battery", replayed, "1", [step(0, "catch-up", "1"), step(0, "already-matches")])
  row(7_442, "mixture_1", control, "0.75", [step(0, "control-passed", "0.75"), step(0, "writes", "L('BKSQ_MixtureLeverPosition_1') 0.75")])
  row(1_200, "pitot_heat", unnamed, "1", [step(0, "arrived", "1"), step(0, "writes", "K('PITOT_HEAT_SET', 1) 1"), step(0, "pending", "1")], { open: true })
  row(3_130, "mixture_1", local, "0.6", [step(0, "local-change", "0.6"), step(0, "sent")], { notes: [{ kind: "ran", ms: 40 }] })
  row(5_270, "beacon", ana, "0", [step(0, "arrived", "0"), step(0, "writes", "B('LIGHTING_BEACON_1_Toggle')"), step(0, "pending", "0")], { notes: [{ kind: "unloaded" }] })
  return made
}

const EVERY_WORD = everyWord()

/** The busy log with a Run's row: you ran the left mixture 40ms before its local change. */
function ran(): RowView[] {
  const log = busy()
  const last = log[log.length - 1]!
  log.push({ id: last.id + 1, time: last.time + 6_118, entry: "mixture_1", cause: local, value: "0.6", verdict: "sent", open: false, steps: [step(0, "local-change", "0.6"), step(0, "sent")], notes: [{ kind: "ran", ms: 40 }] })
  return log
}

/** The busy log after a save's reload, whose last row was still pending as the profile unloaded. */
function unloaded(): RowView[] {
  const log = busy()
  const last = log[log.length - 1]!
  // A row of a load that unloaded waits on nothing more.
  log[log.length - 1] = { ...last, open: false, notes: [{ kind: "unloaded" }] }
  log.push({ id: last.id + 1, time: last.time + 2_204, entry: "beacon", cause: local, value: "0", verdict: "sent", open: false, steps: [step(0, "local-change", "0"), step(0, "sent")], notes: [] })
  return log
}

/** The 10,000 rows `serve` keeps, nearly all of a lever moved through a reading a frame, to feel how the log scrolls. */
function full(): RowView[] {
  const { made, row } = rows(new Date(2026, 10, 25, 14, 0, 0, 0))
  for (let n = 0; n < 10_000; n++) {
    if (n % 250 === 125) row(11, "battery", ana, "1", [step(0, "arrived", "1"), step(0, "writes", "B('ELECTRICAL_Battery_1_Toggle')"), step(0, "pending", "1"), step(84, "read-back", "1", "landed")])
    else {
      const value = (0.5 + 0.4 * Math.sin(n / 40)).toFixed(3).replace(/\.?0+$/, "")
      row(11, "throttle_1", local, value, [step(0, "local-change", value), step(0, "sent")])
    }
  }
  return made
}

const BUSY = busy()

export const SCENES: Record<string, Scene> = {
  "Every word": { rows: EVERY_WORD, open: EVERY_WORD.map((one) => one.id) },
  Empty: { rows: [] },
  "A busy log": { rows: BUSY },
  "A row opened": { rows: BUSY, open: [2, 6, 9] },
  Filtered: { rows: BUSY, filter: "battery, throttle", open: [5] },
  "The Run note": { rows: ran(), open: [BUSY.length] },
  "The unloaded note": { rows: unloaded(), open: [BUSY.length - 1] },
  "Nothing for the filter": { rows: BUSY, filter: "gear crank handle" },
  "10,000 rows": { rows: full() },
}
