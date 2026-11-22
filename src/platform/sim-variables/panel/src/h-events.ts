// Sim variables' panel module that hears `H:` events, which runs in one cockpit panel, since a
// handler in every panel would hear each event once in each
// (record/areas/sync/05-units.md, "`H:` events"). It only listens, beside the stock handler, and
// wraps no instrument, so nothing of it sits in the pilot's input path. It runs in Coherent GT,
// so it keeps to ES2017, and esbuild compiles it to es2017.

import type { HeardH } from "../../../../engines/messages/ts/sim-variables/HeardH.ts"
import type { PanelCtx, PanelModuleDef } from "../../../../platform/panel-bridge/src/bridge.ts"

/**
 * The module's name, and the name its messages go under. `H_EVENTS` in
 * src/engines/messages/src/sim_variables.rs names it too, and so does this module's file,
 * src/platform/sim-variables/panel/h-events.ts, so change all three together.
 */
export const NAME = "h-events"

/** What Coherent's `on` returns, whose `clear` removes the handler. */
type Registration = { clear(): void }

export type Coherent = {
  on(name: string, handler: (target: string | null, args: unknown) => void): Registration
}

/** An event's name, which stock `VCockpit.js` hands to an instrument as `args[0]` (read in the FS Copilot fork's copy of it, `record/pointer-forwarding/module/vendor/VCockpit.stock.js`). */
function nameOf(args: unknown): string | null {
  const name = Array.isArray(args) ? args[0] : args
  return typeof name === "string" ? name : null
}

/** The module. `coherent` is the panel's `Coherent`, which a test stands in for. */
export function hEvents(coherent: () => Coherent): PanelModuleDef {
  let registration: Registration | null = null
  return {
    start(ctx: PanelCtx) {
      registration = coherent().on("OnInteractionEvent", (target, args) => {
        try {
          const name = nameOf(args)
          if (name === null) return
          const heard: HeardH = { name, target: target || null }
          ctx.send(heard)
        } catch (e) {
          console.error(`Dual Input: the panel module ${NAME} failed on an event: ${e}`)
        }
      })
    },
    stop() {
      if (registration) registration.clear()
      registration = null
    },
  }
}
