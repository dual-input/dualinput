// What the screens read that the core's slices don't carry yet, gathered in one slice so they sit in one
// place: a core with none of it leaves each undefined, and the screens leave out what it says, while the dev
// loop's stand-in core feeds all of it. TODO: when a slice below carries a field, read it there and take the
// field out, and when none is left, take this file out.

import type { Difference } from "../../../engines/messages/ts/session/Difference.ts"

/** How hosting or joining can be refused (record/areas/network/02-units.md, "Its requests"). */
export type Refusal = "offline" | "servers" | "no-code" | "you-older" | "host-older" | "too-many"

export type Wanted = {
  /** For `sim`: the loaded aircraft as home names it, with its profile's maturity, or null with no profile. */
  aircraft?: { maker: string; model: string; tail: string; maturity: "Stable" | "Experimental" | null }
  /** For `session`: the attempt running. */
  attempt?: { on: "host" | "join"; dialing: boolean } | null
  /** For `session`: the last attempt's refusal, with the words its text fills in. */
  refused?: { on: "host" | "join"; why: Refusal; theirs?: string; yours?: string; until?: string } | null
  /** For `network`: each link's round trip in milliseconds, by pilot, which stage 11b's core change adds as `MemberLink.round_trip_ms`. */
  roundTrips?: Record<string, number>
  /** For `session`: a difference's note, by its item. */
  notes?: Record<number, Difference["words"]>
  /** For `network`: whether our servers answer, and for the desktop app's local port: whether the firewall blocks us. */
  servers?: "reachable" | "unreachable"
  firewall?: "allows" | "blocks"
  /** For setup's checks and the setting that records it's done: whether setup still has to run, and what it finds. */
  setup?: { failure?: "addon" | "offline" | "servers" | "firewall"; username: string; addonVersion?: string } | null
  /** For a setting that records the guide's done: whether this is a first visit. */
  firstVisit?: boolean
  /** For the figures' feature: this pilot's color, by its name in the palette. */
  color?: string
  /** For `profile-loader`: every profile's aircraft, for the picker. */
  supported?: { maker: string; model: string; maturity: "Stable" | "Experimental"; installed: boolean }[]
  /** For `sim`: whether the pilot is at Free flight's world map or in a flight, the one place a pick can load. */
  where?: "world-map" | "flight"
  /** For the desktop app's local port: the update's state. */
  update?: { state: "current" | "checking" | "downloading" | "ready" | "failed"; next: string; done?: number; checked?: string }
}

export const WANTED = "wanted"
