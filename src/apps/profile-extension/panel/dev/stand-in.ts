// The panel's scenes, each state an author looks at, and a stand-in for the extension that answers the panel's calls as
// `serve` and `authoring` would: a value typed gets its preview, a Run moves the live value, and the picker's rows move
// and tick. The entries are the Black Square Baron 58P's, from profiles/aircraft/bksq-baronpro.yaml, except the counting
// entry, which is hypothetical since that profile has none, and every reading is made up.

import type { Action, DisplayRow, PanelHost, PanelView, PickerGroup, PickerView, Preview, RunView, Status } from "../src/view.ts"

export type Scene = Omit<PanelView, "palette">

const BARON = "Black Square Baron 58P Professional"
const flying: Status = { kind: "in-flight", aircraft: BARON, runs: true, crew: false }
const withJames: Status = { ...flying, crew: true }
const nothing: Scene = { status: flying, unpinned: false, body: { kind: "nothing" } }

const act = (does: Action["does"], name: string, values: string[] = [], times = 1, apart: string | null = null): Action => ({ does, name, values, times, apart })
const sends = (...actions: Action[]): Preview => ({ kind: "sends", actions })
const waiting: Preview = { kind: "waiting" }
const number = (text: string) => (text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : null)

/** A plain write to one variable, as `write: L('var_FrictionLock')` gives. */
const setsTo = (name: string) => (text: string) => (text.trim() ? sends(act("set", name, [text.trim()])) : waiting)

/** Steps of 100 from the reading, as the 58P's armed vertical speed function counts them, with its knob pulled. */
function kasSteps(from: number) {
  return (text: string): Preview => {
    const to = number(text)
    if (to === null) return waiting
    const steps = Math.round((to - from) / 100)
    if (steps === 0) return sends()
    return sends(act("fire", steps > 0 ? "H:kas297b_100_INC" : "H:kas297b_100_DEC", [], Math.abs(steps), "1 frame"))
  }
}

/** Each entry a Run scene opens on, with what its write sends for a value, as the sync engine's `plan` would give it. */
const PLANS: Record<string, (text: string) => Preview> = {
  prop_sync: setsTo("L:var_PropSyncSwitch"),
  friction_lock: setsTo("L:var_FrictionLock"),
  mixture_1: setsTo("L:BKSQ_MixtureLeverPosition_1"),
  ignition_1: (text) => {
    const value = text.trim()
    if (!value) return waiting
    return value === "4" ? sends(act("set", "L:starterKnobReturnTime_L", ["1000000000"]), act("set", "L:BKSQ_IgnitionPosition_1", ["4"])) : sends(act("set", "L:BKSQ_IgnitionPosition_1", [value]))
  },
  kas_armed_vs: kasSteps(1200),
  gear_pump: (text) => sends(act("fire", "K:GEAR_PUMP", text.trim() ? [text.trim()] : [])),
  kas_vs_knob: (text) => {
    const steps = /^[+-]?\d+$/.test(text.trim()) ? Number(text.trim()) : null
    if (steps === null) return waiting
    if (steps === 0) return sends()
    return sends(act("fire", steps > 0 ? "H:kas297b_100_INC" : "H:kas297b_100_DEC", [], Math.abs(steps), "1 frame"))
  },
}

/** A scene of Run on one entry, in a flight alone unless `status` says otherwise. */
function entry({ status = flying, ...run }: Omit<RunView, "preview" | "refused" | "revert"> & Partial<RunView> & { status?: Status }): Scene {
  return { status, unpinned: false, body: { kind: "run", run: { preview: PLANS[run.key]!(run.field), refused: null, revert: null, ...run } } }
}

const SWITCH = entry({ name: "Prop sync", key: "prop_sync", takes: "value", live: [{ of: null, value: "0" }], field: "", seen: ["0", "1"] })
const LEVER = entry({ name: "Left mixture", key: "mixture_1", takes: "value", live: [{ of: null, value: "0.82" }], field: "0.5", seen: "many" })
const IGNITION = entry({ name: "Left ignition", key: "ignition_1", takes: "value", live: [{ of: null, value: "3" }], field: "4", seen: ["0", "1", "2", "3", "4"] })

const row = (key: string, rest: Partial<DisplayRow> = {}): PickerGroup => ({ kind: "single", row: { key, fullKey: key, panels: 1, ticked: false, refused: null, ...rest } })
const shared = (identifier: string, keys: string[], ticked: string[] = []): PickerGroup => ({
  kind: "shared",
  identifier,
  rows: keys.map((key) => ({ key, fullKey: key, panels: 1, ticked: ticked.includes(key), refused: null })),
})

/**
 * The 58P's cockpit panels as their `hello`s name them, by identifier (record/areas/core/results/2026-10-22-stage-5-session.txt),
 * with `BlackSquareTablet` already in `displays`. The 58P holds no identifier that several instruments share, so its
 * `WTT1` and `WTT2`, and `KX155B_1` and `KX155B_2`, are written here as the hypothetical shared `WTT` and `KX155B`, and of
 * its two WASM instruments one is left out.
 */
const PANELS: PickerGroup[] = [
  row("AS330"),
  row("bksq_wradar1"),
  row("BlackSquareTablet", { ticked: true }),
  row("EDM760_1"),
  row("GNS_DISABLED", { panels: 2 }),
  row("GTN650_INT_2"),
  row("GTN750_INT"),
  row("KAS297B_1", { fullKey: "KAS297B_1|Index=1" }),
  row("KDI572R"),
  row("KLN90B"),
  row("KNS81_1"),
  row("KR87A"),
  shared("KX155B", ["KX155B|Index=1", "KX155B|Index=2"], ["KX155B|Index=1"]),
  row("WasmInstrument", { fullKey: "WasmInstrument|wasm_module=Gauge/TDSGTNXiGaugeModule.wasm&wasm_gauge=GTNXI750U1", refused: "wasm-instrument" }),
  row("WeatherSquare4000_int"),
  shared("WTT", ["WTT|side=1", "WTT|side=2"]),
]

/** Each state an author looks at, by name, in the order the dev page lists them. */
export const SCENES: Record<string, Scene> = {
  "Not running": { ...nothing, status: { kind: "not-running" } },
  "No session": { ...nothing, status: { kind: "no-session" } },
  "In a session, not in its flight": { ...nothing, status: { kind: "not-in-flight" } },
  "In a flight": nothing,
  "In a flight, mismatching aircraft": { ...nothing, status: { kind: "in-flight", aircraft: "Fenix A320", runs: false, crew: false } },
  "Dual Input of an older release": { ...nothing, status: { kind: "other-release", extension: "0.4.0", dualInput: "0.3.2", update: "dual-input" } },
  "Extension of an older release": { ...nothing, status: { kind: "other-release", extension: "0.3.2", dualInput: "0.4.0", update: "extension" } },
  "Another window has the sim": { ...nothing, status: { kind: "other-window" } },
  "Unsaved edits, with a crew": { ...IGNITION, status: withJames, unpinned: true },
  "Unsaved edits, alone": { ...IGNITION, unpinned: true },
  "Run, a switch": SWITCH,
  "Run, a lever": LEVER,
  "Run, a write function": IGNITION,
  "Run, a chain": entry({ name: "Armed vertical speed", key: "kas_armed_vs", takes: "value", live: [{ of: null, value: "1200" }], field: "1500", seen: "many" }),
  "Run, an event": entry({ name: "Gear crank pump", key: "gear_pump", takes: "event", live: [{ of: null, value: "×3" }], field: "", seen: [] }),
  "Run, a counting entry": entry({ name: "Vertical speed knob", key: "kas_vs_knob", takes: "steps", live: [{ of: "inc", value: "×4" }, { of: "dec", value: "×1" }], field: "+3", seen: [] }),
  "Run, put back": entry({ name: "Friction lock", key: "friction_lock", takes: "value", live: [{ of: null, value: "0" }], field: "1", seen: ["0", "1"], revert: { to: "0", afterMs: 120 } }),
  "Run, pilot flying only": entry({ status: withJames, name: "Left mixture", key: "mixture_1", takes: "value", live: [{ of: null, value: "0.82" }], field: "0.5", seen: "many", refused: { kind: "pilot-flying-only", pilotFlying: "James" } }),
  "Run, doesn't build": entry({ name: "Left ignition", key: "ignition_1", takes: "value", live: [{ of: null, value: "3" }], field: "4", seen: ["0", "1", "2", "3", "4"], preview: { kind: "error", message: "Cannot find name 'valu'. Did you mean 'value'?", where: "bksq-baronpro.yaml:270:45" } }),
  "Pick displays": { ...nothing, body: { kind: "picker", picker: { groups: PANELS, active: "KX155B|Index=1" } } },
}

/** How long the 58P's stand-in takes to put a variable back after a Run of the scene that shows it. */
const PUTS_BACK_MS = 120

/** The stand-in for the extension: `view` reads the panel's view as it stands, `show` replaces it, and `heard` names each call. */
export function standIn(view: () => Scene, show: (next: Scene) => void, heard: (call: string) => void): PanelHost {
  const withRun = (change: (run: RunView) => Partial<RunView>) => {
    const { body } = view()
    if (body.kind === "run") show({ ...view(), body: { kind: "run", run: { ...body.run, ...change(body.run) } } })
  }
  const withPicker = (change: (picker: PickerView) => Partial<PickerView>) => {
    const { body } = view()
    if (body.kind === "picker") show({ ...view(), body: { kind: "picker", picker: { ...body.picker, ...change(body.picker) } } })
  }
  return {
    typed(text) {
      heard(`typed(${JSON.stringify(text)})`)
      withRun((run) => ({ field: text, preview: run.preview.kind === "error" ? run.preview : (PLANS[run.key]?.(text) ?? waiting) }))
    },
    run(text) {
      heard(`run(${JSON.stringify(text)})`)
      const value = text.trim()
      withRun((run) => {
        if (run.takes === "event") return { live: run.live.map((one) => ({ ...one, value: `×${Number(one.value.slice(1)) + 1}`, ...(value ? { carried: value } : {}) })), revert: null }
        if (run.takes === "steps") {
          const steps = Number(value)
          const of = steps > 0 ? "inc" : "dec"
          return { live: run.live.map((one) => (one.of === of ? { ...one, value: `×${Number(one.value.slice(1)) + Math.abs(steps)}` } : one)), revert: null }
        }
        const seen = run.seen === "many" || run.seen.includes(value) ? run.seen : [...run.seen, value].sort((a, b) => Number(a) - Number(b))
        return { live: [{ of: null, value }], seen: seen !== "many" && seen.length > 8 ? "many" : seen, revert: null }
      })
      const { body } = view()
      if (body.kind === "run" && body.run.key === "friction_lock") {
        const before = SCENES["Run, put back"]!.body
        const to = before.kind === "run" ? before.run.live[0]!.value : "0"
        window.setTimeout(() => withRun(() => ({ live: [{ of: null, value: to }], revert: { to, afterMs: PUTS_BACK_MS } })), PUTS_BACK_MS)
      }
    },
    move(id) {
      heard(`move(${JSON.stringify(id)})`)
      withPicker(() => ({ active: id }))
    },
    tick(id) {
      heard(`tick(${JSON.stringify(id)})`)
      withPicker((picker) => ({ groups: picker.groups.map((group) => tickIn(group, id)) }))
    },
    reveal(where) {
      heard(`reveal(${JSON.stringify(where)})`)
    },
    write() {
      const { body } = view()
      const written = body.kind === "picker" ? body.picker.groups.flatMap(writes) : []
      heard(`write(), displays: ${written.join(", ") || "none"}`)
      show({ ...view(), body: { kind: "nothing" } })
    },
    leave() {
      heard("leave()")
      show({ ...view(), body: { kind: "nothing" } })
    },
  }
}

/** What a group puts in `displays`: its ticked rows' keys, or a shared identifier alone once every key under it is ticked. */
function writes(group: PickerGroup): string[] {
  if (group.kind === "single") return group.row.ticked ? [group.row.key] : []
  const open = group.rows.filter((one) => !one.refused)
  if (open.length && open.every((one) => one.ticked)) return [group.identifier]
  return open.filter((one) => one.ticked).map((one) => one.key)
}

/** A group with `id` ticked or unticked: a row on its own, or under a heading every row the heading holds but a refused one. */
function tickIn(group: PickerGroup, id: string): PickerGroup {
  const flip = (one: DisplayRow) => (one.key === id && !one.refused ? { ...one, ticked: !one.ticked } : one)
  if (group.kind === "single") return { ...group, row: flip(group.row) }
  if (group.identifier !== id) return { ...group, rows: group.rows.map(flip) }
  const open = group.rows.filter((one) => !one.refused)
  const all = open.every((one) => one.ticked)
  return { ...group, rows: group.rows.map((one) => (one.refused ? one : { ...one, ticked: !all })) }
}
