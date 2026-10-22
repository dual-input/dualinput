/*
 * p05: what does the sim send as the pilot ends a flight from the pause menu? Stage 4's core
 * went from Flying straight to Loading across a pause menu's "end flight", where sim
 * awareness enters Menu on the flow event BACK_TO_MAIN_MENU, which the sim sent 4s after
 * the prompt to leave a flight (measured on MSFS 2024, 2026-10-08, record/areas/interface/
 * log.md). This prints every flow event and every system event the core subscribes to, with
 * seconds from its start, until Ctrl-C.
 *
 *   node experiments/areas/core/p05-leaving-a-flight.mjs
 */

import { FlowEvent, Protocol, open } from "node-simconnect"

const SYSTEM = ["AircraftLoaded", "FlightLoaded", "Pause_EX1"]
const started = Date.now()
const at = () => ((Date.now() - started) / 1000).toFixed(1).padStart(7)

const { handle } = await open("CROSSCHECK p05 leaving a flight", Protocol.SunRise)
console.log(`${at()}s  connected; end the flight from the pause menu, then load the next`)
handle.on("flowEvent", (e) => console.log(`${at()}s  flow ${FlowEvent[e.flowEventID] ?? e.flowEventID}${e.fltPath ? ` ${e.fltPath}` : ""}`))
handle.on("eventFilename", (e) => console.log(`${at()}s  ${SYSTEM[e.clientEventId - 1]} ${e.fileName}`))
handle.on("event", (e) => console.log(`${at()}s  ${SYSTEM[e.clientEventId - 1] ?? e.clientEventId} ${e.data}`))
handle.on("exception", (e) => console.log(`${at()}s  exception ${e.exception}`))
SYSTEM.forEach((name, i) => handle.subscribeToSystemEvent(i + 1, name))
handle.subscribeToFlowEvent()
process.on("SIGINT", () => {
  handle.close()
  process.exit(0)
})
