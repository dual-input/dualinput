/*
 * p04: what path does the sim's AircraftLoaded state name for the loaded aircraft? Stage 4's
 * core turned the Black Square Baron 58P's into `bksq-aircraft-baronpropress`, where sim
 * awareness keeps what follows `simobjects/airplanes/`, so this prints the sim's own path.
 *
 *   node experiments/areas/core/p04-aircraft-loaded.mjs
 */

import { Protocol, open } from "node-simconnect"

const { handle } = await open("CROSSCHECK p04 aircraft loaded", Protocol.SunRise)
handle.on("systemState", (s) => {
  console.log(`AircraftLoaded: ${s.dataString}`)
  handle.close()
  process.exit(0)
})
handle.on("exception", (e) => console.log(`exception ${e.exception}`))
handle.requestSystemState(1, "AircraftLoaded")
setTimeout(() => process.exit(1), 5_000)
