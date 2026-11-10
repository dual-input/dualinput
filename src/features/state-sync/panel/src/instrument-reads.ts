// State sync's panel module that reads the values a gauge keeps only in its JavaScript, which a
// profile's `instrument()` names (record/areas/plugins/01-plugins.md, "Reading it in the panel").
// It only reads, each read in a try, and installs no listener or wrapper, so nothing of it sits
// in the pilot's input path, and a gauge whose read throws keeps running. It runs in Coherent GT,
// so it keeps to ES2017, and esbuild compiles it to es2017.

import type { FromInstrumentReads } from "../../../../engines/messages/ts/state-sync/FromInstrumentReads.ts"
import type { InstrumentPaths } from "../../../../engines/messages/ts/state-sync/InstrumentPaths.ts"
import type { PathReading } from "../../../../engines/messages/ts/state-sync/PathReading.ts"
import type { Reading } from "../../../../engines/messages/ts/state-sync/Reading.ts"
import { keyFor, type PanelCtx, type PanelModuleDef } from "../../../../platform/panel-bridge/src/bridge.ts"

/**
 * The module's name, and the name its messages go under. `INSTRUMENT_READS` in
 * src/engines/messages/src/state_sync.rs names it too, and so does this module's file,
 * src/features/state-sync/panel/instrument-reads.ts, so change all three together.
 */
export const NAME = "instrument-reads"

/** How often the module reads every path, a starting value: well inside the 1.5s the sync engine waits for a write to show (record/areas/plugins/01-plugins.md, "Reading it in the panel"). */
const EVERY_MS = 250

/** The most a value can hold, as sent (decision 046). */
const MOST_TEXT = 4 * 1024

type Path = { number: number; element: Element; steps: string[]; last: string | null }

/**
 * Walks a dotted path from `start`. Each step must be an own data property of the object before
 * it, so a path stays in the gauge's own data, the fields its constructor set, and calls no
 * accessor (record/areas/plugins/01-plugins.md, "What a path reaches").
 */
function walk(start: unknown, steps: string[]): unknown {
  let at: unknown = start
  for (const step of steps) {
    if (at === null || (typeof at !== "object" && typeof at !== "function")) throw new Error(`nothing at ${step}`)
    const found = Object.getOwnPropertyDescriptor(at, step)
    if (!found || !("value" in found)) throw new Error(`no data property ${step}`)
    at = found.value
  }
  return at
}

/** What a path read, as an entry can hold it (record/areas/plugins/01-plugins.md, "Its values"). */
function reading(value: unknown): Reading {
  if (typeof value === "number" && isFinite(value)) return { as: "number", value }
  if (typeof value === "boolean") return { as: "number", value: value ? 1 : 0 }
  if (typeof value === "string") {
    return value.length <= MOST_TEXT ? { as: "text", value } : { as: "error", value: "its text is too long" }
  }
  return { as: "error", value: `it reads ${value === null ? "null" : typeof value}` }
}

export function instrumentReads(): PanelModuleDef {
  let timer: ReturnType<typeof setInterval> | null = null
  return {
    start(ctx: PanelCtx) {
      let paths: Path[] = []
      const read = () => {
        const readings: PathReading[] = []
        for (const path of paths) {
          let now: Reading
          try {
            now = reading(walk(path.element, path.steps))
          } catch (e) {
            now = { as: "error", value: String(e) }
          }
          const text = JSON.stringify(now)
          if (text === path.last) continue
          // A failing path says so once, until it reads a value again.
          if (now.as === "error" && path.last !== null && path.last.indexOf('"error"') !== -1) continue
          path.last = text
          readings.push({ number: path.number, reading: now })
        }
        if (readings.length > 0) ctx.send({ t: "read", readings } satisfies FromInstrumentReads)
      }
      ctx.on((body) => {
        const message = body as unknown as InstrumentPaths
        paths = []
        for (const p of message.paths) {
          const element = ctx.instruments.filter((e) => keyFor(e) === p.instrument)[0]
          if (element) paths.push({ number: p.number, element, steps: p.path.split("."), last: null })
        }
        if (timer === null) timer = setInterval(read, EVERY_MS)
        read()
      })
      ctx.send({ t: "started", instruments: ctx.instruments.map(keyFor) } satisfies FromInstrumentReads)
    },
    stop() {
      if (timer !== null) clearInterval(timer)
      timer = null
    },
  }
}
