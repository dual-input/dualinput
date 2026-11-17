// Rate and pause's part in the EFB app: code with no screen of its own, which turns active pause on
// and off with the call the sim's toolbar makes, `TOOLBAR_SET_ACTIVE_PAUSE`, the one way we found,
// since no SimConnect event we tried does it (record/areas/session/02-units.md, "Rate and pause").
// The call worked from the EFB's document through the inspector with the EFB closed; that our app's
// own code can make it is unverified, and a session in the sim settles it.

import type { SetPause } from "../../../engines/messages/ts/rate-and-pause/SetPause.ts"
import { definePart } from "../../../platform/efb-shell/src/part.ts"
import type { Part } from "../../../platform/efb-shell/src/part.ts"

/** `NAME` in src/engines/messages/src/rate_and_pause.rs names it too, so change both together. */
export const NAME = "rate-and-pause"

/** The sim's call into its own code, which the EFB's document has. */
declare const Coherent: { call(name: string, ...args: unknown[]): Promise<unknown> }

/** The part, making its call through `call`, which a test hands in. */
export function rateAndPause(call: (name: string, on: boolean) => Promise<unknown>): Part {
  let unlisten: (() => void) | null = null
  return definePart({
    name: NAME,
    start(api) {
      unlisten = api.onUnit(NAME, (body) => {
        const on = (body as SetPause).on
        call("TOOLBAR_SET_ACTIVE_PAUSE", on).catch((error) => console.error(`Dual Input: TOOLBAR_SET_ACTIVE_PAUSE ${on} failed: ${error}`))
      })
    },
    stop() {
      unlisten?.()
      unlisten = null
    },
  })
}

export default rateAndPause((name, on) => Coherent.call(name, on))
