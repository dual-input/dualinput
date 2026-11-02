// The preflight summary, which leads the banner from the moment preflight starts until the flight does: the folded
// session card's row, every pilot's head badged with where they stand and this pilot's Ready with the countdown's
// ring, then home's hand line, for the pilot flying where the checklist is, and the match check's differences,
// counted and led by the worst one's icon, which the EFB app lists. It has no ×, since it's the banner's whole job
// during preflight, it leaves when the flight starts, and the toolbar's button closes the banner
// (record/areas/interface/decisions.md, "The banner is a box of opaque cards at the screen's top right").

import { BadgedHead, CountdownRing, crewInPreflight, ReadyButton, useCountdown } from "@dualinput/crew"
import { cx, showPressOn } from "@dualinput/ui"
import { CircleX, Hand, ListChecks, TriangleAlert } from "lucide-react"
import { useRef } from "react"
import type { ReactNode } from "react"

import type { NetSlice } from "../../../engines/messages/ts/net/NetSlice.ts"
import type { SessionSlice } from "../../../engines/messages/ts/session/SessionSlice.ts"
import { CARD_LAYER, CARD_NUDGE } from "./note-card.tsx"

function Line({ icon, className, children }: { icon: ReactNode; className: string; children: ReactNode }) {
  return (
    <p className={cx("flex items-start", className)}>
      <span className="mr-1.5 flex h-4 shrink-0 items-center [&>svg]:size-3.5">{icon}</span>
      {children}
    </p>
  )
}

const counted = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

export function PreflightCard({ session, network, onOpen, onReady }: { session: SessionSlice; network: NetSlice | undefined; onOpen: () => void; onReady: (on: boolean) => void }) {
  const nudge = useRef<HTMLDivElement>(null)
  const left = useCountdown(session.preflight.phase === "countdown")
  const { me, everyone, inRow, notInRow, stateOf } = crewInPreflight(session.members, session.me, true, (pilot) => network?.members.find((link) => link.pilot === pilot)?.up === false)
  const errors = session.differences.filter((difference) => difference.level === "error").length
  const warnings = session.differences.length - errors
  const differences = [errors > 0 && counted(errors, "error"), warnings > 0 && counted(warnings, "warning")].filter(Boolean).join(" and ")
  return (
    <div ref={nudge} className={cx("pointer-events-auto relative w-full rounded-4xl bg-card text-card-foreground", CARD_NUDGE)}>
      <button type="button" aria-label="Open Dual Input on the EFB" className={CARD_LAYER} onClick={onOpen} onMouseDown={() => showPressOn(nudge.current!)} />
      <div className="pointer-events-none relative flex flex-col p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center">
            {inRow.map((member) => (
              <BadgedHead key={member.pilot} pilot={member.pilot} name={member === me ? "You" : member.name} state={stateOf(member)} className="mr-1.5" />
            ))}
            {notInRow > 0 && (
              <span aria-label={`${notInRow} more pilots`} className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">
                +{notInRow}
              </span>
            )}
          </span>
          <span className="pointer-events-auto flex items-center">
            <CountdownRing left={left} />
            <ReadyButton ready={!!me?.ready} why={session.ready?.[0]} onToggle={() => onReady(!me?.ready)} />
          </span>
        </div>
        <div className="mt-3 flex flex-col space-y-1.5 text-xs">
          <Line icon={<Hand />} className="text-info">
            Avoid unnecessary cockpit interactions until the flight starts, as some may not sync.
          </Line>
          {session.pf === session.me && (
            <Line icon={<ListChecks />} className="text-muted-foreground">
              Your preflight checklist is in Dual Input's EFB app
            </Line>
          )}
          {differences && (
            <Line icon={errors > 0 ? <CircleX className="text-destructive" /> : <TriangleAlert className="text-warning" />} className="text-muted-foreground">
              {differences} between your setups
            </Line>
          )}
        </div>
      </div>
    </div>
  )
}
