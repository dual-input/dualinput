// The session's side of the card, from the moment Host or Join succeeds: the invite code with Copy, every
// pilot's to share, since it belongs to the session; Leave, asking first once anyone else is in it; and the crew,
// this pilot first, then the pilots the countdown waits on, then the rest
// (record/areas/interface/decisions.md, "The session page is home once a session starts"). During preflight it
// has a second form for the card's fold: one row of every pilot's head, badged ready or out, and this pilot's Ready.

import { Badge, Button, CardContent, Confirm, cx, ScrollWindow, Separator, toast, useRoot } from "@dualinput/ui"
import { Check, Copy, LogOut, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import type { MemberLink } from "../../../../engines/messages/ts/net/MemberLink.ts"
import type { NetSlice } from "../../../../engines/messages/ts/net/NetSlice.ts"
import type { SessionSlice } from "../../../../engines/messages/ts/session/SessionSlice.ts"
import type { SliceMember } from "../../../../engines/messages/ts/session/SliceMember.ts"
import { CrewHeads, EmptyHead, Head, useCrew } from "../heads/head.tsx"
import { HEAD_CUE } from "../heads/live.ts"
import { useCoreSlice, useShell } from "../part.ts"
import { WANTED } from "../wanted.ts"
import type { Wanted } from "../wanted.ts"
import { CrewDifferences } from "./differences.tsx"
import { COUNTDOWN, MyReady } from "./ready.tsx"

/** A window of three rows and half of a fourth, which covers v1's two pilots with room to spare, during preflight only: outside it nothing waits under the card, so a big crew only lengthens the page. */
const CREW_WINDOW = 150
/** The heads the folded row has room for before Ready with its ring; a bigger crew shows one fewer and a count of the rest. */
const ROW_HEADS = 7
/** The heads pop in as the card turns to the session, one after another down the list, in milliseconds; a pilot who joins later pops in as their row appears. */
const POP = { first: 120, stagger: 70 }

/** Where a pilot is, under their name, the two troubles in the warning color. Their link lost and their sim crashed outrank where their sim last was. */
function whereabouts(member: SliceMember, link: MemberLink | undefined): { shows: string; trouble?: boolean } {
  if (link && !link.up) return { shows: "Connection lost", trouble: true }
  const { stage, ended, title } = member.status
  if (stage === "closed" && ended?.as === "crash") return { shows: "Sim crashed", trouble: true }
  if (stage === "closed") return { shows: "Sim not running" }
  if (stage === "starting") return { shows: "Starting the sim" }
  if (stage === "menu") return { shows: "At the main menu" }
  if (stage === "loading") return { shows: "Loading a flight" }
  if (member.in_flight) return { shows: "In the flight" }
  return { shows: title ? `In the ${title}` : "In another flight" }
}

/** A link's quiet chip: its path and round trip. */
function linkWords(link: MemberLink | undefined, roundTrip: number | undefined): string | undefined {
  if (!link?.up || !link.path) return undefined
  const path = link.path === "Direct" ? "Direct" : "Relay"
  return roundTrip === undefined ? path : `${path} · ${roundTrip}ms`
}

/** The code as a pilot reads it out, in two groups. */
const spaced = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`

function CrewRow({ member, you, flying, link, roundTrip, pop, alive, end }: { member: SliceMember; you: boolean; flying: boolean; link: MemberLink | undefined; roundTrip: number | undefined; pop?: number; alive: boolean; end?: React.ReactNode }) {
  // A row's pop is fixed when the row first shows.
  const [popAfter] = useState(pop)
  const under = you ? undefined : whereabouts(member, link)
  const chip = you ? undefined : linkWords(link, roundTrip)
  return (
    <li className="flex items-center">
      <span data-fold-glide={`head-${member.pilot}`} className="mr-3 flex shrink-0">
        <Head pilot={member.pilot} pop={popAfter} alive={alive} slumped={under?.trouble} />
      </span>
      <div data-fold-fade className="flex min-w-0 flex-col">
        <span className="flex items-center text-sm font-medium">
          <span className="mr-2">{you ? "You" : member.name}</span>
          {flying && (
            <Badge variant="secondary" className="mr-2">
              Pilot flying
            </Badge>
          )}
          {chip && (
            <Badge variant="outline" className="mr-2 tabular-nums text-muted-foreground">
              {chip}
            </Badge>
          )}
        </span>
        {under && <span className={cx("text-xs", under.trouble ? "text-warning" : "text-muted-foreground")}>{under.shows}</span>}
      </div>
      {end && (
        <span data-fold-fade className="ml-auto">
          {end}
        </span>
      )}
    </li>
  )
}

/** A pilot's head in the folded row, with a badge at its lower right: an empty ring while the countdown waits on them, green filling it from the middle once they're ready, and a red cross while they're out of the flight. */
type HeadState = "ready" | "out" | "waiting"
const HEAD_SAYS: Record<HeadState, string> = { ready: "ready", out: "out of the flight", waiting: "not ready" }
const FILL_MS = 220

function RowHead({ member, name, state }: { member: SliceMember; name: string; state: HeadState | undefined }) {
  const ready = state === "ready"
  const badge = "absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full ring-2 ring-card"
  return (
    <span data-fold-glide={`head-${member.pilot}`} aria-label={state ? `${name}, ${HEAD_SAYS[state]}` : name} className="relative mr-1.5 inline-flex">
      <Head pilot={member.pilot} alive turns slumped={state === "out"} />
      {state === "out" && (
        <span data-fold-fade className={cx(badge, "bg-destructive text-destructive-foreground")}>
          <X className="size-2.5" strokeWidth={3} />
        </span>
      )}
      {(state === "waiting" || ready) && (
        <span data-fold-fade className={cx(badge, "bg-card text-success-foreground")}>
          <span className="absolute inset-x-0 inset-y-0 rounded-full border border-muted-foreground" />
          <span className="absolute inset-x-0 inset-y-0 rounded-full bg-success" style={{ transform: ready ? "none" : "scale(0)", transition: `transform ${FILL_MS}ms ease-out` }} />
          <Check className="relative size-2.5" strokeWidth={3} style={{ opacity: ready ? 1 : 0, transition: `opacity ${FILL_MS}ms ease-out` }} />
        </span>
      )}
    </span>
  )
}

export function SessionSide({ session, started, turnedIn, folded, onEase }: { session: SessionSlice; started: boolean; turnedIn: boolean; folded: boolean; onEase: () => void }) {
  const { link } = useShell()
  const net = useCoreSlice<NetSlice>("network")
  const wanted = useCoreSlice<Wanted>(WANTED)
  const crew = useCrew()
  const { scale } = useRoot()
  crew.scale = scale
  const me = session.members.find((member) => member.pilot === session.me)
  const others = session.members.filter((member) => member !== me)
  const phase = session.preflight.phase
  const preflight = (phase === "running" || phase === "countdown") && !!me?.in_flight
  const ready = !!me?.ready

  // The countdown's seconds, drawn here from the moment its phase starts.
  const [left, setLeft] = useState<number | null>(null)
  const counting = phase === "countdown"
  useEffect(() => {
    if (!counting) {
      setLeft(null)
      return
    }
    setLeft(COUNTDOWN)
    const tick = window.setInterval(() => setLeft((seconds) => (seconds === null ? null : Math.max(0, seconds - 1))), 1000)
    return () => window.clearInterval(tick)
  }, [counting])

  // A pilot who readies nods, and the rest look at them.
  const readyBefore = useRef(new Set(session.members.filter((member) => member.ready).map((member) => member.pilot)))
  useEffect(() => {
    const now = new Set(session.members.filter((member) => member.ready).map((member) => member.pilot))
    now.forEach((pilot) => {
      if (!readyBefore.current.has(pilot)) crew.readied(pilot)
    })
    readyBefore.current = now
  })

  const linkOf = (pilot: string) => net?.members.find((candidate) => candidate.pilot === pilot)
  const out = (member: SliceMember) => {
    const where = whereabouts(member, linkOf(member.pilot))
    return !!where.trouble
  }
  const counted = (member: SliceMember) => !me?.without.includes(member.pilot)
  const waitedOn = (member: SliceMember) => preflight && !started && !member.ready && counted(member)
  const everyone = me ? [me, ...others.filter(waitedOn), ...others.filter((member) => !waitedOn(member))] : others
  const inRow = everyone.length > ROW_HEADS ? everyone.slice(0, ROW_HEADS - 1) : everyone
  const notInRow = everyone.length - inRow.length

  const myReady = preflight && !started && (
    <MyReady ready={ready} why={session.ready?.[0]} left={left} onToggle={() => void link.client.command("session.ready", { on: !ready })} />
  )
  const endOf = (member: SliceMember) => {
    if (!preflight || started) return undefined
    if (member === me) return myReady
    if (!counted(member)) return <span className="text-xs text-muted-foreground">Not counted</span>
    if (out(member) && ready && member.pilot !== session.pf) {
      return (
        <Button size="sm" variant="secondary" onClick={() => void link.client.command("session.go-without", { member: member.pilot })}>
          Go without
        </Button>
      )
    }
    return member.ready ? <Badge variant="success">Ready</Badge> : <span className="text-xs text-muted-foreground">Not ready</span>
  }
  const stateOf = (member: SliceMember): HeadState | undefined => {
    if (member.ready) return "ready"
    if (out(member)) return "out"
    return member === me || waitedOn(member) ? "waiting" : undefined
  }
  const leave = () => void link.client.command("session.leave", null)
  const leaveWords = (
    <>
      <span className="mr-1">Leave</span>
      <LogOut className="size-4" />
    </>
  )
  return (
    <CrewHeads crew={crew}>
      <div className="relative">
        <div data-fold-form="full" className={cx("relative space-y-5", folded && "pointer-events-none")}>
          <CardContent data-fold-fade className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="mb-1 text-xs text-muted-foreground">Invite code</span>
              <div className="flex items-center">
                <span className="mr-1 font-mono text-2xl font-medium tracking-wider">{session.code ? spaced(session.code) : "···-···"}</span>
                <Button variant="ghost" size="icon-sm" aria-label="Copy the invite code" disabled={!session.code} onClick={() => toast("Copied the invite code")}>
                  <Copy />
                </Button>
              </div>
            </div>
            <span {...{ [HEAD_CUE]: "leave" }}>
              {others.length > 0 ? (
                <Confirm variant="destructive" size="sm" question="Leave the session?" go="Leave" align="end" onConfirm={leave}>
                  {leaveWords}
                </Confirm>
              ) : (
                <Button variant="destructive" size="sm" onClick={leave}>
                  {leaveWords}
                </Button>
              )}
            </span>
          </CardContent>
          <div data-fold-fade>
            <Separator />
          </div>
          <CardContent>
            <span data-fold-fade className="mb-3 block text-xs text-muted-foreground">
              Crew
            </span>
            <ScrollWindow max={preflight && !started ? CREW_WINDOW : undefined}>
              <ul className="space-y-2">
                {everyone.map((member, at) => (
                  <CrewRow
                    key={member.pilot}
                    member={member}
                    you={member === me}
                    flying={member.pilot === session.pf}
                    link={linkOf(member.pilot)}
                    roundTrip={wanted?.roundTrips?.[member.pilot]}
                    pop={turnedIn ? 0 : POP.first + at * POP.stagger}
                    alive={preflight && !started && !out(member)}
                    end={endOf(member)}
                  />
                ))}
                {others.length === 0 && (
                  <li data-fold-fade className="flex items-center text-sm text-muted-foreground/60">
                    <span className="mr-3">
                      <EmptyHead />
                    </span>
                    Send the invite code for others to join
                  </li>
                )}
              </ul>
            </ScrollWindow>
            {(preflight || started) && session.differences.length > 0 && <CrewDifferences differences={session.differences} notes={wanted?.notes} started={started} onEase={onEase} />}
          </CardContent>
        </div>
        {preflight && !started && (
          <div data-fold-form="row" className={cx("absolute inset-x-0 top-0", !folded && "pointer-events-none opacity-0")}>
            <CardContent className="flex items-center">
              <div className="mr-4 flex shrink-0 items-center">
                {inRow.map((member) => (
                  <RowHead key={member.pilot} member={member} name={member === me ? "You" : member.name} state={stateOf(member)} />
                ))}
                {notInRow > 0 && (
                  <span data-fold-follows={`head-${everyone[inRow.length]!.pilot}`} aria-label={`${notInRow} more pilots`} className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">
                    +{notInRow}
                  </span>
                )}
              </div>
              <span className="ml-auto">{myReady}</span>
            </CardContent>
          </div>
        )}
      </div>
    </CrewHeads>
  )
}
