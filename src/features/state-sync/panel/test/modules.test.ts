// State sync's two panel modules, with a stand-in for the bridge's context and for Coherent.

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { JsonValue } from "../../../../engines/messages/ts/serde_json/JsonValue.ts"
import type { PanelCtx } from "../../../../platform/panel-bridge/src/bridge.ts"
import { type Coherent, hEvents } from "../src/h-events.ts"
import { instrumentReads } from "../src/instrument-reads.ts"

/** A context for `instruments`, with what it sent and how to answer it. */
function context(instruments: object[] = []): { ctx: PanelCtx; sent: JsonValue[]; hear(body: JsonValue): void } {
  const sent: JsonValue[] = []
  let handler: ((body: JsonValue) => void) | undefined
  const ctx = {
    instruments,
    send: (body: JsonValue) => sent.push(body),
    on: (f: (body: JsonValue) => void) => (handler = f),
  } as unknown as PanelCtx
  return { ctx, sent, hear: (body) => handler?.(body) }
}

test("h-events sends each event's name and target, and stops hearing when it stops", () => {
  let handler: ((target: string | null, args: unknown) => void) | null = null
  let cleared = false
  const coherent: Coherent = {
    on(name, f) {
      assert.equal(name, "OnInteractionEvent")
      handler = f
      return { clear: () => (cleared = true) }
    },
  }
  const module = hEvents(() => coherent)
  const { ctx, sent } = context()
  module.start(ctx)
  handler!("gauge-guid", ["FUEL"])
  handler!(null, ["adf_bfo"])
  assert.deepEqual(sent, [
    { name: "FUEL", target: "gauge-guid" },
    { name: "adf_bfo", target: null },
  ])
  module.stop!()
  assert.equal(cleared, true)
})

test("h-events takes an event with no name as nothing", () => {
  let handler: ((target: string | null, args: unknown) => void) | null = null
  const module = hEvents(() => ({ on: (_, f) => ((handler = f), { clear() {} }) }))
  const { ctx, sent } = context()
  module.start(ctx)
  handler!(null, [])
  assert.deepEqual(sent, [])
})

/** A gauge, as the bridge's record of it holds it: `keyFor` reads its identifier and `url`. */
function gauge(fields: object): object {
  const element = Object.create({ inherited: 1 }) as object
  Object.assign(element, { instrumentIdentifier: "KR87A", getAttribute: () => null }, fields)
  return element
}

test("instrument-reads reads each path, sends only what changed, and says an error once", async (t) => {
  const element = gauge({ bfoMode: true, multiMode: 2, nested: { ranges: [40, 80] } })
  const module = instrumentReads()
  t.after(() => module.stop!())
  const { ctx, sent, hear } = context([element])
  module.start(ctx)
  assert.deepEqual(sent, [{ t: "started", instruments: ["KR87A"] }])
  sent.length = 0
  hear({
    paths: [
      { number: 0, instrument: "KR87A", path: "bfoMode", text: false },
      { number: 1, instrument: "KR87A", path: "nested.ranges.1", text: false },
      { number: 2, instrument: "KR87A", path: "inherited", text: false },
    ],
  })
  assert.equal(sent.length, 1, "the first read goes at once")
  const first = sent[0] as unknown as { t: string; readings: { number: number; reading: { as: string; value: unknown } }[] }
  assert.deepEqual(first.readings.slice(0, 2), [
    { number: 0, reading: { as: "number", value: 1 } },
    { number: 1, reading: { as: "number", value: 80 } },
  ])
  assert.equal(first.readings[2]!.reading.as, "error", "a path stays in the gauge's own data")
  sent.length = 0
  await sleep(300)
  assert.deepEqual(sent, [], "nothing changed, and the error isn't said twice")
  ;(element as { multiMode: number }).multiMode = 0
  ;(element as { bfoMode: boolean }).bfoMode = false
  await sleep(300)
  assert.deepEqual(sent, [{ t: "read", readings: [{ number: 0, reading: { as: "number", value: 0 } }] }])
})

test("instrument-reads fails a reading of the other kind than its entry reads", (t) => {
  const element = gauge({ ident: "ADF", mode: 2, armed: true })
  const module = instrumentReads()
  t.after(() => module.stop!())
  const { ctx, sent, hear } = context([element])
  module.start(ctx)
  sent.length = 0
  hear({
    paths: [
      { number: 0, instrument: "KR87A", path: "ident", text: true },
      { number: 1, instrument: "KR87A", path: "ident", text: false },
      { number: 2, instrument: "KR87A", path: "mode", text: true },
      { number: 3, instrument: "KR87A", path: "armed", text: true },
    ],
  })
  const read = sent[0] as unknown as { readings: { number: number; reading: { as: string; value: unknown } }[] }
  assert.deepEqual(read.readings[0], { number: 0, reading: { as: "text", value: "ADF" } })
  assert.deepEqual(
    read.readings.slice(1).map((r) => r.reading.as),
    ["error", "error", "error"],
    "text where a number is read, and a number or a boolean where text is",
  )
})
