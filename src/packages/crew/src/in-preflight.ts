// Who preflight waits on, and how each pilot's head reads, which the EFB app's session card and the banner's summary
// both show, so one pilot can't read two ways on one screen (record/areas/interface/decisions.md, "The session card
// folds with the page's scroll while a checklist waits under it").

import type { HeadState } from "./badged-head.tsx"

/** The heads a row has room for beside Ready and its ring; a bigger crew shows one fewer and a count of the rest. */
const ROW_HEADS = 7

/** What this needs of a member of the session slice. It keeps to its own shape, since a package imports only packages. */
export type CrewMember = { pilot: string; in_flight: boolean; ready: boolean; without: string[] }

/** What this needs of the session slice to say whether preflight is on for this pilot. */
type SessionFacts = { held: boolean; me: string | null; members: { pilot: string; in_flight: boolean }[]; preflight: { phase: string } }

/** Whether preflight is on for this pilot: it runs, or counts down, and they're in the session's flight. */
export function inPreflight(session: SessionFacts | undefined): boolean {
  if (!session?.held) return false
  const me = session.members.find((member) => member.pilot === session.me)
  return !!me?.in_flight && (session.preflight.phase === "running" || session.preflight.phase === "countdown")
}

/**
 * The crew as preflight sees it: this pilot first, then the pilots the countdown waits on, then the rest. `waiting` says
 * the countdown is still to come. `linkDown` says a member's link is lost.
 */
export function crewInPreflight<M extends CrewMember>(members: M[], me: string | null, waiting: boolean, linkDown: (pilot: string) => boolean) {
  const mine = members.find((member) => member.pilot === me)
  const others = members.filter((member) => member !== mine)
  /** A member who can be gone without, as `dropped_out` in src/platform/session/src/preflight.rs says, so change both together. */
  const out = (member: M) => member !== mine && (!member.in_flight || linkDown(member.pilot))
  /** Any member's going without takes a pilot out of the count. */
  const counted = (member: M) => !members.some((other) => other.without.includes(member.pilot))
  const waitedOn = (member: M) => waiting && !member.ready && counted(member)
  const everyone = mine ? [mine, ...others.filter(waitedOn), ...others.filter((member) => !waitedOn(member))] : others
  const inRow = everyone.length > ROW_HEADS ? everyone.slice(0, ROW_HEADS - 1) : everyone
  const stateOf = (member: M): HeadState | undefined => {
    if (member.ready) return "ready"
    if (out(member)) return "out"
    return member === mine || waitedOn(member) ? "waiting" : undefined
  }
  return { me: mine, others, everyone, inRow, notInRow: everyone.length - inRow.length, out, counted, stateOf }
}
