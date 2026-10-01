/*
 * The context an aircraft's tests run in, and the check of a test module's
 * shape. The shape itself is documented in the runner's header,
 * experiments/areas/aircraft/run.mjs.
 */

import { fmt, sleep } from "./out.mjs"

export const MAX_LIMIT_MS = 90_000
export const STATES = ["parked", "runway"]

export function checkModule(mod, file) {
  const problems = []
  if (!mod || !Array.isArray(mod.tests)) return [`${file} doesn't export default { aircraft, tests: [...] }`]
  const seen = new Set()
  for (const t of mod.tests) {
    const id = `question ${t.question}`
    if (!Number.isInteger(t.question)) problems.push(`a test has no integer question number`)
    if (seen.has(t.question)) problems.push(`${id} appears twice`)
    seen.add(t.question)
    if (![...STATES, "any"].includes(t.state)) problems.push(`${id}: state must be parked, runway, or any, not ${JSON.stringify(t.state)}`)
    if (typeof t.frameSensitive !== "boolean") problems.push(`${id}: frameSensitive must be true or false`)
    if (!Number.isFinite(t.limitMs) || t.limitMs <= 0 || t.limitMs > MAX_LIMIT_MS) problems.push(`${id}: limitMs must be between 1 and ${MAX_LIMIT_MS}`)
    if (typeof t.run !== "function") problems.push(`${id}: run(ctx) is missing`)
  }
  return problems
}

class Aborted extends Error {
  constructor() { super("the test's time limit passed") }
}

// Everything a test may call. The runner builds one per test.
export function makeContext(base, test) {
  const { sim, rec, link } = base
  const controller = new AbortController()
  const notes = []
  const cleanups = []
  const q = test.question
  const guard = () => { if (controller.signal.aborted) throw new Aborted() }
  const guarded = (fn) => async (...args) => { guard(); const r = await fn(...args); guard(); return r }

  const ctx = {
    ...base,
    test,
    signal: controller.signal,
    notes,

    // An observation: one line, and any fields worth keeping in the NDJSON.
    note(text, fields = {}) {
      notes.push({ t: Date.now(), text, fields })
      rec.log("note", `Q${q}: ${text}`, { question: q, ...fields })
    },
    cleanup(fn) { cleanups.push(fn) },

    sleep: guarded((ms) => sleep(ms)),
    read: guarded((vars, opts) => sim.read(vars, opts)),
    readOne: guarded((name, units, opts) => sim.readOne(name, units, opts)),
    readStrings: guarded((names, opts) => sim.readStrings(names, opts)),
    burst: guarded((vars, ms, opts) => sim.burst(vars, ms, opts)),
    waitFor: guarded((name, units, test, opts) => sim.waitFor(name, units, test, opts)),
    write(name, units, value) { guard(); return sim.write(name, units, value) },
    transmit(name, values, opts) { guard(); return sim.transmit(name, values, opts) },
    subscribeKeys(names, opts) { guard(); const s = sim.subscribeKeys(names, opts); cleanups.push(() => s.stop()); return s },
    watch(vars, opts) { guard(); const w = sim.watch(vars, opts); cleanups.push(() => w.stop()); return w },

    // Input events by name, from the enumeration the generic probes made at
    // this load; null when the aircraft has no event of that name.
    inputEvent(name) { return base.inputEvents?.get(name) ?? null },
    getInput: guarded(async (name) => {
      const e = ctx.inputEvent(name)
      if (!e) throw new Error(`no input event named ${name}`)
      return sim.getInputEvent(e.hash)
    }),
    setInput(name, value) {
      guard()
      const e = ctx.inputEvent(name)
      if (!e) throw new Error(`no input event named ${name}`)
      return sim.setInputEvent(e.hash, value, { name })
    },
    subscribeInputs(names, onEvent) {
      guard()
      const byHash = new Map()
      for (const n of names) { const e = ctx.inputEvent(n); if (e) byHash.set(e.hash, n) }
      const s = sim.subscribeInputEvents([...byHash.keys()], (ev) => onEvent({ ...ev, name: byHash.get(ev.hash) }))
      cleanups.push(() => s.stop())
      return s
    },

    exec: guarded((code, opts) => link.exec(code, opts)),
    fireH: guarded((name, value) => link.fire(name, value)),
    setL: guarded((name, value, units) => link.setL(name, value, units)),
    getL: guarded((name, units) => link.getL(name, units)),
    readClientData: guarded((name, size, opts) => sim.readClientData(name, size, opts)),
    panelEval: guarded((sel, expression, opts) => base.panels.evaluate(sel, expression, opts)),
    fmt,
  }

  return {
    ctx,
    abort: () => controller.abort(),
    async runCleanups() {
      const errors = []
      for (const fn of cleanups.reverse()) {
        try { await fn() } catch (e) { errors.push(e.message) }
      }
      return errors
    },
    Aborted,
  }
}
