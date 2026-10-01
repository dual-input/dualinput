/*
 * The A2A PA-24's sim questions, from record/areas/aircraft/a2a-pa24-comanche/study.md,
 * Sim questions. The shape is in run.mjs's header.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { REPO } from "../lib/out.mjs"

// The input events the package declares, by ID (read in a2a-aircraft-pa24
// 2.1.3, common/model/Inputs, Templates, and attachments, by script).
function declaredInputEvents() {
  const file = join(REPO, "record", "areas", "aircraft", "a2a-pa24-comanche", "inventory", "input-events.tsv")
  return readFileSync(file, "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("file\t"))
    .map((l) => { const [file, id, presets, kind] = l.split("\t"); return { file, id, presets, kind } })
}

// The runtime name adds the template's IE_NAME, such as SWITCH_BATTERY_MASTER_2STATES
// for Switch_Battery_Master (measured on MSFS 2024, 2026-08-18, fsc-editor), so a
// declared ID matches a runtime name that is it, or starts with it and an underscore.
function runtimeFor(id, names) {
  const want = id.toUpperCase()
  return names.find((n) => n.toUpperCase() === want) ?? names.find((n) => n.toUpperCase().startsWith(`${want}_`)) ?? null
}

async function watchAfter(ctx, vars, ms = 1500) {
  const samples = await ctx.burst(vars, ms)
  const out = {}
  for (const [name] of vars) {
    const series = samples.map((s) => s.values[name]).filter((v) => v !== undefined)
    out[name] = { values: [...new Set(series)], last: series.at(-1) ?? null }
  }
  return out
}

const describe = (w) => Object.entries(w).map(([n, s]) => `${n} ${s.values.map(ctxFmt).join("→") || "(no value)"}`).join(", ")
const ctxFmt = (v) => (typeof v === "number" && !Number.isInteger(v) ? String(Math.round(v * 1000) / 1000) : String(v))

export default {
  aircraft: "a2a-pa24-comanche",
  tests: [
    {
      question: 11,
      title: "Do the aircraft's input events set its state",
      state: "runway",
      frameSensitive: false,
      limitMs: 60_000,
      async run(ctx) {
        const names = [...(ctx.inputEvents?.keys() ?? [])]
        const declared = declaredInputEvents()
        const matched = declared.filter((d) => runtimeFor(d.id, names))
        ctx.note(`${names.length} input events at runtime; ${matched.length} of ${declared.length} declared IDs match one, ${declared.length - matched.length} don't`,
          { runtime: names.length, declared: declared.length, matched: matched.length, unmatched: declared.filter((d) => !runtimeFor(d.id, names)).map((d) => d.id) })

        // A latching switch, whose input event extends ASOBO_GIE_Anim_Handling.
        const bat = runtimeFor("Switch_Battery_Master", names)
        if (!bat) return `no runtime input event for Switch_Battery_Master among ${names.length}`
        const batVars = [["L:Battery1Switch", "number"], ["ELECTRICAL MASTER BATTERY:1", "bool"]]
        const before = await ctx.read(batVars)
        const ieBefore = await ctx.getInput(bat)
        const original = before.get("L:Battery1Switch")
        ctx.note(`${bat} reads ${ieBefore}; L:Battery1Switch ${original}, A:ELECTRICAL MASTER BATTERY:1 ${before.get("ELECTRICAL MASTER BATTERY:1")}`)
        ctx.cleanup(async () => {
          const now = await ctx.sim.readOne("L:Battery1Switch")
          if (now !== original && original !== null) await ctx.link.setL("L:Battery1Switch", original)
        })
        const target = original === 1 ? 0 : 1
        ctx.setInput(bat, target)
        const w1 = await watchAfter(ctx, batVars)
        const ie1 = await ctx.getInput(bat)
        ctx.note(`set ${bat} to ${target}: ${describe(w1)}; the input event reads ${ie1}`)
        ctx.setInput(bat, original ?? 1)
        const w2 = await watchAfter(ctx, batVars)
        const ie2 = await ctx.getInput(bat)
        ctx.note(`set ${bat} back to ${original ?? 1}: ${describe(w2)}; the input event reads ${ie2}`)
        const latchingWorks = w1["L:Battery1Switch"].last === target && w2["L:Battery1Switch"].last === (original ?? 1)

        // A tooltip-only one: every preset's code is empty, so the click's
        // effect lives in the component's mouse callback.
        const dme = runtimeFor("RADIO1_DME_Switch", names)
        let tooltip = "no runtime input event for RADIO1_DME_Switch"
        if (dme) {
          const dmeVars = [["L:DmeFunction", "number"], ["L:DmeFunction_Position", "number"], ["L:DmeFunction_Knob", "number"]]
          const dBefore = await ctx.read(dmeVars)
          const dIe = await ctx.getInput(dme)
          const value = Number.isFinite(dIe) ? dIe + 1 : 1
          ctx.cleanup(async () => {
            const now = await ctx.sim.readOne("L:DmeFunction")
            if (now !== dBefore.get("L:DmeFunction") && dBefore.has("L:DmeFunction")) await ctx.link.setL("L:DmeFunction", dBefore.get("L:DmeFunction"))
          })
          ctx.setInput(dme, value)
          const w3 = await watchAfter(ctx, dmeVars)
          const dIe2 = await ctx.getInput(dme)
          const moved = dmeVars.filter(([n]) => w3[n].values.some((v) => v !== dBefore.get(n)))
          ctx.note(`set ${dme} from ${dIe} to ${value}: ${describe(w3)}; the input event reads ${dIe2}`)
          tooltip = `setting the tooltip-only ${dme} ${moved.length ? `moved ${moved.map(([n]) => n).join(", ")}` : "moved none of L:DmeFunction and its helpers"}`
        }
        return `${latchingWorks ? "yes for latching switches" : "no"}: ${bat} set L:Battery1Switch ${w1["L:Battery1Switch"].values.join("→")} and back ${w2["L:Battery1Switch"].values.join("→")}; ${tooltip}`
      },
    },

    {
      question: 7,
      title: "Do stock toggles and set events agree with the cockpit",
      state: "runway",
      frameSensitive: false,
      limitMs: 60_000,
      async run(ctx) {
        // Sent without the harness's tag, because the question is about events
        // without a parameter.

        //
        // A subscription at the highest priority hears every event. One at
        // 10,000,001, just below SimConnect's HIGHEST_MASKABLE, hears what no
        // group at or above it masked. Not the default
        // priority: with the stock C152 loaded, a group there didn't hear
        // K:COM_STBY_RADIO_SET_HZ while one at STANDARD did, so another client
        // masks it in between (measured on MSFS 2024, 2026-10-01; unverified
        // which client). The control is an event no group masked on the PA-24
        // (measured on MSFS 2024, 2026-10-01, experiments/areas/aircraft/results/
        // run-a2a-pa24-comanche-2026-10-01-18-20-15.txt), sent with the frequency it already has.
        const control = await ctx.readOne("COM STANDBY FREQUENCY:1", "Hz")
        const cases = [
          { event: "K:COM_STBY_RADIO_SET_HZ", values: [control], stock: ["COM STANDBY FREQUENCY:1", "Hz"], l: null, control: true, restore: () => {} },
          { event: "K:ELECT_FUEL_PUMP1_SET", values: [1], stock: ["GENERAL ENG FUEL PUMP SWITCH:1", "bool"], l: null, restore: (b) => ctx.sim.transmit("K:ELECT_FUEL_PUMP1_SET", [b.stock], { tag: false }) },
          { event: "K:TOGGLE_AVIONICS_MASTER", values: [], stock: ["AVIONICS MASTER SWITCH:1", "bool"], l: null, restore: (b) => ctx.sim.transmit("K:AVIONICS_MASTER_SET", [b.stock], { tag: false }) },
          { event: "K:TOGGLE_BEACON_LIGHTS", values: [], stock: ["LIGHT BEACON", "bool"], l: "L:BeaconLightSwitch", restore: (b) => ctx.link.setL("L:BeaconLightSwitch", b.l) },
          { event: "K:PITOT_HEAT_ON", values: [], stock: ["PITOT HEAT", "bool"], l: "L:PitotHeatSwitch", restore: (b) => ctx.link.setL("L:PitotHeatSwitch", b.l) },
        ]
        const names = cases.map((c) => c.event)
        const seenHigh = []
        const seenLow = []
        ctx.subscribeKeys(names, { priority: "highest", quiet: true, onEvent: (e) => seenHigh.push(e) })
        ctx.subscribeKeys(names, { priority: 10_000_001, quiet: true, onEvent: (e) => seenLow.push(e) })
        const results = []
        for (const c of cases) {
          const vars = [c.stock, ...(c.l ? [[c.l, "number"]] : [])]
          const before = await ctx.read(vars)
          const b = { stock: before.get(c.stock[0]), l: c.l ? before.get(c.l) : null }
          ctx.cleanup(async () => {
            const now = await ctx.sim.read(vars)
            const changed = now.get(c.stock[0]) !== b.stock || (c.l && now.get(c.l) !== b.l)
            if (changed) await c.restore(b)
          })
          const t0 = Date.now()
          ctx.transmit(c.event, c.values, { tag: false })
          const w = await watchAfter(ctx, vars, 2000)
          const bare = c.event.replace(/^K:/, "")
          const high = seenHigh.filter((e) => e.name === bare && e.t >= t0)
          const low = seenLow.filter((e) => e.name === bare && e.t >= t0)
          const stockAfter = w[c.stock[0]].last
          const lAfter = c.l ? w[c.l].last : null
          const r = {
            event: c.event, control: Boolean(c.control), stockBefore: b.stock, stockAfter, stockValues: w[c.stock[0]].values,
            lBefore: b.l, lAfter, lValues: c.l ? w[c.l].values : null,
            heardHighest: high.length, heardBelowMaskable: low.length,
          }
          results.push(r)
          ctx.note(`${c.control ? "control " : ""}${c.event}${c.values.length ? ` ${c.values.join(" ")}` : ""}: ${c.stock[0]} ${b.stock} → ${w[c.stock[0]].values.join("→")}` +
            (c.l ? `, ${c.l} ${b.l} → ${w[c.l].values.join("→")}` : "") +
            `; heard at priority 1 ${high.length}×, at 10,000,001 ${low.length}× (${low.length ? "not masked" : "masked at or above HIGHEST_MASKABLE"})`, r)
        }
        const ctl = results.find((r) => r.control)
        if (!ctl.heardHighest || !ctl.heardBelowMaskable) return `inconclusive: the control event was heard ${ctl.heardHighest}× at priority 1 and ${ctl.heardBelowMaskable}× at 10,000,001`
        const summary = results.filter((r) => !r.control).map((r) => {
          const stockMoved = r.stockAfter !== r.stockBefore
          const lMoved = r.lValues ? r.lAfter !== r.lBefore : null
          const masked = r.heardBelowMaskable === 0
          return `${r.event.replace(/^K:/, "")} ${masked ? "masked" : "passed"}, stock ${stockMoved ? "moved" : "stayed"}${lMoved === null ? "" : `, ${lMoved ? "L: moved" : "L: stayed"}`}`
        })
        return summary.join("; ")
      },
    },
  ],
}
