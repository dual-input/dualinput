/*
 * p02: how SimConnect hands K: events back to the client that sent them, when
 * the client also listens for them, on MSFS 2024.
 *
 * The harness sends K: events and listens for the same events, to see whether
 * an aircraft masks them and to tell its own sends from the aircraft's. Its
 * first run heard nothing on a subscription whose client event IDs differed
 * from the sending ID, and a send failed with ERROR after its event was
 * removed from a group (experiments/areas/aircraft/results/
 * run-a2a-pa24-comanche-2026-10-01-18-03-55.txt). This asks, with
 * K:COM_STBY_RADIO_SET_HZ on whatever aircraft is loaded:
 *
 *   A  does sending the same client event ID again fail, EX1 or legacy?
 *   B  does a group holding a second ID mapped to the same sim event hear a
 *      send through the first ID, and under which ID?
 *   C  with the sending ID itself in a second group, which ID does each group
 *      hear the event under?
 *   D  does a group at priority 1 hear a send at priority 1,900,000,000?
 *   E  after removeClientEvent on one ID, does a send through another fail?
 *
 *   node experiments/areas/aircraft/p02-key-event-ids.mjs
 *
 * It changes COM 1's standby frequency, and puts it back at the end.
 */

import { EventFlag, SimConnectConstants } from "node-simconnect"

import { Recorder, sleep } from "./lib/out.mjs"
import { Sim } from "./lib/sim.mjs"

const USER = SimConnectConstants.OBJECT_ID_USER
const PRIO = EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY
const EVENT = "COM_STBY_RADIO_SET_HZ"
const rec = new Recorder("p02-key-event-ids")
const sim = await Sim.connect(rec, { name: "CROSSCHECK p02-key-event-ids" })
rec.open()
const h = sim.handle
const got = []
const take = (label) => { const out = got.splice(0); rec.log("heard", `${label}: ${out.length ? out.map((g) => `${g.kind} id ${g.id} group ${g.group} value ${g.value}`).join("; ") : "nothing"}`, { label, heard: out }); return out }
h.on("event", (e) => { if (e.clientEventId >= 5000) got.push({ kind: "event", id: e.clientEventId, group: e.groupID, value: e.data }) })
h.on("eventEx1", (e) => { if (e.clientEventId >= 5000) got.push({ kind: "ex1", id: e.clientEventId, group: e.groupID, value: e.data[0], data: e.data }) })
const before = await sim.readOne("COM STANDBY FREQUENCY:1", "Hz")
rec.log("start", `COM STANDBY FREQUENCY:1 reads ${before}`)

const tx = (label, id, hz, { legacy = false, priority = 1 } = {}) =>
  sim.send(label, () => legacy ? h.transmitClientEvent(USER, id, hz, priority, PRIO) : h.transmitClientEventEx(USER, id, priority, PRIO, hz, 0, 0, 0, 0))

// A
sim.send("map 5001", () => h.mapClientEventToSimEvent(5001, EVENT))
tx("A: 5001 EX1 first", 5001, 122_800_000); await sleep(500)
tx("A: 5001 EX1 again", 5001, 122_900_000); await sleep(500)
tx("A: 5001 legacy", 5001, 123_000_000, { legacy: true }); await sleep(500)
tx("A: 5001 legacy again", 5001, 123_100_000, { legacy: true }); await sleep(500)
rec.log("read", `A: COM STANDBY FREQUENCY:1 reads ${await sim.readOne("COM STANDBY FREQUENCY:1", "Hz")}, expected 123100000`)

// B
sim.send("map 5002", () => h.mapClientEventToSimEvent(5002, EVENT))
sim.send("add 5002 to group 70", () => h.addClientEventToNotificationGroup(70, 5002, false))
sim.send("group 70 priority 1", () => h.setNotificationGroupPriority(70, 1))
await sleep(300)
tx("B: 5001 EX1, 5002 in group 70", 5001, 123_400_000); await sleep(500); take("B EX1")
tx("B: 5001 legacy, 5002 in group 70", 5001, 123_500_000, { legacy: true }); await sleep(500); take("B legacy")

// C
sim.send("map 5003", () => h.mapClientEventToSimEvent(5003, EVENT))
sim.send("add 5003 to group 71", () => h.addClientEventToNotificationGroup(71, 5003, false))
sim.send("group 71 priority 1", () => h.setNotificationGroupPriority(71, 1))
await sleep(300)
tx("C: 5003 EX1, in group 71", 5003, 123_600_000); await sleep(500); take("C EX1 through 5003")
tx("C: 5001 EX1", 5001, 123_700_000); await sleep(500); take("C EX1 through 5001")

// D
tx("D: 5001 EX1 at priority 1900000000", 5001, 123_900_000, { priority: 1_900_000_000 }); await sleep(500); take("D")

// E
sim.send("E: remove 5002 from group 70", () => h.removeClientEvent(70, 5002)); await sleep(300)
tx("E: 5001 EX1 after the removal", 5001, 124_000_000); await sleep(500); take("E through 5001")
tx("E: 5003 EX1 after the removal", 5003, 124_100_000); await sleep(500); take("E through 5003")
rec.log("read", `E: COM STANDBY FREQUENCY:1 reads ${await sim.readOne("COM STANDBY FREQUENCY:1", "Hz")}, expected 124100000`)

if (Number.isFinite(before)) tx("put COM 1 standby back", 5001, before)
await sleep(500)
const exceptions = rec.timeline.filter((e) => e.kind === "exception").map((e) => `${e.name} on ${e.sent}`)
const lines = rec.timeline.filter((e) => ["start", "heard", "read"].includes(e.kind)).map((e) => e.text)
const report = [
  "p02 · K: event IDs, groups, and echoes on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}`,
  ...lines,
  `Exceptions: ${exceptions.join("; ") || "none"}`,
].join("\n")
console.log("\n" + report)
rec.writeReport(report)
sim.close()
await rec.close()
process.exit(0)
