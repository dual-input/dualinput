// The Settings tab: what a pilot sets once for this PC and seldom again, each section a heading over a card
// (record/areas/interface/decisions.md, "The Settings tab"). A part adds its own section when its stage comes, as
// take-control's key does. A change a pilot watches happens in the page's moment, its old words fading before its
// new ones fade in, so a row never shows two states at once.

import { Button, Card, Confirm, cx, Fades, Link, MOMENT, part, Room, ScrollPage, ScrollWindow, Select, SelectContent, SelectItem, SelectTrigger, Separator, Spinner, Switch, toast, useMoment, useReveal, useScrollTo } from "@dualinput/ui"
import { CircleArrowUp, FolderOpen, Trash2, TriangleAlert } from "lucide-react"
import { createElement, useEffect, useRef, useState } from "react"
import type { ReactNode, Ref } from "react"

import type { HelperSlice } from "../../../../engines/messages/ts/core_helper/HelperSlice.ts"
import type { Update } from "../../../../engines/messages/ts/desktop/Update.ts"
import type { RecordingSlice } from "../../../../engines/messages/ts/recording/RecordingSlice.ts"
import type { Run } from "../../../../engines/messages/ts/recording/Run.ts"
import type { SessionSlice } from "../../../../engines/messages/ts/session/SessionSlice.ts"
import { useDesktopState } from "../desktop-link.ts"
import { useCoreSlice, useShell } from "../part.ts"
import type { Part } from "../part.ts"
import { WANTED } from "../wanted.ts"
import type { Wanted } from "../wanted.ts"

function Section({ title, aside, foot, at, children }: { title: string; aside?: ReactNode; foot?: ReactNode; at?: Ref<HTMLElement>; children: ReactNode }) {
  return (
    <section ref={at} className="flex flex-col">
      <Fades className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        {aside && <span className="text-xs tabular-nums text-muted-foreground">{aside}</span>}
      </Fades>
      {children}
      {foot && (
        <Fades className="mt-2.5 px-1">
          <p className="text-xs text-muted-foreground">{foot}</p>
        </Fades>
      )}
    </section>
  )
}

/** The card's rows reach its edges, 20px in, each with room above and below of its own. */
function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <Card flush>
      <div className="py-2">{children}</div>
    </Card>
  )
}

/** A row with its control at the right, 36px tall, as a switch's row is. */
function Row({ label, note, tone, children }: { label: ReactNode; note?: ReactNode; tone?: string; children?: ReactNode }) {
  return (
    <div className={cx("flex min-h-8 items-center px-5", note ? "py-1.5" : "py-0.5")}>
      <span className="flex min-w-0 flex-1 flex-col text-sm">
        {label}
        {note && <span className={cx("mt-0.5 text-xs", tone ?? "text-muted-foreground")}>{note}</span>}
      </span>
      {children && <span className="ml-3 flex shrink-0 items-center">{children}</span>}
    </div>
  )
}

/**
 * The device every sound Dual Input plays goes to, set here alone: Windows' default, which Dual Input follows
 * when the pilot switches headsets, or a device the pilot picks. While a picked device is missing, sound plays on
 * the default, which a warning under it names, lighting the tab's dot.
 */
function OutputDevice() {
  const { link, setDot } = useShell()
  const helper = useCoreSlice<HelperSlice>("core-helper")
  const outputs = helper?.outputs ?? []
  const [picked, setPicked] = useState<string>("default")
  const device = outputs.find((output) => output.id === picked)
  const fallback = helper?.in_use?.name
  const gone = picked !== "default" && !device
  const warning = useReveal(gone)
  useEffect(() => setDot("settings", gone), [gone, setDot])
  const choose = (id: string) => {
    setPicked(id)
    void link.client.command("clients.set-setting", { key: "core-helper.output", value: id === "default" ? null : id }).catch(() => {})
  }
  const defaultWords = (
    <span className="flex min-w-0">
      <span className="mr-2 shrink-0">Windows default</span>
      {fallback && <span className="truncate text-muted-foreground">· {fallback}</span>}
    </span>
  )
  return (
    <Section title="Sound">
      <SettingsCard>
        <div className="flex flex-col px-5 py-2">
          <span className="mb-3 text-sm">Output device</span>
          <Select value={picked} onValueChange={choose}>
            <SelectTrigger className="w-full">{picked === "default" ? defaultWords : <span className="truncate">{device?.name ?? "Disconnected device"}</span>}</SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{defaultWords}</SelectItem>
              {outputs.map((output) => (
                <SelectItem key={output.id} value={output.id}>
                  {output.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Room open={warning.open} style={warning.style} pad="pt-3">
            <p className="flex items-start text-xs text-warning">
              <TriangleAlert className="mr-2 mt-px size-3.5 shrink-0" />
              <span>Not connected, so sound is playing on {fallback ?? "your default device"}</span>
            </p>
          </Room>
        </div>
      </SettingsCard>
    </Section>
  )
}

/** A run's folder is named by its start in UTC, as in `2026-10-20_14-02-11`, which shows in the pilot's time. */
function startOf(name: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/.exec(name)
  if (!match) return name
  const [, year, month, day, hour, minute, second] = match
  const start = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)))
  const pad = (n: number) => String(n).padStart(2, "0")
  const clock = `${pad(start.getHours())}:${pad(start.getMinutes())}`
  const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const daysAgo = Math.round((midnight(new Date()) - midnight(start)) / 86_400_000)
  if (daysAgo === 0) return `Today, ${clock}`
  if (daysAgo === 1) return `Yesterday, ${clock}`
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[start.getMonth()]} ${start.getDate()}, ${clock}`
}

const megabytes = (bytes: number) => Math.round(bytes / 1_000_000)
/** A window of four rows and half of a fifth, so the cut row says there's more. */
const RUNS_WINDOW = 36 * 4.5

/** Why a run stopped, which only this page tells the pilot. */
const STOPPED_WORDS = { "no-space": "Recording stopped: your drive has under 1 GB free", "failed-write": "Recording stopped: Dual Input couldn't write to your drive" }

/** This PC's recordings, newest first. The run in progress can't be deleted, but its folder opens, for a problem the pilot is having now. Open folder's toast says where it opened, since Explorer opens behind the sim, where a pilot in VR won't see it. */
function Recordings() {
  const { link } = useShell()
  const recording = useCoreSlice<RecordingSlice>("recording")
  const stopped = useCoreSlice<Wanted>(WANTED)?.recordingStopped
  const stoppedLine = useReveal(!!stopped)
  const lastStopped = useRef(stopped)
  if (stopped) lastStopped.current = stopped
  const runs: Run[] = (recording?.runs ?? []).slice().reverse()
  const total = runs.reduce((sum, run) => sum + megabytes(run.size), 0)
  return (
    <Section
      title="Recordings"
      aside={`${total} MB of 1 GB`}
      foot={
        <>
          Dual Input keeps a simple log plus a full recording of every run. On your PC only and within a 1 GB budget (oldest deleted first). To report a problem, send us the run's log.txt on <Link tone="muted" onClick={() => toast("Opening our Discord in your browser")}>Discord</Link>, and we may ask for the full recording if we need a closer look.
        </>
      }
    >
      <SettingsCard>
        <Room open={stoppedLine.open} style={stoppedLine.style} pad="px-5 pb-2 pt-1">
          <p className="flex items-start text-xs text-warning">
            <TriangleAlert className="mr-2 mt-px size-3.5 shrink-0" />
            <span>{lastStopped.current && STOPPED_WORDS[lastStopped.current]}</span>
          </p>
        </Room>
        <ScrollWindow max={RUNS_WINDOW}>
          <ul className="flex flex-col">
            {runs.map((run) => (
              <li key={run.name} className="flex min-h-8 items-center px-5 py-0.5">
                <span className="flex flex-1 items-center text-sm">
                  {startOf(run.name)}
                  {run.in_progress && (
                    <span className="ml-2 flex items-center text-xs text-muted-foreground">
                      <span className="mr-1.5 size-1.5 rounded-full bg-success" />
                      Recording
                    </span>
                  )}
                </span>
                <span className="ml-3 text-sm tabular-nums text-muted-foreground">{megabytes(run.size)} MB</span>
                <span className="ml-3 flex items-center">
                  <Button size="icon-sm" variant="ghost" aria-label="Open folder" onClick={() => toast("Opened in File Explorer, on your desktop")}>
                    <FolderOpen />
                  </Button>
                  {run.in_progress ? (
                    <span className="ml-1 size-8" />
                  ) : (
                    <span className="ml-1">
                      <Confirm variant="ghost" size="icon-sm" question="Delete this recording?" go="Delete" goVariant="danger" align="end" onConfirm={() => void link.client.command("recording.delete", { name: run.name })}>
                        <Trash2 />
                      </Confirm>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </ScrollWindow>
      </SettingsCard>
    </Section>
  )
}

/**
 * Dual Input itself: starting with Windows, and its version with the update's state: up to date, checking,
 * downloading, ready, or failed. A ready update grows a box in the header's news tone, which installs it, asking
 * first, since it ends the flight; in a session, the session holds the update, so the box says to install it
 * outside one. The version's note changes in the page's moment, and the download's count moves as it comes, with no
 * moment, as a count does.
 */
function DualInput({ version }: { version: string }) {
  const { desktop, updateAsks } = useShell()
  const scrollTo = useScrollTo()
  const session = useCoreSlice<SessionSlice>("session")
  const local = useDesktopState(desktop)
  const update: Update = local?.update ?? { state: "current", checked: null }
  const moment = useMoment(update.state, update)
  const ready = useReveal(update.state === "ready")
  const bar = useReveal(update.state === "downloading")
  const at = useRef<HTMLElement>(null)
  useEffect(() => {
    if (updateAsks > 0 && at.current) scrollTo(at.current)
    // The header's View update asks by counting up, and the page is this section's for its life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateAsks])
  const check = () => desktop.ask({ t: "check-for-updates" })
  const shown = moment.shown
  const checks = (state: string) => state === "current" || state === "checking"
  const note =
    !local ? undefined : shown.state === "current" ? (
      `Up to date${shown.checked ? `, checked ${shown.checked}` : ""}`
    ) : shown.state === "checking" ? (
      <span className="flex items-center">
        <Spinner className="mr-1.5 size-3" />
        Checking for updates
      </span>
    ) : shown.state === "downloading" ? (
      `Downloading ${shown.next}, ${update.state === "downloading" ? update.done : 0}%`
    ) : shown.state === "failed" ? (
      `Couldn't download ${shown.next}: ${shown.error}`
    ) : undefined
  return (
    <Section title="Dual Input" at={at}>
      <SettingsCard>
        {/* It's the desktop app that starts with Windows, so with none to ask, there's no switch to show. */}
        {local && (
          <>
            <button type="button" className="flex min-h-9 w-full items-center px-5 text-left text-sm" onClick={() => desktop.ask({ t: "set-start-with-windows", on: !local.start_with_windows })}>
              <span className="flex-1">Start with Windows</span>
              <Switch checked={local.start_with_windows} tabIndex={-1} className="pointer-events-none" />
            </button>
            <Separator className="my-2" />
          </>
        )}
        <Row label={`Version ${version}`} note={note && <span className="block" style={part(moment.stage, true)}>{note}</span>} tone={shown.state === "failed" ? "text-destructive" : undefined}>
          {local && checks(shown.state) && (
            <Button size="sm" variant="secondary" disabled={update.state === "checking"} onClick={check} style={part(moment.stage, !(checks(moment.from.state) && checks(moment.to.state)))}>
              Check now
            </Button>
          )}
          {shown.state === "failed" && (
            <Button size="sm" variant="secondary" onClick={check} style={part(moment.stage, true)}>
              Try again
            </Button>
          )}
        </Row>
        <Room open={bar.open} style={bar.style} pad="pb-3 pt-1">
          <div className="mx-5 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${update.state === "downloading" ? update.done : 0}%`, transition: `width ${MOMENT.step * 3}ms linear` }} />
          </div>
        </Room>
        <Room open={ready.open} style={ready.style} pad="pb-2 pt-1.5">
          <div className="mx-5 rounded-2xl bg-primary/[0.07] px-4 py-3">
            <div className="flex items-start">
              <CircleArrowUp className="mr-2.5 mt-0.5 size-4 shrink-0 text-primary" />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-primary">Dual Input {update.state === "ready" ? update.next : ""} is ready</span>
                <span className="mt-1 text-sm text-foreground/75">{session?.held ? "Install it when you're not in a session." : "Close the sim to install."}</span>
              </span>
            </div>
            {!session?.held && (
              <div className="mt-3 pl-[26px]">
                <Confirm size="sm" question="Restart the sim?" go="Restart now" align="start" onConfirm={() => desktop.ask({ t: "install-update" })}>
                  Install and restart
                </Confirm>
              </div>
            )}
          </div>
        </Room>
      </SettingsCard>
    </Section>
  )
}

export function SettingsPage({ version, parts }: { version: string; parts: Part[] }) {
  return (
    <ScrollPage>
      {parts.map((part) => part.settings && createElement(part.settings, { key: part.name }))}
      <OutputDevice />
      <Recordings />
      <DualInput version={version} />
    </ScrollPage>
  )
}
