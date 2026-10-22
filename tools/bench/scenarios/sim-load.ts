// A flight load, played from the signals p08's client heard around one in MSFS 2024, raises
// one Loading, one Ready to fly, and one Flying, with the PA-24's folder and preset, and the
// main menu's two `AircraftLoaded` before it raise nothing; the core reads the loaded flight
// file's `[Departure]` (record/areas/core/03-sim-seam-and-wasm-module.md, "Cases for the
// bench"; record/areas/architecture/02-code-map.md, "Cases for the bench").

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import type { Played } from "../../../src/engines/messages/ts/bench/Played.ts"
import { BenchRun } from "../cores.ts"

// SimConnect's numbers for the flow events, in SDK 1.8.1's SimConnect.h.
const FLT_LOAD = 1
const FLT_LOADED = 2
const TELEPORT_START = 3
const TELEPORT_DONE = 4
const RTC_START = 10
const RTC_END = 11
const FLIGHT_START = 14

/** The path p08's client heard in each `AircraftLoaded`, with the home folder already hidden. */
const PA24 =
  "%APPDATA%\\microsoft flight simulator 2024\\packages\\community\\a2a-aircraft-pa24\\simobjects\\airplanes\\pa24-250\\presets\\a2a\\pa24-250\\config\\aircraft.cfg"

/**
 * p08's signals, in their order, from experiments/areas/architecture/results/
 * p08-flight-2026-10-09-17-12-31.ndjson, which the core log's 2026-10-15 entry on
 * `AircraftLoaded` tabulates, with the gaps cut to tens of ms so the scenario runs quickly.
 * The flight file is one the scenario writes.
 */
function p08(flight: string): Played[] {
  const flow = (event: number): Played => ({ after_ms: 20, signal: { signal: "flow", event } })
  return [
    flow(TELEPORT_START),
    flow(TELEPORT_DONE),
    { after_ms: 50, signal: { signal: "aircraft-loaded", path: PA24 } },
    flow(TELEPORT_START),
    flow(TELEPORT_DONE),
    { after_ms: 50, signal: { signal: "aircraft-loaded", path: PA24 } },
    { after_ms: 50, signal: { signal: "flight-loaded", path: flight } },
    flow(FLT_LOAD),
    flow(FLT_LOADED),
    flow(FLT_LOAD),
    flow(FLT_LOADED),
    flow(TELEPORT_START),
    flow(TELEPORT_DONE),
    { after_ms: 50, signal: { signal: "aircraft-loaded", path: PA24 } },
    flow(FLIGHT_START),
    flow(FLT_LOAD),
    flow(FLT_LOADED),
    flow(RTC_START),
    { after_ms: 200, signal: { signal: "flow", event: RTC_END } },
  ]
}

test("p08's flight load raises one Loading, one Ready to fly, and one Flying, with the PA-24", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("sim-load", t)
  // The section as the sim wrote it on our development machine, in CustomFlight.FLT.
  const flight = path.join(run.folder, "CustomFlight.FLT")
  fs.writeFileSync(flight, "[Departure]\r\nICAO=EGBB\r\nGateName=GATE\r\nGateNumber=58\r\nGateSuffix=NONE\r\n\r\n[Panels]\r\nPanel.On=True\r\n")
  const core = await run.core("a")
  const sim = run.stub()
  core.act({ act: "watch", process: sim.id })
  await core.hear("stage Starting aircraft none")
  const heard = core.heard().length
  core.act({ act: "play", signals: p08(flight) })
  await core.hear("stage Flying aircraft pa24-250/presets/a2a/pa24-250", { after: heard })
  await core.hear("departure EGBB GATE 58", { after: heard })
  const stages = core.heard().slice(heard).filter((what) => what.startsWith("stage "))
  assert.deepEqual(stages, [
    "stage Loading aircraft none",
    "stage ReadyToFly aircraft pa24-250/presets/a2a/pa24-250",
    "stage Flying aircraft pa24-250/presets/a2a/pa24-250",
  ])
})
