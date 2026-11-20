// Join, at the end of the pilot flying's crew row for a pilot out of the flight, with where the pilot flying is under
// their name, rebuilt from `JoinPf` in experiments/areas/interface/bench/src/frames/home.tsx
// (record/areas/interface/decisions.md, "Join takes a joiner from the world map into the PF's flight, or only sets it
// up"). A press asks first, in the kit's confirm popover, since one of its two answers, Join now, starts a flight: the
// question names the pilot flying, and the answers say how far to go. While the menu script works, Join shows a
// spinner. Where Join can't go, it's disabled, and a tooltip says why; a disabled button takes no pointer events, so
// the tooltip hangs on a wrapper.

import { Button, Confirm, Spinner, toast, Tooltip } from "@dualinput/ui"
import type { ToastLevel } from "@dualinput/ui"
import { useEffect, useRef } from "react"

import type { GoToSlice } from "../../../engines/messages/ts/go-to/GoToSlice.ts"
import type { JoinState } from "../../../engines/messages/ts/go-to/JoinState.ts"
import type { SessionSlice } from "../../../engines/messages/ts/session/SessionSlice.ts"
import type { SliceMember } from "../../../engines/messages/ts/session/SliceMember.ts"
import type { CrewRowView } from "../../../platform/efb-shell/src/part.ts"
import { useCoreSlice, useShell } from "../../../platform/efb-shell/src/part.ts"
import { isCurrentApp } from "../../../platform/efb-shell/src/view.ts"
import { JOIN, NAME } from "./names.ts"
import { saidWords, whereWords, whyWords } from "./words.ts"

/**
 * Join now takes the sim's own flight-button yellow, so it reads as starting the flight, as the world map's Start
 * flight does: `--colorSpecial` and `--colorSpecial_Content` (read in fs-base-ui 0.1.10,
 * components/shared/variables.css).
 */
const SIM_FLY_BUTTON = "bg-[#FFDE03] text-[#242934] hover:bg-[#FFDE03]/90"

function JoinButton({ state, pf, title, onJoin }: { state: Exclude<JoinState, { as: "hidden" }>; pf: string; title: string; onJoin: (now: boolean) => void }) {
  if (state.as === "unavailable") {
    return (
      <Tooltip content={whyWords(state.why, pf, title)} className="max-w-60">
        <span className="inline-flex">
          <Button size="sm" disabled>
            Join
          </Button>
        </span>
      </Tooltip>
    )
  }
  const busy = state.as === "running"
  return (
    <Confirm question={`Join ${pf}?`} also={{ label: "Set up only", onSelect: () => onJoin(false) }} go="Join now" goClassName={SIM_FLY_BUTTON} onConfirm={() => onJoin(true)} size="sm" disabled={busy} align="end">
      {busy && <Spinner />}
      Join
    </Confirm>
  )
}

/** The pilot flying, by the session's slice. */
function pilotFlying(session: SessionSlice | undefined): SliceMember | undefined {
  return session?.members.find((member) => member.pilot === session.pf)
}

/** How often a toast waiting for the EFB looks whether it's open, in milliseconds, as the frame looks at the EFB. */
const LOOK_EVERY = 500

/**
 * Shows each thing a Join says once, as a toast, counting from the first slice that arrives, so a page that opens
 * later shows nothing old. The core counts again from 1 after a session ends or the core restarts, so any count other
 * than the last one shown is new. A pilot can press Join and close the EFB at once, and a toast while it's closed
 * would play out unseen, so it waits until the EFB shows our app, and a newer one replaces it.
 */
function useSaidToasts(slice: GoToSlice | undefined, session: SessionSlice | undefined): void {
  const { efbClosed } = useShell()
  const shown = useRef<number | null | undefined>(undefined)
  const waiting = useRef<{ text: string; level?: ToastLevel } | null>(null)
  const said = slice?.said
  const arrived = slice !== undefined
  useEffect(() => {
    const show = () => {
      if (!waiting.current || efbClosed() || !isCurrentApp()) return
      toast(waiting.current.text, waiting.current.level)
      waiting.current = null
    }
    const timer = window.setInterval(show, LOOK_EVERY)
    return () => window.clearInterval(timer)
  }, [efbClosed])
  useEffect(() => {
    if (!arrived) return
    const n = said?.n ?? null
    if (shown.current === undefined || !said || n === shown.current) {
      shown.current = n
      return
    }
    shown.current = n
    waiting.current = saidWords(said, pilotFlying(session)?.name ?? "")
    if (waiting.current && !efbClosed() && isCurrentApp()) {
      toast(waiting.current.text, waiting.current.level)
      waiting.current = null
    }
  }, [arrived, said?.n])
}

/** Go to's crew row: Join and where the pilot flying is, on their row alone. */
export function useJoinRow(): (member: SliceMember, session: SessionSlice) => CrewRowView | undefined {
  const { link } = useShell()
  const slice = useCoreSlice<GoToSlice>(NAME)
  useSaidToasts(slice, useCoreSlice<SessionSlice>("session"))
  return (member, session) => {
    const title = member.status.title
    // Until the pilot flying's aircraft name arrives, the row shows the app's own line and no Join, so nothing names an aircraft it can't.
    if (!slice || slice.join.as === "hidden" || member.pilot !== session.pf || title === null) return undefined
    const onJoin = (now: boolean) => {
      link.client.command(JOIN, { now }).catch((error: Error) => console.error(`Dual Input: Join was refused: ${error.message}`))
    }
    return { under: whereWords(slice.spot, title), end: <JoinButton state={slice.join} pf={member.name} title={title} onJoin={onJoin} /> }
  }
}
