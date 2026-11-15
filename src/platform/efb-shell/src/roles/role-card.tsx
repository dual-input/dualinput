// A role's tab, for a feature that declares a role's key, as traffic and ATC audio do: the sharing card, one row
// in every state, with the role's own settings under it, then how the feature works and its check
// (record/areas/interface/decisions.md, "The sharing card is one row in every state, and each tab teaches its
// feature"). The shell holds it since a role is the session's, which the shell already shows, and the card reaches
// the feature only through the role's label and key in the session's slice. Rebuilt from the frames in
// experiments/areas/interface/bench/src/frames/traffic.tsx.

import { Head } from "@dualinput/crew"
import { Button, Card, cx, MOMENT, part, Room, Separator, Switch, useMoment } from "@dualinput/ui"
import type { Stage } from "@dualinput/ui"
import { CircleCheck, TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"
import type { CSSProperties, ReactNode } from "react"

import type { SessionSlice } from "../../../../engines/messages/ts/session/SessionSlice.ts"
import { useCoreSlice, useShell } from "../part.ts"

/** A role as this pilot's tab shows it: its key, who holds it, and whether a session runs. */
export type RoleNow = {
  key: number | undefined
  /** The holder's pilot ID, in a session. */
  holder: string | undefined
  /** The holder's name, or `"You"` for this pilot. */
  sharer: string | undefined
  mine: boolean
  session: boolean
}

/** The role whose label, in its feature's words, is `label`, as the session's slice gives it. */
export function useRole(label: string): RoleNow {
  const session = useCoreSlice<SessionSlice>("session")
  const role = session?.roles.find((r) => r.label === label)
  const held = !!session?.held
  const holder = held ? (role?.holder ?? undefined) : undefined
  const mine = !!holder && holder === session?.me
  const name = session?.members.find((m) => m.pilot === holder)?.name
  return { key: role?.key, holder, sharer: holder ? (mine ? "You" : (name ?? "A pilot")) : undefined, mine, session: held }
}

/**
 * The sharing card. With nobody sharing, its label and a switch; while this pilot shares, their head and "You're
 * sharing traffic" with the switch on, to stop; while another pilot does, their head and "James is sharing traffic"
 * with Take over, which takes over at once, with no question (user, 2026-10-31). Outside a session the switch is off
 * and can't turn on. Each switch claims its own role's key alone (user, 2026-11-15). While the row holds the switch,
 * the whole row is its target, out to the card's edges, for a VR pointer, and tints under the pointer to say so. The
 * row is Take over's 32px tall in every state, so the card keeps its height as Take over gives way to the switch. The
 * switch follows the press, and the rest of the row changes in the page's moment: what goes fades, the row takes its
 * new layout while nothing in it shows, an arriving head pops in, and the words and the control come a step after it.
 * Under the row, `settings` gives the role's own settings for the role as the moment shows it, which open, shut, or
 * swap in the same moment, as this pilot comes to hold the role, another pilot does, nobody does, or the session ends.
 */
export function RoleCard({ label, noun, role, settings }: { label: string; noun: string; role: RoleNow; settings?: (shown: RoleNow) => ReactNode }) {
  const { link } = useShell()
  const [pressed, setPressed] = useState<boolean>()
  // The switch follows the press until the key says so either way.
  useEffect(() => setPressed(undefined), [role.mine, role.holder])
  const share = (on: boolean) => {
    if (role.key === undefined) return
    setPressed(on)
    void link.client.command("session.share", { key: role.key, on }).catch(() => setPressed(undefined))
  }
  const moment = useMoment(`${standing(role)}|${role.holder ?? ""}`, role)
  const shown = moment.shown
  const inside = settings?.(shown)
  const takeOver = !!shown.holder && !shown.mine
  const changes = moment.from.holder !== moment.to.holder
  const controlChanges = changes && (!!moment.from.holder && !moment.from.mine) !== (!!moment.to.holder && !moment.to.mine)
  const words = shown.sharer === "You" ? `You're sharing ${noun}` : shown.sharer ? `${shown.sharer} is sharing ${noun}` : label
  const row = (
    <>
      <HeadSpot pilot={shown.holder} stage={moment.stage} changes={changes} />
      <span className={cx("flex min-w-0 flex-1 flex-col text-sm", !shown.holder && "font-medium")}>
        <span style={part(moment.stage, changes, 1, true, true)}>{words}</span>
        {!role.session && <span className="text-xs font-normal text-muted-foreground">Sharing needs a session</span>}
      </span>
      <span className="ml-3 flex shrink-0 items-center" style={part(moment.stage, controlChanges, 1, true, true)}>
        {takeOver ? (
          <Button variant="outline" size="sm" onClick={() => share(true)}>
            Take over
          </Button>
        ) : (
          <Switch checked={role.session && (pressed ?? role.mine)} disabled={!role.session} tabIndex={-1} className="pointer-events-none" />
        )}
      </span>
    </>
  )
  return (
    <Card flush>
      {role.session && !takeOver ? (
        <button type="button" className="flex min-h-8 w-full items-center p-5 text-left transition-colors hover:bg-muted/40 active:bg-muted/60" onClick={() => share(!(pressed ?? role.mine))}>
          {row}
        </button>
      ) : (
        <div className="flex min-h-8 items-center p-5">{row}</div>
      )}
      <Room open={!!inside} style={part(moment.stage, standing(moment.from) !== standing(moment.to), 2, false)}>
        <Separator />
        <div className="flex flex-col space-y-5 p-5">{inside}</div>
      </Room>
    </Card>
  )
}

/** Where this pilot stands with a role, which decides the settings the card holds: outside a session, holding it, while another pilot does, or while nobody does. */
function standing(role: RoleNow): "outside" | "mine" | "theirs" | "nobody" {
  if (!role.session) return "outside"
  if (role.mine) return "mine"
  return role.holder ? "theirs" : "nobody"
}

/**
 * The head's spot, 28px and the 12px after it, there while a pilot is sharing. A head that goes fades in the
 * moment's first step, and its spot goes once it's gone; one that arrives pops in as the second starts. Nothing clips
 * the spot, since the pop swells the head past its size, as a crew row's does (user, 2026-10-31).
 */
function HeadSpot({ pilot, stage, changes }: { pilot: string | undefined; stage: Stage; changes: boolean }) {
  const look: CSSProperties = changes && stage === "out" ? { opacity: 0, transition: `opacity ${MOMENT.out}ms ease-in` } : {}
  return (
    <span className="flex shrink-0 items-center" style={{ width: pilot ? 40 : 0 }}>
      {pilot && (
        <span key={pilot} className="flex" style={look}>
          <Head pilot={pilot} pop={changes && stage !== "out" && stage !== "idle" ? 0 : undefined} />
        </span>
      )}
    </span>
  )
}

/** A line of a feature's check: checked and fine, checked and different, with what differs under it, which also lights the tab's dot, or a rule while nobody shares. */
export type CheckState = "ok" | "differs" | "rule"
export type CheckLine = { id: string; state: CheckState; says: ReactNode; detail?: ReactNode }

/** Each icon sits on its line's first words, 2px down in the 20px line, as the Settings tab's warnings do. */
const ICON = "mt-0.5 size-4 shrink-0"
const STATE_ICON: Record<CheckState, ReactNode> = {
  ok: <CircleCheck className={cx(ICON, "text-success")} />,
  differs: <TriangleAlert className={cx(ICON, "text-warning")} />,
  // A rule is a plain list's point rather than a state, so it takes a small solid dot, in the 16px column the
  // states' icons fill (user, 2026-10-31: the dashed circle read as "can't check" where nothing was being checked).
  rule: <span className="mx-[5px] mt-[7px] block size-1.5 shrink-0 rounded-full bg-muted-foreground" />,
}

/**
 * How the feature works, in a sentence or two under a heading in the card titles' style, with a note on its cost in
 * a paragraph of its own; then the check, one line for each rule of it, titled "Rules" while nobody shares and
 * "Check" once someone does (user, 2026-10-31). The note and the list each open or shut as a room, and a line whose
 * state turns fades its icon and words out and back as the new state, in the page's moment.
 */
export function HowItWorks({ how, note, lines, rules }: { how: string; note?: string; lines: CheckLine[]; rules: boolean }) {
  const key = `${rules}|${!!note}|${lines.map((l) => `${l.id}:${l.state}`).join(",")}`
  const moment = useMoment(key, { note, lines, rules })
  const shown = moment.shown
  const listChanges = moment.from.lines.length > 0 !== moment.to.lines.length > 0 || moment.from.rules !== moment.to.rules
  const stateOf = (ls: CheckLine[], id: string) => ls.find((l) => l.id === id)?.state
  return (
    <div className="flex flex-col">
      <section className="flex flex-col">
        <h2 className="text-sm font-medium">How it works</h2>
        <p className="pt-2 text-sm text-muted-foreground">{how}</p>
        <Room open={!!shown.note} pad="pt-2" style={part(moment.stage, !!moment.from.note !== !!moment.to.note, 2, false)}>
          <p className="text-sm text-muted-foreground">{shown.note}</p>
        </Room>
      </section>
      <Room open={shown.lines.length > 0} pad="pt-6">
        <section className="flex flex-col" style={part(moment.stage, listChanges, 2, false)}>
          <h2 className="mb-2 text-sm font-medium">{shown.rules ? "Rules" : "Check"}</h2>
          <ul className="flex flex-col space-y-3">
            {shown.lines.map((l) => {
              const turns = !listChanges && stateOf(moment.from.lines, l.id) !== stateOf(moment.to.lines, l.id)
              return (
                <li key={l.id} className="flex items-start">
                  <span className="mr-2.5 flex" style={part(moment.stage, turns, 0)}>
                    {STATE_ICON[l.state]}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm" style={part(moment.stage, turns, 1)}>
                      {l.says}
                    </span>
                    <Room open={!!l.detail} pad="pt-0.5" style={part(moment.stage, turns, 2, false)}>
                      <span className={cx("block text-xs", l.state === "differs" ? "text-warning" : "text-muted-foreground")}>{l.detail}</span>
                    </Room>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      </Room>
    </div>
  )
}
