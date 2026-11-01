// The start card's side before a session: the loaded aircraft on top, since a session flies the host's
// aircraft, then Host and the code field to join with. While our servers answer, the button that asked shows it's
// busy and the code field is locked, and a refusal, or the line for an attempt taking long, opens under the
// control that asked.

import { Badge, Button, CardContent, CodeInput, Confirm, Link, Room, Separator, Spinner, toast, useReveal } from "@dualinput/ui"
import { Check } from "lucide-react"
import { useRef } from "react"
import type { ReactNode } from "react"

import { FIGURE_MARKS } from "../figure/standing-figure.tsx"
import type { Refusal, Wanted } from "../wanted.ts"

export type Action = "host" | "join"

/** Where an attempt stands. A join is dialing once our servers have found its code and it's reaching the crew; slow, once the attempt has taken 6s. */
export type Status = { kind: "idle" } | { kind: "busy"; on: Action; dialing: boolean; slow: boolean } | { kind: "done"; on: Action } | { kind: "refused"; on: Action; refusal: NonNullable<Wanted["refused"]> }

/** A refusal's words: either action's when the PC seems offline or our servers don't answer, and a join's with the backend's four refusals. */
function refusalWords(why: Refusal, refusal: NonNullable<Wanted["refused"]>): { title: string; detail: string; update?: boolean } {
  switch (why) {
    case "offline":
      return { title: "Your PC seems offline", detail: "Dual Input needs the internet to connect you and your crew. Check your connection and try again?" }
    case "servers":
      return { title: "Couldn't reach our servers", detail: "Dual Input needs them to connect you and your crew. Try again in a moment." }
    case "no-code":
      return { title: "No session has this code", detail: "Check it with your host and try again." }
    case "you-older":
      return { title: "Your Dual Input is older than the host's", detail: `Your host has ${refusal.theirs} while you have ${refusal.yours}.`, update: true }
    case "host-older":
      return { title: "The host's Dual Input is older than yours", detail: `Your host has ${refusal.theirs} while you have ${refusal.yours}. They need to leave the session and update before you can join.` }
    case "too-many":
      return { title: "Too many wrong codes", detail: `You are being rate limited because you've tried too many wrong codes in an hour. Joining is paused until ${refusal.until}. If you think this is a mistake, please contact us on our Discord.` }
  }
}

function Refused({ refusal }: { refusal: NonNullable<Wanted["refused"]> }) {
  const words = refusalWords(refusal.why, refusal)
  return (
    <div className="rounded-3xl border border-destructive/20 bg-destructive/10 px-5 py-4">
      <p className="text-sm font-medium text-destructive">{words.title}</p>
      <p className="mt-1 text-sm text-foreground/75">{words.detail}</p>
      {words.update && (
        <div className="mt-3">
          <Confirm variant="danger" question="Restart the sim?" go="Restart now" align="start" onConfirm={() => toast("Restarting the sim to update")}>
            Restart the sim to update
          </Confirm>
        </div>
      )}
    </div>
  )
}

/** A room under a control for what comes and goes: it keeps 12px from the control while open, and holds what it had as it shuts. */
function UnderControl({ children }: { children: ReactNode }) {
  const last = useRef(children)
  if (children) last.current = children
  const reveal = useReveal(!!children)
  return (
    <Room open={reveal.open} style={reveal.style} pad="pt-3">
      {last.current}
    </Room>
  )
}

export function StartSide({ aircraft, status, code, onCode, onHost, onJoin, onCancel, slowText }: { aircraft: Wanted["aircraft"]; status: Status; code: string; onCode: (code: string) => void; onHost: () => void; onJoin: () => void; onCancel: () => void; slowText: string }) {
  const working = status.kind === "busy" || status.kind === "done"
  const refusedOn = (on: Action) => (status.kind === "refused" && status.on === on ? status.refusal : undefined)
  const under = (on: Action): ReactNode => {
    const refusal = refusedOn(on)
    if (refusal) return <Refused refusal={refusal} />
    if (status.kind === "busy" && status.on === on && status.slow) {
      return (
        <p className="text-sm text-muted-foreground">
          {slowText} <Link onClick={onCancel}>Cancel</Link>
        </p>
      )
    }
    return null
  }
  return (
    <>
      {aircraft && (
        <>
          <CardContent className="flex items-start justify-between">
            <div className="mr-3 flex min-w-0 flex-col">
              <span className="text-xs text-muted-foreground">{aircraft.maker}</span>
              <span className="truncate text-lg font-semibold leading-tight">{aircraft.model}</span>
              <span className="text-xs text-muted-foreground">{aircraft.tail}</span>
            </div>
            {aircraft.maturity ? <Badge variant={aircraft.maturity === "Stable" ? "secondary" : "outline"}>{aircraft.maturity}</Badge> : <Badge variant="warning">Not supported yet</Badge>}
          </CardContent>
          <Separator />
        </>
      )}
      <CardContent>
        <Button size="lg" className="w-full" disabled={working} onClick={onHost} {...{ [FIGURE_MARKS.target]: "", [FIGURE_MARKS.press]: "", [FIGURE_MARKS.host]: "" }}>
          {status.kind === "busy" && status.on === "host" ? (
            <>
              <Spinner />
              Starting your session…
            </>
          ) : status.kind === "done" && status.on === "host" ? (
            <>
              <Check />
              Session started
            </>
          ) : (
            "Host a session"
          )}
        </Button>
        <UnderControl>{under("host")}</UnderControl>
        <div className="my-4 flex items-center">
          <Separator className="flex-1" />
          <span className="mx-3 text-xs text-muted-foreground">or join with a code</span>
          <Separator className="flex-1" />
        </div>
        <div className="flex items-center justify-between">
          <span {...{ [FIGURE_MARKS.target]: "" }}>
            <CodeInput
              value={code}
              disabled={working}
              invalid={refusedOn("join")?.why === "no-code"}
              onChange={onCode}
              onEnter={() => {
                if (code.length === 6 && !working) onJoin()
              }}
            />
          </span>
          <Button variant="outline" disabled={code.length < 6 || working} onClick={onJoin} {...{ [FIGURE_MARKS.target]: "", [FIGURE_MARKS.press]: "" }}>
            {status.kind === "busy" && status.on === "join" ? <Spinner /> : status.kind === "done" && status.on === "join" ? <Check /> : "Join"}
          </Button>
        </div>
        <UnderControl>{under("join")}</UnderControl>
      </CardContent>
    </>
  )
}
