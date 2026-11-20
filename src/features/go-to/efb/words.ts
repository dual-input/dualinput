// Join's words, from the frames' `WAYS` in experiments/areas/interface/bench/src/frames/home.tsx: where the
// pilot flying is, why Join is disabled, and what each Join said. They name pilots, never he or she, since Dual
// Input doesn't know anyone's pronouns, and a tooltip or toast of one sentence has no period (user, 2026-10-29).

import type { ToastLevel } from "@dualinput/ui"

import type { Said } from "../../../engines/messages/ts/go-to/Said.ts"
import type { Spot } from "../../../engines/messages/ts/go-to/Spot.ts"
import type { Stand } from "../../../engines/messages/ts/go-to/Stand.ts"
import type { Unavailable } from "../../../engines/messages/ts/go-to/Unavailable.ts"

/** A stand as a pilot reads it, from the flight file's capitals: `PARKING` and 140 read "Parking 140". */
export function standName(stand: Stand): string {
  const name = stand.name.toLowerCase().replace(/(^|\s)\S/g, (first) => first.toUpperCase())
  return `${name} ${stand.number}`
}

/** Where the pilot flying is, under their name, while this pilot is out of the flight; `title` is their aircraft's `A:TITLE`. */
export function whereWords(spot: Spot | null, title: string): string {
  if (!spot) return "Hasn't loaded a flight yet"
  if (!spot.airport) return `In the ${title}`
  if (spot.engines) return `At ${spot.airport}, engines running`
  return spot.stand ? `At ${spot.airport}, ${standName(spot.stand)}` : `At ${spot.airport}`
}

/** Why Join is disabled, in its tooltip. */
export function whyWords(why: Unavailable, pf: string, title: string): string {
  switch (why) {
    case "no-flight":
      return `You can join once ${pf} is in a flight`
    case "no-aircraft":
      return `Install the ${title} to fly with ${pf}`
    case "other-aircraft":
      return `End this flight to join ${pf} from the world map`
    case "no-departure":
      return `Can't detect departure airport. Start your flight anywhere and Dual Input will teleport you to ${pf}.`
    case "no-script":
      return "Looks like something broke Join (perhaps a sim update, or corrupted Dual Input installation)."
  }
}

/**
 * What a Join said, as a toast, or nothing for Set up only at an airport the pilot flying's flight names no stand at,
 * where the world map's own spot needs no word (user, 2026-11-17).
 */
export function saidWords(said: Said, pf: string): { text: string; level?: ToastLevel } | null {
  const { spot, now, outcome, aircraft } = said
  const airport = spot.airport ?? ""
  const retry = "Try again, or start the flight yourself."
  if (outcome.as === "failed") {
    switch (outcome.step) {
      case "airport":
        return { text: `Join couldn't find ${airport}. ${retry}`, level: "error" }
      case "stand":
        return { text: `Join couldn't select ${spot.stand ? standName(spot.stand) : "the stand"} at ${airport}. ${retry}`, level: "error" }
      case "runway":
        return { text: `Join couldn't select a runway at ${airport}. ${retry}`, level: "error" }
      case "aircraft":
        return { text: `Join couldn't select the ${aircraft}. ${retry}`, level: "error" }
      case "livery":
        return { text: `Join couldn't select ${pf}'s livery. ${retry}`, level: "error" }
      case "launch":
        return { text: `Join couldn't start the flight. ${retry}`, level: "error" }
      case "ready":
        return { text: "Join couldn't press Ready to fly. Press it to start the flight.", level: "error" }
    }
  }
  const stand = spot.stand && !spot.engines ? standName(spot.stand) : null
  if (outcome.no_stand && stand) {
    return now
      ? { text: `${airport}'s stands have no ${stand}, so you'll start elsewhere there, and Dual Input moves you to ${pf}.`, level: "warning" }
      : { text: `Your departure is ${airport}, in the ${aircraft}, but its stands have no ${stand}. Pick ${pf}'s stand on the world map, then start the flight.`, level: "warning" }
  }
  if (spot.engines) {
    return { text: now ? `Starting your flight on a runway at ${airport}, engines running` : `Your departure is a runway at ${airport}, in the ${aircraft}, so your engines run. Start the flight when you're ready.` }
  }
  if (!stand) return now ? { text: `Starting your flight at ${airport}` } : null
  return { text: now ? `Starting your flight at ${airport}, ${stand}` : `Your departure is ${airport}, ${stand}, in the ${aircraft}. Start the flight when you're ready.` }
}
