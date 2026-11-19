/*
 * p33: how the sim orders and applies the key events of one frame, in the Baron 58P's KFC 150,
 * the sim's own autopilot, through each route a write can take: SimConnect, as the core sends
 * a `K:` event; our WASM module's calculator code, as it calls presets and fires `H:` events;
 * our module's Events API, as its routine host sends a key; and a cockpit panel's JavaScript.
 * It asks four things for stage 14c (record/areas/build/plan.md, "14c Two coupled writes in
 * one input"), and writes a report to experiments/areas/sync/results/:
 *
 * - After an event, how soon does each route read its effect: in the same calculator code, in
 *   the same frame, or how many frames later?
 * - Does the race of the first flight with friends happen again: `K:AP_ALT_HOLD` then
 *   `K:AP_PANEL_VS_HOLD` from vertical speed mode, as state sync sent them, through each route?
 * - Does a toggle guarded by its own variable in calculator code, after `K:AP_ALT_HOLD` in the
 *   same code, in the same frame, or a frame later, leave the right mode?
 * - In which order does each route apply two events sent together?
 *
 *   git apply experiments/areas/sync/p33-frame-order/module.patch
 *   node tools/build.ts install                        with the sim closed
 *   node experiments/areas/sync/p33-frame-order/probe.mjs
 *   git apply -R experiments/areas/sync/p33-frame-order/module.patch    after the session
 *
 * Load the Baron 58P at a stand with its engines running and press Ready to fly; the probe
 * does the rest with no hands on the controls. It drives our module through p33.rs, which
 * module.patch builds into it.
 */

import { EventFlag } from "node-simconnect"

import { Recorder, sleep } from "../../aircraft/lib/out.mjs"
import { PRIORITY, Sim } from "../../aircraft/lib/sim.mjs"
import { evaluate, listPages } from "../../../../tools/sim/inspector.ts"

const CMD = "DUALINPUT_P33_CMD"
const OUT = "DUALINPUT_P33_OUT"
const CMD_BYTES = 4096
const OUT_BYTES = 8192
const REPEATS = 3
/** Both vertical modes as one number, altitude hold in the tens: 10 is altitude hold, 1 vertical speed mode. */
const M = "(A:AUTOPILOT ALTITUDE LOCK, Bool) 10 * (A:AUTOPILOT VERTICAL HOLD, Bool) +"
const GUARD = "(A:AUTOPILOT VERTICAL HOLD, Bool) d if{ 1 (>K:AP_PANEL_VS_HOLD) }"

const rec = new Recorder("p33-frame-order", { area: "sync" })
const lines = []
const say = (line) => {
  lines.push(line)
  console.log(line)
}
const modes = (m) => (m === null || m === undefined || Number.isNaN(m) ? "unread" : `ALT ${Math.floor(m / 10)} VS ${m % 10}`)

const sim = await Sim.connect(rec, { name: "Dual Input p33" })
const out = sim.watchClientData(OUT, OUT_BYTES, (bytes) => onOut(bytes))
const cmd = { id: sim.clientDataId(CMD), def: sim.clientDataDef(CMD, 0, CMD_BYTES) }
let token = Math.floor(Date.now() / 1000) % 1_000_000
const waiting = new Map()

function onOut(bytes) {
  const text = bytes.toString("utf8").replace(/\0[\s\S]*$/, "")
  const [first, ...rows] = text.split("\n").filter((l) => l)
  const t = Number(first?.replace(/^done /, ""))
  const fn = waiting.get(t)
  if (!fn) return
  waiting.delete(t)
  fn(rows.map((r) => r.split(" ").map(Number)).map(([frame, us, value]) => ({ frame, us, value })))
}

/** Runs `frames`, a list of steps for each of our module's frames, and gives each step's row. */
async function script(frames, { timeoutMs = 3000 } = {}) {
  const t = ++token
  const text = `run ${t}\n${frames.map((steps) => steps.join("\n")).join("\nnext\n")}\n`
  const payload = Buffer.alloc(CMD_BYTES)
  payload.write(text, 0, "utf8")
  const answer = new Promise((resolve) => {
    waiting.set(t, resolve)
    setTimeout(() => waiting.delete(t) && resolve(null), timeoutMs)
  })
  sim.send(`p33 run ${t}`, () => sim.handle.setClientData(cmd.id, cmd.def, 0, 0, CMD_BYTES, payload))
  const rows = await answer
  if (!rows) throw new Error("our module didn't answer p33's script: is module.patch built into the installed package?")
  return rows
}

/**
 * Sends `K:<name>` as the core sends a profile's event: SimConnect's legacy call with one value,
 * to the pilot's aircraft, from the highest priority (src/engines/sim-client/src/client.rs, `key_values`).
 */
function key(name, value = 0) {
  const id = sim.event(name)
  sim.send(`K:${name} ${value}`, () => sim.handle.transmitClientEvent(0, id, value >>> 0, PRIORITY.highest, EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY))
}

const calc = (code) => `calc ${code}`
const readModes = async () => (await script([[calc(M)]]))[0].value
async function simConnectModes() {
  const v = await sim.read([["AUTOPILOT ALTITUDE LOCK", "Bool"], ["AUTOPILOT VERTICAL HOLD", "Bool"]])
  return v.get("AUTOPILOT ALTITUDE LOCK") * 10 + v.get("AUTOPILOT VERTICAL HOLD")
}

async function panel(expression) {
  const pages = (await listPages()).filter((p) => /^VCockpit/i.test(p.title))
  let last = new Error("no cockpit panel answers on the inspector")
  for (const page of pages) {
    try {
      return await evaluate(page, expression)
    } catch (error) {
      last = error
    }
  }
  throw last
}

/** Puts the autopilot in `mode`, "VS" or "ALT", through its on events, which p31 found it takes. */
async function from(mode) {
  const want = mode === "VS" ? 1 : 10
  for (let i = 0; i < 3; i++) {
    if ((await readModes()) === want) return true
    await script([[calc(mode === "VS" ? "(>K:AP_VS_ON)" : "(>K:AP_ALT_HOLD_ON)")]])
    await sleep(400)
  }
  return (await readModes()) === want
}

/** The trials' outcomes, by trial, for the summary. */
const tally = new Map()

/** Runs `send` from `mode` `REPEATS` times, reads the modes 1s later through our module and SimConnect, and reports each. */
async function trial(name, mode, send, { repeats = REPEATS } = {}) {
  for (let i = 0; i < repeats; i++) {
    if (!(await from(mode))) {
      say(`${name}: the autopilot wouldn't start in ${mode}, so this run was skipped`)
      continue
    }
    const before = await readModes()
    let detail
    try {
      detail = await send()
    } catch (error) {
      say(`${name}: FAILED to send: ${error.message}`)
      continue
    }
    await sleep(1_000)
    const [ours, theirs] = [await readModes(), await simConnectModes()]
    const end = ours === theirs ? modes(ours) : `${modes(ours)} by our module, ${modes(theirs)} by SimConnect`
    say(`${name}: from ${modes(before)} ends ${end}${detail ? `; ${detail}` : ""}`)
    const counts = tally.get(name) ?? new Map()
    counts.set(modes(ours), (counts.get(modes(ours)) ?? 0) + 1)
    tally.set(name, counts)
  }
}

/** Every SimConnect frame's modes while `during` runs, then 10 frames more, as [ms after the send, modes]. */
async function framesAround(during) {
  const samples = []
  const w = sim.watch([["AUTOPILOT ALTITUDE LOCK", "Bool"], ["AUTOPILOT VERTICAL HOLD", "Bool"]], {
    period: "frame",
    changed: false,
    label: "p33 frames",
    onData: (got, t) => samples.push({ t, m: got.get("AUTOPILOT ALTITUDE LOCK") * 10 + got.get("AUTOPILOT VERTICAL HOLD") }),
  })
  while (samples.length < 3) await sleep(5)
  const sentAt = Date.now()
  const sentAfter = samples.length
  await during()
  while (samples.length < sentAfter + 10) await sleep(5)
  w.stop()
  return samples.slice(sentAfter).map((s) => `${s.t - sentAt}ms ${modes(s.m)}`)
}

/** Each step's row, its number shown by `show`: the modes, or the number as it is with `raw`. */
const rowsText = (rows, show = modes) => rows.map((r) => `frame ${r.frame} +${(r.us / 1000).toFixed(1)}ms ${show(r.value)}`).join(", ")
const raw = (v) => String(Math.round(v * 1e4) / 1e4)
const guardRead = (v) => `the guard read VS ${v}`
const quiet = { quiet: true, tag: false }

let lifted = false
try {
  const title = (await sim.readStrings(["TITLE"])).get("TITLE")
  say(`the aircraft is ${title}`)
  const start = await sim.read([
    ["AUTOPILOT MASTER", "Bool"], ["AUTOPILOT FLIGHT DIRECTOR ACTIVE", "Bool"], ["AUTOPILOT ALTITUDE LOCK", "Bool"],
    ["AUTOPILOT VERTICAL HOLD", "Bool"], ["AUTOPILOT HEADING LOCK DIR", "degrees"], ["SIM ON GROUND", "Bool"],
  ])
  say(`before: autopilot ${start.get("AUTOPILOT MASTER")}, flight director ${start.get("AUTOPILOT FLIGHT DIRECTOR ACTIVE")}, ${modes(start.get("AUTOPILOT ALTITUDE LOCK") * 10 + start.get("AUTOPILOT VERTICAL HOLD"))}, heading bug ${start.get("AUTOPILOT HEADING LOCK DIR")}, on the ground ${start.get("SIM ON GROUND")}`)
  const t0 = Date.now()
  await script([[calc("1")]])
  say(`our module answered p33's first script in ${Date.now() - t0}ms`)

  // The modes need the flight director or the autopilot; on the ground with neither, try each.
  if (!(await from("VS")) && !start.get("AUTOPILOT FLIGHT DIRECTOR ACTIVE")) {
    await script([[calc("(>K:TOGGLE_FLIGHT_DIRECTOR)")]])
    await sleep(600)
  }
  if (!(await from("VS")) && !start.get("AUTOPILOT MASTER")) {
    await script([[calc("(>K:AP_MASTER)")]])
    await sleep(600)
  }
  // Still none: freeze the aircraft and lift it 3,000 ft, where the autopilot has taken modes.
  if (!(await from("VS"))) {
    for (const flag of ["LATITUDE_LONGITUDE", "ALTITUDE", "ATTITUDE"]) sim.transmit(`K:FREEZE_${flag}_SET`, [1], quiet)
    await sleep(300)
    const alt = await sim.readOne("PLANE ALTITUDE", "feet")
    sim.set([["PLANE ALTITUDE", "feet"]], [alt + 3_000])
    await sleep(1_500)
    lifted = true
    say(`the autopilot took no modes on the ground, so the probe froze the aircraft and lifted it from ${Math.round(alt)} ft to ${Math.round(await sim.readOne("PLANE ALTITUDE", "feet"))} ft`)
  }
  if (!(await from("VS"))) throw new Error(`the autopilot wouldn't take vertical speed mode here: ${modes(await readModes())}`)
  say(`vertical speed mode engages here: ${modes(await readModes())}`)

  say("\n=== How soon each route reads an event's effect, K:AP_ALT_HOLD from vertical speed mode")
  await trial("visible, our module's calculator code", "VS", async () =>
    rowsText(await script([[calc(`(>K:AP_ALT_HOLD) ${M}`), calc(M)], [calc(M)], [calc(M)], [calc(M)]])), { repeats: 2 })
  await trial("visible, our module's Events API", "VS", async () =>
    rowsText(await script([["key AP_ALT_HOLD 0", calc(M)], [calc(M)], [calc(M)], [calc(M)]])), { repeats: 2 })
  await trial("visible, SimConnect, its own frames", "VS", async () =>
    (await framesAround(async () => key("AP_ALT_HOLD", 0))).join(", "), { repeats: 2 })
  await trial("visible, SimConnect, then our module's frames", "VS", async () => {
    key("AP_ALT_HOLD", 0)
    return rowsText(await script([[calc(M)], [calc(M)], [calc(M)], [calc(M)], [calc(M)]]))
  }, { repeats: 2 })
  await trial("visible, a panel", "VS", async () => {
    const read = `SimVar.GetSimVarValue("A:AUTOPILOT ALTITUDE LOCK", "Bool") * 10 + SimVar.GetSimVarValue("A:AUTOPILOT VERTICAL HOLD", "Bool")`
    await panel(`(function () {
      var out = [];
      window.DUALINPUT_P33_PANEL = out;
      SimVar.SetSimVarValue("K:AP_ALT_HOLD", "number", 0);
      out.push("same call " + ${read});
      var t0 = performance.now(), n = 0;
      function frame() { n++; out.push("frame " + n + " +" + Math.round(performance.now() - t0) + "ms " + ${read}); if (n < 5) requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
      return 0;
    })()`)
    await sleep(600)
    return String(await panel(`(window.DUALINPUT_P33_PANEL || []).join(", ")`)).replace(/ (\d+)(?=,|$)/g, (_, m) => ` ${modes(Number(m))}`)
  }, { repeats: 2 })

  say("\n=== Other events read in the same calculator code")
  const bug = start.get("AUTOPILOT HEADING LOCK DIR")
  const hdg = "(A:AUTOPILOT HEADING LOCK DIR, degrees)"
  say(`K:HEADING_BUG_SET 123: ${rowsText(await script([[calc(`123 (>K:HEADING_BUG_SET) ${hdg}`)], [calc(hdg)], [calc(hdg)]]), raw)}`)
  say(`B:INSTRUMENT_Heading_Bug_Set 231: ${rowsText(await script([[calc(`231 (>B:INSTRUMENT_Heading_Bug_Set) ${hdg}`)], [calc(hdg)], [calc(hdg)]]), raw)}`)
  await script([[calc(`${Math.round(bug)} (>K:HEADING_BUG_SET)`)]])
  const taxi = "(B:LIGHTING_TAXI_1)"
  say(`B:LIGHTING_TAXI_1 read in calculator code: ${(await script([[calc(taxi)]]))[0].value}, and as (A:LIGHT TAXI, Bool): ${(await script([[calc("(A:LIGHT TAXI, Bool)")]]))[0].value}`)
  say(`B:LIGHTING_TAXI_1_Toggle, then (B:LIGHTING_TAXI_1) and (A:LIGHT TAXI, Bool): ${rowsText(await script([[calc(`(>B:LIGHTING_TAXI_1_Toggle) ${taxi}`), calc("(A:LIGHT TAXI, Bool)")], [calc(taxi), calc("(A:LIGHT TAXI, Bool)")], [calc(taxi), calc("(A:LIGHT TAXI, Bool)")]]), raw)}`)
  await sleep(300)
  await script([[calc("(>B:LIGHTING_TAXI_1_Toggle)")]])
  await sleep(300)
  say(`the taxi light back: ${(await script([[calc(taxi)]]))[0].value}`)

  say("\n=== The race: K:AP_ALT_HOLD then K:AP_PANEL_VS_HOLD 1 from vertical speed mode, unguarded, as state sync sent them")
  await trial("race, SimConnect back to back", "VS", async () => {
    key("AP_ALT_HOLD", 0)
    key("AP_PANEL_VS_HOLD", 1)
  })
  await trial("race, our module's calculator code, one call", "VS", async () => {
    await script([[calc("(>K:AP_ALT_HOLD) 1 (>K:AP_PANEL_VS_HOLD)")]])
  })
  await trial("race, our module's calculator code, two calls in one frame", "VS", async () => {
    await script([[calc("(>K:AP_ALT_HOLD)"), calc("1 (>K:AP_PANEL_VS_HOLD)")]])
  })
  await trial("race, our module's Events API, one frame", "VS", async () => {
    await script([["key AP_ALT_HOLD 0", "key AP_PANEL_VS_HOLD 1"]])
  })
  await trial("race, a panel, one call", "VS", async () => {
    await panel(`(function () { SimVar.SetSimVarValue("K:AP_ALT_HOLD", "number", 0); SimVar.SetSimVarValue("K:AP_PANEL_VS_HOLD", "number", 1); return 0; })()`)
  })

  say("\n=== The toggle guarded by its own variable in calculator code, after K:AP_ALT_HOLD; the guard's reading is the last value")
  // Each script's last row is the guard's.
  const guarded = (rows) => rowsText(rows.slice(-1), guardRead)
  await trial("guarded, our module's calculator code, one call", "VS", async () =>
    guarded(await script([[calc(`(>K:AP_ALT_HOLD) ${GUARD}`)]])))
  await trial("guarded, our module's calculator code, two calls in one frame", "VS", async () =>
    guarded(await script([[calc("(>K:AP_ALT_HOLD)"), calc(GUARD)]])))
  await trial("guarded, our module's calculator code, the next frame", "VS", async () =>
    guarded(await script([[calc("(>K:AP_ALT_HOLD)")], [calc(GUARD)]])))
  await trial("guarded, our module's Events API, then calculator code in one frame", "VS", async () =>
    guarded(await script([["key AP_ALT_HOLD 0", calc(GUARD)]])))
  await trial("guarded, SimConnect, then our module's calculator code", "VS", async () => {
    key("AP_ALT_HOLD", 0)
    return guarded(await script([[calc(GUARD)]]))
  })

  say("\n=== The order of two on and off events sent together, from vertical speed mode")
  for (const pair of [["AP_ALT_HOLD_ON", "AP_VS_OFF"], ["AP_VS_OFF", "AP_ALT_HOLD_ON"]]) {
    const named = pair.map((e) => `K:${e}`).join(" then ")
    await trial(`order, ${named}, SimConnect`, "VS", async () => {
      for (const e of pair) key(e)
    }, { repeats: 2 })
    await trial(`order, ${named}, our module's calculator code, one call`, "VS", async () => {
      await script([[calc(pair.map((e) => `(>K:${e})`).join(" "))]])
    }, { repeats: 2 })
    await trial(`order, ${named}, a panel`, "VS", async () => {
      await panel(`(function () { ${pair.map((e) => `SimVar.SetSimVarValue("K:${e}", "number", 0);`).join(" ")} return 0; })()`)
    }, { repeats: 2 })
  }
  await trial("K:AP_VS_OFF alone from altitude hold, our module", "ALT", async () => {
    await script([[calc("(>K:AP_VS_OFF)")]])
  }, { repeats: 2 })

  say("\n=== The other way: K:AP_PITCH_LEVELER_ON then K:AP_PANEL_VS_HOLD 1 from altitude hold, as state sync sends a press of VS")
  await trial("VS pressed, SimConnect back to back", "ALT", async () => {
    key("AP_PITCH_LEVELER_ON", 0)
    key("AP_PANEL_VS_HOLD", 1)
  }, { repeats: 2 })

  say("\n=== Each trial's ends, by our module's reading")
  for (const [name, counts] of tally) say(`${name}: ${[...counts].map(([m, n]) => `${m} ${n} of ${[...counts.values()].reduce((a, b) => a + b, 0)}`).join(", ")}`)

  // Leaves the autopilot as it found it.
  await script([[calc("(>K:AP_VS_OFF) (>K:AP_ALT_HOLD_OFF)")]])
  await sleep(400)
  if (start.get("AUTOPILOT ALTITUDE LOCK")) await script([[calc("(>K:AP_ALT_HOLD_ON)")]])
  if (start.get("AUTOPILOT VERTICAL HOLD")) await script([[calc("(>K:AP_VS_ON)")]])
  const now = await sim.read([["AUTOPILOT MASTER", "Bool"], ["AUTOPILOT FLIGHT DIRECTOR ACTIVE", "Bool"]])
  if (now.get("AUTOPILOT MASTER") !== start.get("AUTOPILOT MASTER")) await script([[calc("(>K:AP_MASTER)")]])
  await sleep(600)
  const fd = await sim.readOne("AUTOPILOT FLIGHT DIRECTOR ACTIVE", "Bool")
  if (fd !== start.get("AUTOPILOT FLIGHT DIRECTOR ACTIVE")) await script([[calc("(>K:TOGGLE_FLIGHT_DIRECTOR)")]])
  say(`\nthe autopilot is back as it was: ${modes(await readModes())}; that's every case`)
  if (lifted) say("The aircraft is still frozen in the air: load the flight again before flying it.")
} catch (error) {
  say(`\nSTOPPED: ${error.message}`)
} finally {
  rec.writeReport(lines.join("\n"))
  await rec.close()
  out.stop()
  sim.close()
  console.log(`\nreport: ${rec.files?.txt ?? "none"}`)
  process.exit(0)
}
