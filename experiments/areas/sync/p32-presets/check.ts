// p32: whether an input event's `_Set` preset takes each value from a cockpit panel, also after
// our WASM module has called it, which p31 left open (record/areas/sync/log.md, 2026-11-17).
// With the Baron 58P loaded and no core running, it calls four presets with a value, each in
// turn from a panel, through the sim's inspector, and from our module, which presets.patch has
// call a preset whenever `L:DUALINPUT_P32_GO` changes, then calls the heading bug's 20 more
// times from the panel. It writes report.txt in experiments/areas/sync/results/.
//
//   git apply experiments/areas/sync/p32-presets/presets.patch
//   node tools/build.ts install                        with the sim closed
//   node experiments/areas/sync/p32-presets/check.ts   with the 58P loaded at a stand
//   git apply -R experiments/areas/sync/p32-presets/presets.patch    after the check

import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { ROOT } from "../../../../tools/lib/repo.ts"
import { evaluate, listPages } from "../../../../tools/sim/inspector.ts"

type Preset = {
  /** Its place in presets.patch's list, which `L:DUALINPUT_P32_PRESET` picks. */
  index: number
  name: string
  /** What it sets, as `[name, unit]`. */
  read: [string, string]
  /** How far a reading may be from the value and count as it. */
  within: number
  /** Eight values, given the reading before the first. */
  values: (now: number) => number[]
}

/** The order each preset's eight values go in: twice from the panel, twice from our module, three times from the panel, and once from our module. */
const ROUTES = ["panel", "panel", "module", "module", "panel", "panel", "panel", "module"] as const

const PRESETS: Preset[] = [
  { index: 0, name: "INSTRUMENT_Heading_Bug_Set", read: ["A:AUTOPILOT HEADING LOCK DIR:1", "degrees"], within: 0.05, values: () => [90, 180, 135, 270, 315, 45, 225, 180] },
  { index: 1, name: "INSTRUMENT_Altimeter_1_Set", read: ["L:INSTRUMENT_Altimeter_1", "number"], within: 0.5, values: (now) => [1, 2, 3, 4, 5, 6, 7, 8].map((k) => Math.round(now) + 16 * k) },
  { index: 3, name: "PASSENGER_Cabin_Heat_2_Set", read: ["L:var_CabinHeatHandle", "number"], within: 0.01, values: () => [0.25, 0.75, 0.5, 1, 0, 0.4, 0.6, 0.8] },
  { index: 2, name: "LANDING_GEAR_ParkingBrake_Set", read: ["A:BRAKE PARKING POSITION", "bool"], within: 0, values: (now) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (now + 1 + k) % 2) },
]

const report: string[] = []
function say(line: string): void {
  console.log(line)
  report.push(line)
}

async function panel<T>(expression: string): Promise<T> {
  const pages = (await listPages()).filter((p) => /^VCockpit/i.test(p.title))
  let last: unknown = new Error("no cockpit panel answers on the inspector")
  for (const page of pages) {
    try {
      return await evaluate<T>(page, expression)
    } catch (error) {
      last = error
    }
  }
  throw last
}
const read = async (name: string, unit: string) => Number(await panel<number>(`SimVar.GetSimVarValue(${JSON.stringify(name)}, ${JSON.stringify(unit)})`))
const set = (name: string, value: number) => panel(`SimVar.SetSimVarValue(${JSON.stringify(name)}, "number", ${value}); 0`)

let go = 0

/**
 * Calls `preset` with `value` from our module, through `fsVarsBVarCall`, or as calculator code
 * when `code`, and waits up to 1s for the module to say it has.
 */
async function fromModule(preset: Preset, value: number, code: boolean): Promise<void> {
  go = (await read("L:DUALINPUT_P32_GO", "number")) + 1
  await set("L:DUALINPUT_P32_ROUTE", code ? 1 : 0)
  await set("L:DUALINPUT_P32_PRESET", preset.index)
  await set("L:DUALINPUT_P32_VALUE", value)
  await set("L:DUALINPUT_P32_GO", go)
  const started = Date.now()
  while (Date.now() - started < 1_000 && (await read("L:DUALINPUT_P32_DONE", "number")) !== go) await sleep(20)
}

/** Sends `value` through `route` and reads until it holds, for up to 1.5s. */
async function write(preset: Preset, route: "panel" | "module" | "code", value: number): Promise<boolean> {
  const started = Date.now()
  if (route === "panel") await set(`B:${preset.name}`, value)
  else await fromModule(preset, value, route === "code")
  let got = NaN
  while (Date.now() - started < 1_500) {
    got = await read(...preset.read)
    if (Math.abs(got - value) <= preset.within) break
    await sleep(25)
  }
  const landed = Math.abs(got - value) <= preset.within
  const from = { panel: "a panel", module: "our module's fsVarsBVarCall", code: "our module's calculator code" }[route]
  say(`${landed ? "landed" : "MISSED"}: ${preset.name} ${value} from ${from}: reads ${Number(got.toFixed(3))}${landed ? ` after ${Date.now() - started}ms` : " after 1.5s"}`)
  return landed
}

const title = await panel<string>(`SimVar.GetSimVarValue("TITLE", "string")`)
const second = process.argv.includes("--second")
say(`p32${second ? ", second run" : ""} on ${new Date().toISOString()}, in ${title}`)
if (!second) {
  for (const preset of PRESETS) {
    say(`\n=== ${preset.name}`)
    const values = preset.values(await read(...preset.read))
    for (const [i, value] of values.entries()) await write(preset, ROUTES[i]!, value)
  }
  say("\n=== INSTRUMENT_Heading_Bug_Set from a panel, 20 more times")
  const bug = PRESETS[0]!
  let landed = 0
  for (let i = 0; i < 20; i++) if (await write(bug, "panel", ((i * 7 + 3) % 8) * 45)) landed++
  say(`\n${landed} of 20 landed`)
} else {
  // In a flight loaded again: calculator code from our module, alone and beside a panel's calls,
  // 20 of a panel's calls with no call from our module, and calculator code after our module's
  // `fsVarsBVarCall`.
  const bug = PRESETS[0]!
  const handle: Preset = { index: 6, name: "PASSENGER_Cabin_Heat_3_Set", read: ["L:var_PilotAirHandle", "number"], within: 0.01, values: () => [] }
  const altimeter1 = PRESETS[1]!
  const altimeter2: Preset = { index: 5, name: "INSTRUMENT_Altimeter_2_Set", read: ["L:INSTRUMENT_Altimeter_2", "number"], within: 0.5, values: () => [] }
  const runs: [Preset, ("panel" | "module" | "code")[], number[] | ((now: number) => number[])][] = [
    [bug, ["code", "code", "code", "code", "code", "code", "code", "code"], [90, 180, 135, 270, 315, 45, 225, 180]],
    [handle, ["code", "code", "panel", "panel", "code", "panel", "code", "panel"], [0.25, 0.75, 0.5, 1, 0, 0.4, 0.6, 0.8]],
    [altimeter1, Array(20).fill("panel"), (now) => Array.from({ length: 20 }, (_, k) => Math.round(now) + 16 * (k % 2 === 0 ? k + 1 : -(k + 1)))],
    [altimeter2, ["module", "code", "code", "panel"], (now) => [1, 2, 3, 4].map((k) => Math.round(now) + 16 * k)],
  ]
  for (const [preset, routes, values] of runs) {
    say(`\n=== ${preset.name}`)
    const list = typeof values === "function" ? values(await read(...preset.read)) : values
    let landed = 0
    for (const [i, value] of list.entries()) if (await write(preset, routes[i]!, value)) landed++
    say(`${landed} of ${list.length} landed`)
  }
}

const out = path.join(ROOT, "experiments", "areas", "sync", "results", `p32-presets-${new Date().toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "-")}.txt`)
fs.writeFileSync(out, `${report.join("\n")}\n`)
console.log(`\nwrote ${out}`)
