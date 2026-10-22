/*
 * p03: does our WASM module write its status slot, DUALINPUT_MODULE_STATUS, in a sim that's
 * up? Stage 4's core asked for the slot at its connection's S_OK, 55s before the sim's open
 * reply, and heard nothing. This asks once the sim is up, the way p08's client read its
 * module's slot, and prints each write it hears for 6s: the module's counter, its slots
 * hash, and its version (engines/messages/src/module.rs, ModuleStatus). It also asks once,
 * which answers even when nothing writes, and prints every exception.
 *
 *   node experiments/areas/core/p03-module-status.mjs
 */

import { ClientDataPeriod, Protocol, open } from "node-simconnect"

const AREA = 1
const DEFINITION = 1
const SIZE = 32

const { recvOpen, handle } = await open("CROSSCHECK p03 module status", Protocol.SunRise)
console.log(`connected to ${recvOpen.applicationName}`)

function status(d) {
  const bytes = d.data.readBytes(Math.min(SIZE, d.data.remaining()))
  const counter = bytes.readBigUInt64LE(0)
  const hash = bytes.readBigUInt64LE(8).toString(16).padStart(16, "0")
  const version = bytes.subarray(16, 32).toString("utf8").replace(/\0+$/, "")
  return `counter ${counter}, slots hash ${hash}, version ${version}`
}

handle.on("exception", (e) => console.log(`exception ${e.exception} for send ${e.sendId}, index ${e.index}`))
handle.on("clientData", (d) => console.log(`${d.requestID === 1 ? "once" : "on set"}: ${status(d)}`))

handle.mapClientDataNameToID("DUALINPUT_MODULE_STATUS", AREA)
handle.addToClientDataDefinition(DEFINITION, 0, SIZE)
handle.requestClientData(AREA, 1, DEFINITION, ClientDataPeriod.ONCE, 0)
handle.requestClientData(AREA, 2, DEFINITION, ClientDataPeriod.ON_SET, 0)

setTimeout(() => {
  handle.close()
  process.exit(0)
}, 6_000)
