// p07's plugin: answers each message from the core with one ToCore message, so
// p07-quickjs can compare the reply with what the sample expects. The probe
// copies this file beside each generator's output, where "./index" resolves to
// that generator's types, and type-checks each copy.

import type { FromCore, ToCore } from "./index"

export function onMessage(m: FromCore): ToCore {
  switch (m.kind) {
    case "session":
      return { kind: "pointerPress", instrument: m.body.pilots[0].name, x: 0.5, y: 0.25, sentAtUs: m.body.sentAtUs + 1 }
    case "notice":
      return m.body.entry ? { kind: "hEvent", name: m.body.entry } : { kind: "heartbeat" }
    case "exports": {
      let sum = 0
      for (const name of Object.keys(m.body.values)) sum += m.body.values[name] ?? 0
      return { kind: "hello", component: "plugin", version: "0.1.0", schema: String(sum) }
    }
  }
}
