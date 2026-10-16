/*
 * p02: whether code can turn the sim's active pause on and off, on MSFS 2024,
 * and from where.
 *
 * Crosscheck v1 syncs active pause from any pilot (record/areas/product/
 * 03-v1-scope.md), so a following machine's core has to set it. p01 found that
 * K:PAUSE_SET raises the full pause, which stops SimConnect's frame data, and
 * tried nothing else (record/areas/environment/log.md). Two leads:
 *
 *   - The SDK lists active pause only as the input action
 *     KEY_ACTIVE_PAUSE_TOGGLE, in context INGAME_UI (MSFS 2024 SDK,
 *     Tools/Setup_InputProfiles/action.actiondb), and not among the key events
 *     in WASM/include/MSFS/Types/MSFS_EventsEnum.h.
 *   - The sim's toolbar sets it with Coherent.call("TOOLBAR_SET_ACTIVE_PAUSE",
 *     on) (read in fs-base-ui, html_ui/JS/Services/ToolBarPanels.js,
 *     setActivePause). Whether other documents may make that call is unknown:
 *     the EFB's document refused the world map's requestData as "not bound"
 *     (record/areas/interface/log.md, 2026-10-06).
 *
 * About 90s, in a flight in any aircraft, parked and unpaused, with nobody
 * touching the sim:
 *
 *   events     K:PAUSE_ON then K:PAUSE_OFF, and K:PAUSE_TOGGLE twice.
 *   names      Four names SimConnect might know for active pause, each mapped
 *              and sent, and undone when it raised a pause.
 *   documents  TOOLBAR_SET_ACTIVE_PAUSE true, then false, through the inspector
 *              in the toolbar's document, as the reference, then in the EFB's,
 *              a cockpit panel's, and mainUi's, the documents Crosscheck's own
 *              code runs in; engine.trigger as well where the call is refused.
 *
 * Each step reads the Pause_EX1 flags it raised and whether the sim's clock
 * stopped, since active pause stops it and the sim pause doesn't (p01). On the
 * way out, Ctrl+C included, the probe clears any pause it left.
 *
 *   node experiments/areas/environment/p02-active-pause.mjs
 *
 * Output: one line per step on the console, every reading in
 * experiments/areas/environment/results/p02-active-pause-<time>.ndjson, and
 * the report in the .txt beside it.
 */

import { Inspector, listPages } from "../../tools/inspector.mjs"
import { Recorder, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim, describeSystemEvent } from "../aircraft/lib/sim.mjs"

const STEP_MS = 2500
const ACTIVE = 4
const FULL = 1
const CALL = "TOOLBAR_SET_ACTIVE_PAUSE"

// Guesses, each with the send that would undo it. SimConnect answers an
// unknown name with NAME_UNRECOGNIZED, as it did MENU_SR_BACK
// (record/areas/interface/log.md, 2026-10-06).
const NAMES = [
  ["ACTIVE_PAUSE_TOGGLE", [], ["ACTIVE_PAUSE_TOGGLE", []]],
  ["TOGGLE_ACTIVE_PAUSE", [], ["TOGGLE_ACTIVE_PAUSE", []]],
  ["ACTIVE_PAUSE_ON", [], ["ACTIVE_PAUSE_OFF", []]],
  ["ACTIVE_PAUSE_SET", [1], ["ACTIVE_PAUSE_SET", [0]]],
]

// The documents to try, by the titles the inspector lists in a flight
// (experiments/areas/interface/results/p15-links-coverage-2026-10-08-14-54-27.txt).
const DOCUMENTS = [
  ["the toolbar", (p) => /^toolbar$/i.test(p.title)],
  ["the EFB", (p) => /electronic flight bag/i.test(p.title)],
  ["a cockpit panel", (p) => /^VCockpit/i.test(p.title)],
  ["mainUi", (p) => /^mainui$/i.test(p.title)],
]

const rec = new Recorder("p02-active-pause", { area: "environment" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p02-active-pause" })
rec.open()

let latest = {}
let current = null
const w = sim.watch([["SIMULATION RATE", "number"], ["ZULU TIME", "seconds"]], {
  period: "frame",
  changed: false,
  label: "clock",
  onData: (v, t) => {
    latest = Object.fromEntries(v)
    if (current && t - current.lastAt >= 200) {
      current.lastAt = t
      current.samples.push({ t, zulu: latest["ZULU TIME"] })
      rec.data("clock", "", { step: current.name, zulu: latest["ZULU TIME"], pause: sim.live.pause })
    }
  },
})
sim.systemHandlers.add((name, data) => {
  if (name === "Pause_EX1" && current) current.pauses.push(data)
})

// Zulu seconds against real seconds across a step, as p01 measured it.
function clockRate(samples) {
  if (samples.length < 2) return null
  const a = samples[0], b = samples[samples.length - 1]
  let dz = b.zulu - a.zulu
  if (dz < -43_200) dz += 86_400
  return dz / ((b.t - a.t) / 1000)
}
const flags = (list) => (list.length ? list.map((d) => describeSystemEvent("Pause_EX1", d)).join(" → ") : "no Pause_EX1")
const rate = (r) => (r === null ? "no clock data" : `clock ${r.toFixed(2)}x`)
const pausedNow = () => sim.live.pause ?? 0

const report = []
const found = []

// Runs act(), then watches for STEP_MS. act() may return a function that's
// called at the end of the window and returns a note for the report, such as
// how a page's call settled.
async function step(name, act) {
  if (stopping) return null
  const s = { name, pauses: [], samples: [], lastAt: 0, t0: Date.now() }
  current = s
  const later = await act()
  await sleep(STEP_MS)
  current = null
  const note = typeof later === "function" ? await later() : later
  const exceptions = rec.timeline.filter((e) => e.kind === "exception" && e.t >= s.t0).map((e) => e.text)
  const r = clockRate(s.samples)
  const line = `${name}: ${flags(s.pauses)}; ${rate(r)}, pause now ${describeSystemEvent("Pause_EX1", pausedNow())}` +
    `${note ? `; ${note}` : ""}${exceptions.length ? `; exceptions: ${exceptions.join(", ")}` : ""}`
  report.push(line)
  rec.log("step", line)
  if (s.pauses.some((d) => d & ACTIVE)) found.push(name)
  return { pauses: s.pauses, rate: r, exceptions }
}

// ---------------------------------------------------------------- documents

const callIn = (method, on) => `(function () {
  function safe(v) { try { return JSON.stringify(v) } catch (e) { return String(v) } }
  var r = window.CROSSCHECK_P02 = { via: null, state: "none", value: null }
  try {
    var c = (typeof Coherent !== "undefined" && Coherent.${method}) ? Coherent : (typeof engine !== "undefined" ? engine : null)
    if (!c) { r.state = "no Coherent or engine"; return r }
    r.via = (typeof Coherent !== "undefined" && c === Coherent ? "Coherent" : "engine") + ".${method}"
    var p = c.${method}("${CALL}", ${on})
    if (p && typeof p.then === "function") {
      r.state = "pending"
      p.then(function (v) { r.state = "resolved"; r.value = safe(v) }, function (e) { r.state = "rejected"; r.value = safe(e) })
    } else { r.state = "returned"; r.value = safe(p) }
  } catch (e) { r.state = "threw"; r.value = String(e) }
  return r
})()`
const readBack = `(function () { var r = window.CROSSCHECK_P02; return r ? JSON.stringify(r) : "nothing" })()`

async function inDocument(label, page) {
  const insp = new Inspector(page.id)
  try {
    await insp.open()
  } catch (e) {
    report.push(`${label} (${page.title}): the inspector couldn't open it: ${e.message}`)
    return
  }
  try {
    const settle = async () => {
      const r = JSON.parse(await insp.evaluate(readBack))
      return `${r.via ?? "no call"} ${r.state}${r.value ? ` ${r.value}` : ""}`
    }
    let refused = false
    for (const on of [true, false]) {
      const res = await step(`${CALL} ${on} in ${label} (${page.title})`, async () => {
        await insp.evaluate(callIn("call", on))
        return async () => {
          const note = await settle()
          if (/rejected|threw|no Coherent/.test(note)) refused = true
          return note
        }
      })
      // A refused call that also raised nothing leaves nothing to turn off.
      if (on && refused && !(res?.pauses ?? []).length) break
    }
    if (refused) {
      for (const on of [true, false]) {
        const res = await step(`${CALL} ${on} by trigger in ${label} (${page.title})`, async () => {
          await insp.evaluate(callIn("trigger", on))
          return settle
        })
        if (on && !(res?.pauses ?? []).length) break
      }
    }
  } catch (e) {
    report.push(`${label} (${page.title}): ${e.message}`)
  } finally {
    insp.close()
  }
}

// ---------------------------------------------------------------- putting back

let toolbar = null
let stopping = false

async function clearPauses() {
  if (pausedNow() & FULL) {
    sim.transmit("PAUSE_SET", [0])
    await sleep(1000)
  }
  if (pausedNow() & ACTIVE && toolbar) {
    const insp = new Inspector(toolbar.id)
    try {
      await insp.open()
      await insp.evaluate(callIn("call", false))
      await sleep(1000)
    } catch { /* the line below says the pause is still on */ } finally { insp.close() }
  }
  if (pausedNow() & (FULL | ACTIVE)) {
    rec.log("stop", `Still paused: ${describeSystemEvent("Pause_EX1", pausedNow())}. Press your pause key or the toolbar's active pause button.`)
  }
}

async function finish(why = null) {
  if (stopping) return
  stopping = true
  current = null
  await clearPauses()
  w.stop()
  const text = [
    "p02 · Turning active pause on and off from code, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    why ? `Stopped: ${why}` : null,
    "",
    `Raised active pause: ${found.length ? found.join("; ") : "nothing"}`,
    "",
    ...report,
    "",
    `Pause at the end: ${describeSystemEvent("Pause_EX1", pausedNow())}`,
  ].filter((x) => x !== null).join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
}

// A second Ctrl+C while the first is putting things back would cut it short.
process.on("SIGINT", async () => {
  if (stopping) return rec.log("stop", "Ctrl+C again: still putting the pause back")
  rec.log("stop", "Ctrl+C: putting the pause back")
  await finish("Ctrl+C")
  process.exit(0)
})
process.on("uncaughtException", async (e) => {
  rec.log("error", e.stack ?? String(e))
  await finish(String(e))
  process.exit(1)
})

// ---------------------------------------------------------------- steps

// The clock has to be running at the start, or no step can show it stopping.
{
  const s = { name: "start", pauses: [], samples: [], lastAt: 0 }
  current = s
  await sleep(1500)
  current = null
  const r = clockRate(s.samples)
  rec.log("start", `${rate(r)}, rate ${latest["SIMULATION RATE"] ?? "unknown"}, pause ${describeSystemEvent("Pause_EX1", pausedNow())}`)
  if (r === null || r < 0.5) {
    await finish("the sim's clock isn't running: load a flight, close any pause, and run the probe again")
    process.exit(1)
  }
}

// events
await step("K:PAUSE_ON", () => { sim.transmit("PAUSE_ON") })
await step("K:PAUSE_OFF", () => { sim.transmit("PAUSE_OFF") })
await clearPauses()
await step("K:PAUSE_TOGGLE", () => { sim.transmit("PAUSE_TOGGLE") })
await step("K:PAUSE_TOGGLE again", () => { sim.transmit("PAUSE_TOGGLE") })
await clearPauses()

// names
for (const [name, values, [undo, undoValues]] of NAMES) {
  const res = await step(`K:${name} ${values.join(" ")}`.trim(), () => { sim.transmit(name, values) })
  if (res?.pauses.length) await step(`K:${undo} ${undoValues.join(" ")}`.trim(), () => { sim.transmit(undo, undoValues) })
  await clearPauses()
}

// documents
let pages = []
try {
  pages = await listPages()
} catch (e) {
  report.push(`documents: ${e.message.split("\n")[0]}`)
}
toolbar = pages.find(DOCUMENTS[0][1]) ?? null
for (const [label, match] of DOCUMENTS) {
  if (stopping) break
  const page = pages.find(match)
  if (!page) {
    if (pages.length) report.push(`${label}: no page listed`)
    continue
  }
  await inDocument(label, page)
  await clearPauses()
}

await finish()
process.exit(0)
