/*
 * p01: what SimConnect_Text shows the pilot in MSFS 2024, as a candidate for
 * Crosscheck's notification banner, and whether its menu type can carry a choice
 * such as "Disconnect and take control".
 *
 * The banner must show notices whether or not the EFB is open, in VR as on a
 * monitor (record/areas/product/03-v1-scope.md, Notification banner);
 * SimConnect_Text is one of its two candidates there. SimConnect.h defines its
 * types: SCROLL_* (0 to 7), PRINT_* (0x100 to 0x107), and MENU (0x200), and its
 * results: MENU_SELECT_1 to _10, then DISPLAYED (0x10000), QUEUED, REMOVED,
 * REPLACED, and TIMEOUT (read in MSFS 2024 SDK 1.7.3, SimConnect.h). A menu's
 * text is a title, a prompt, and the choices, separated by null characters.
 *
 * Three phases, each opened by a short high beep and closed by a long low one:
 *
 *   1  PRINT_WHITE for 6s   "Crosscheck · James is in the pause menu"
 *   2  SCROLL_YELLOW for 8s "Crosscheck · You've lost the connection. Crosscheck keeps trying."
 *   3  MENU for 15s         two choices; pick one, with the mouse or the number keys
 *
 * About 40s, in a flight. Tell us afterward what each phase looked like and
 * where it sat on the screen; the console logs the result events.
 *
 *   node experiments/areas/interface/p01-simconnect-text.mjs
 *
 * Output: experiments/areas/interface/results/p01-simconnect-text-<time>.txt
 * with the .ndjson beside it.
 */

import { startBeeper } from "../../tools/guide.mjs"
import { Recorder, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"

const TYPES = { PRINT_WHITE: 0x101, SCROLL_YELLOW: 5, MENU: 0x200 }
const RESULTS = { 0x10000: "DISPLAYED", 0x10001: "QUEUED", 0x10002: "REMOVED", 0x10003: "REPLACED", 0x10004: "TIMEOUT" }
const resultName = (v) => RESULTS[v] ?? (v >= 0 && v < 10 ? `MENU_SELECT_${v + 1}` : `result ${v}`)
const PHASES = [
  { id: 9101, type: "PRINT_WHITE", seconds: 6, text: "Crosscheck · James is in the pause menu" },
  { id: 9102, type: "SCROLL_YELLOW", seconds: 8, text: "Crosscheck · You've lost the connection. Crosscheck keeps trying." },
  { id: 9103, type: "MENU", seconds: 15, text: ["Crosscheck", "You've lost the connection to James.", "Keep trying", "Disconnect and take control"].join("\0") },
]

const rec = new Recorder("p01-simconnect-text", { area: "interface" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p01-simconnect-text" })
rec.open()
const beep = startBeeper()
const lines = []
const note = (kind, text, data) => { rec.log(kind, text, data); lines.push(text) }

const results = new Map(PHASES.map((p) => [p.id, []]))
const t0 = Date.now()
sim.handle.on("event", (e) => {
  if (!results.has(e.clientEventId)) return
  const r = `${resultName(e.data)} at ${((Date.now() - t0) / 1000).toFixed(1)}s`
  results.get(e.clientEventId).push(r)
  rec.log("result", `${PHASES.find((p) => p.id === e.clientEventId).type}: ${r}`, { id: e.clientEventId, data: e.data })
})

for (const p of PHASES) {
  beep(1000, 150)
  sim.send(`text ${p.type}`, () => sim.handle.text(TYPES[p.type], p.seconds, p.id, p.text))
  await sleep(p.seconds * 1000 + 1000)
  beep(500, 600)
  note("phase", `${p.type} for ${p.seconds}s: results ${results.get(p.id).join(", ") || "none"}`)
  await sleep(1500)
}

const text = [
  "p01 · What SimConnect_Text shows the pilot, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines,
  "",
  `Exceptions: ${rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text).join("; ") || "none"}`,
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
