// The Settings tab: what a pilot sets once for this PC and seldom again, in four sections, each a
// heading over a card (user, 2026-10-31): take-control's key or button, and whether a press or a
// hold takes control; the output device that every sound Dual Input plays goes to; the recordings,
// from which a pilot reports a problem; and Dual Input itself, starting with Windows, and its
// version with the update's box, which the header's View update opens. What a pilot sets for one
// feature lives on its tab: the name, the color, and which figures show on Figures; sharing, the
// ATC app, and the volume on Traffic and ATC audio. Left out: Quit, which the tray's menu keeps
// (user, 2026-10-31); turning off an aircraft plugin, which this design leaves out; the microphone,
// which comes with the voice phrases, out of v1; and the relay list, whose default ships with each
// release. The device names, the runs, the versions, and the error are examples, and the words are
// drafts.
// Install and restart, and Start with Windows, each need the EFB app to reach the desktop app,
// which holds the update and writes the Run value, and nothing carries either yet
// (record/areas/interface/decisions.md, Dual Input's one full window is its EFB app).
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { CircleArrowUp, FolderOpen, Trash2, TriangleAlert, X } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, useShowDot, type HeaderStatus } from "./shell"
import { ScrollPage } from "./scroller"
import { ConfirmButton, RESTART_SIM } from "./confirm"
import { ScrollWindow } from "./home"
import { SwitchRow } from "./avatars"
import { useFlightAround } from "./traffic"

const VERSION = "1.0.2"
const NEXT = "1.0.3"

// A section's heading in How it works' style, over its card, with a line under the card where the
// card needs one. Each card's rows are 36px, 16px in from the card's edges, as Figures' are.
function Section({ title, aside, foot, children, at }: { title: string; aside?: React.ReactNode; foot?: React.ReactNode; children: React.ReactNode; at?: React.Ref<HTMLElement> }) {
  return (
    <section ref={at} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        {aside && <span className="text-xs text-muted-foreground tabular-nums">{aside}</span>}
      </div>
      {children}
      {foot && <p className="px-1 pt-0.5 text-xs text-muted-foreground">{foot}</p>}
    </section>
  )
}
function SettingsCard({ children }: { children: React.ReactNode }) {
  const { Card } = useUI()
  return <Card className="gap-0 py-2 [--card-spacing:--spacing(5)]">{children}</Card>
}

// A row with its control at the right, 36px, as tall as a switch's row, a 32px control in it. A
// row of one line centers its words' capitals on the control from their baseline, through a strut
// half the control's 32px and half Geist's 10px capitals at 14px, as the sharing card's row does,
// since each platform places the words in their line box differently; a row with a note centers
// the two as a block.
function Row({ label, note, tone, children }: { label: React.ReactNode; note?: React.ReactNode; tone?: string; children?: React.ReactNode }) {
  return (
    <div className={"flex min-h-8 px-(--card-spacing) py-0.5 " + (note ? "items-center py-1.5" : "items-baseline")}>
      {!note && <span aria-hidden className="h-[21px] w-0 self-baseline" />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        {label}
        {note && <span className={"text-xs " + (tone ?? "text-muted-foreground")}>{note}</span>}
      </span>
      {children && <span className="ml-3 flex shrink-0 items-center gap-1 self-center">{children}</span>}
    </div>
  )
}

// Two choices side by side, the kit's tabs drawn at a row's 32px, since a switch would name only
// one of them.
function Choice<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span role="radiogroup" className="inline-flex h-8 items-center rounded-full bg-muted p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={
            "h-full rounded-full border px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 " +
            (v === value ? "border-input bg-input/30 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")
          }
        >
          {label}
        </button>
      ))}
    </span>
  )
}

// Take-control's key or button and how it takes control (record/areas/control/01-take-control.md,
// The binding): none at first; Bind waits for the next press, with the sim's window in front,
// where a bound key counts, so a pilot binds in the sim, here; a bound key shows as the strip's cap,
// an outline and the key's name, in the page's ink. A hold takes 0.35s, the button's own hold, so
// the gesture has one number. The line under the card is the record's ask to keep the key unbound
// in the sim (record/areas/product/03-v1-scope.md, Take-control key). The binding takes one key,
// so a modifier alone or a combination doesn't bind, which also leaves the canvas's Ctrl+\ alone.
// In the bench, the next key pressed outside a text field binds; a button's name would be the
// helper's, from its device.
type Key = string | null | "waiting"
function TakeControlKey({ start, onBound }: { start: Key; onBound: (key: string | undefined) => void }) {
  const { Button, Kbd } = useUI()
  const [key, setKey] = useState<Key>(start)
  const kept = useRef<string | null>(start === "waiting" ? null : start)
  const [hold, setHold] = useState<"press" | "hold">("hold")
  useEffect(() => onBound(key === "waiting" || key === null ? undefined : key), [key, onBound])
  useEffect(() => {
    if (key !== "waiting") return
    const press = (e: KeyboardEvent) => {
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key) || e.ctrlKey || e.altKey || e.metaKey) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      const name = e.key.length === 1 ? e.key.toUpperCase() : e.key
      kept.current = name
      setKey(name)
    }
    window.addEventListener("keydown", press)
    return () => window.removeEventListener("keydown", press)
  }, [key])
  return (
    <Section title="Take control" foot="Keep it unbound in the sim's own controls, so it does only this">
      <SettingsCard>
        <Row label="Key or button">
          {key === "waiting" ? (
            <>
              <span className="mr-2 text-sm text-primary">Press a key or button…</span>
              <Button size="sm" variant="secondary" onClick={() => setKey(kept.current)}>
                Cancel
              </Button>
            </>
          ) : key ? (
            <>
              <Kbd className="mr-2 border border-foreground/70 bg-transparent font-semibold text-foreground/70">{key}</Kbd>
              <Button size="sm" variant="secondary" onClick={() => setKey("waiting")}>
                Change
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Unbind" onClick={() => ((kept.current = null), setKey(null))}>
                <X />
              </Button>
            </>
          ) : (
            <>
              <span className="mr-2 text-sm text-muted-foreground">Not set</span>
              <Button size="sm" variant="secondary" onClick={() => setKey("waiting")}>
                Bind
              </Button>
            </>
          )}
        </Row>
        <Row label="Take control with a" note={hold === "hold" ? "Takes control once held for 0.35s, like the button" : "Takes control as soon as it's pressed"}>
          <Choice
            value={hold}
            options={[
              ["press", "Press"],
              ["hold", "Hold"],
            ]}
            onChange={setHold}
          />
        </Row>
      </SettingsCard>
    </Section>
  )
}

// The device every sound Dual Input plays goes to, take-control's cues and the crew's ATC among
// them, set here alone (record/areas/interface/decisions.md, the Traffic and ATC audio tabs): Windows'
// default, which Dual Input follows when the pilot switches headsets, or a device the pilot picks,
// by its name when its ID changes (record/areas/core/04-core-helper.md, The devices). It's the ATC
// app picker's dropdown again: closed, "Windows default" says which device that is, as
// "Automatic" says which program it captures. While a picked device is missing, sound plays on the
// default, which a warning under it names, in amber, lighting the tab's dot (the dot mine).
const DEVICES = ["Headset (USB Audio)", "Speakers (Realtek(R) Audio)", "LG HDR 4K (NVIDIA High Definition Audio)"]
const GONE = "Speakers (Focusrite USB Audio)"
function OutputDevice({ missing }: { missing?: boolean }) {
  const { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectSeparator, SelectItem } = useUI()
  const [value, setValue] = useState(missing ? GONE : "default")
  const gone = value === GONE
  useShowDot("settings", gone)
  const items = [{ value: "default", label: "Windows default" }, ...[...DEVICES, GONE].map((d) => ({ value: d, label: d }))]
  return (
    <Section title="Sound">
      <SettingsCard>
        <div className="flex flex-col gap-3 px-(--card-spacing) py-2">
          <span className="text-sm">Output device</span>
          <Select items={items} value={value} onValueChange={(v: string | null) => v && setValue(v)}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string) =>
                  v === "default" ? (
                    <span className="flex min-w-0 gap-2">
                      Windows default<span className="truncate text-muted-foreground">· {DEVICES[0]}</span>
                    </span>
                  ) : (
                    <span className="truncate">{v}</span>
                  )
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value="default">
                  <span className="flex gap-2">
                    Windows default<span className="text-muted-foreground">· {DEVICES[0]}</span>
                  </span>
                </SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="pt-1.5">Devices</SelectLabel>
                {DEVICES.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
                {gone && (
                  <SelectItem value={GONE}>
                    <span className="flex gap-2">
                      {GONE}
                      <span className="text-muted-foreground">· not connected</span>
                    </span>
                  </SelectItem>
                )}
              </SelectGroup>
            </SelectContent>
          </Select>
          {gone && (
            <p className="flex items-baseline gap-2 text-xs text-warning">
              <TriangleAlert className="size-3.5 shrink-0 [transform:translateY(2.7px)]" />
              <span>Not connected, so sound is playing on {DEVICES[0]}</span>
            </p>
          )}
        </div>
      </SettingsCard>
    </Section>
  )
}

// This PC's recordings, a run for each start of the core, newest first, each by its start, in the
// pilot's time, and its size (record/areas/recording/01-recording-and-bug-reports.md, What each PC
// keeps): v1 writes no index, so nothing else tells two runs apart. The list scrolls in a window
// of its own past four and a half rows, so the cut row says there's more. The run in progress
// carries the live dot the ATC app picker's capture does, and can't be deleted, but its folder
// opens, for a problem the pilot is having now. A problem is reported by hand: we ask for the run's
// log.txt first, and for the recording only when the log isn't enough (same doc, A bug report).
// Open folder opens File Explorer on the desktop, behind the sim, where a pilot in VR won't see it,
// so its toast says where it opened. The heading's total is against the 1 GB the core keeps, the
// oldest runs deleted first.
type Run = { at: string; mb: number; now?: boolean }
const RUNS: Run[] = [
  { at: "Today, 14:02", mb: 86, now: true },
  { at: "Today, 09:40", mb: 212 },
  { at: "Yesterday, 21:15", mb: 301 },
  { at: "Yesterday, 18:48", mb: 18 },
  { at: "Oct 29, 20:05", mb: 129 },
  { at: "Oct 28, 19:30", mb: 97 },
  { at: "Oct 27, 21:10", mb: 64 },
]
const ROW = 36
function Recordings() {
  const { Button } = useUI()
  const [runs, setRuns] = useState(RUNS)
  const total = runs.reduce((n, r) => n + r.mb, 0)
  return (
    <Section
      title="Recordings"
      aside={`${total} MB of 1 GB`}
      foot={
        <>
          The oldest are deleted first. To report a problem, open the run's folder and send us its log.txt on{" "}
          <button type="button" onClick={() => toast("Opening our Discord in your browser")} className="underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            Discord
          </button>
          .
        </>
      }
    >
      <SettingsCard>
        <ScrollWindow max={ROW * 4.5}>
          <ul className="flex flex-col">
            {runs.map((r) => (
              <li key={r.at} className="flex min-h-8 items-baseline px-(--card-spacing) py-0.5">
                <span aria-hidden className="h-[21px] w-0 self-baseline" />
                <span className="flex flex-1 items-center gap-2 self-center text-sm">
                  {r.at}
                  {r.now && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="size-1.5 rounded-full bg-success" />
                      Recording
                    </span>
                  )}
                </span>
                <span className="ml-3 text-sm text-muted-foreground tabular-nums">{r.mb} MB</span>
                <span className="ml-3 flex items-center gap-1 self-center">
                  <Button size="icon-sm" variant="ghost" aria-label="Open folder" onClick={() => toast("Opened in File Explorer, on your desktop")}>
                    <FolderOpen />
                  </Button>
                  {r.now ? (
                    <span className="size-8" />
                  ) : (
                    <ConfirmButton
                      label={<Trash2 />}
                      question="Delete this recording?"
                      go="Delete"
                      align="end"
                      trigger={{ variant: "ghost", size: "icon-sm" }}
                      onConfirm={() => setRuns((all) => all.filter((x) => x !== r))}
                    />
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

// Dual Input itself: starting with Windows, on at first, and its version with the update's state
// (record/areas/install/01-installing-and-updating.md, Updates): up to date, with when it last
// checked and Check now; checking; downloading, and how far; ready; or failed, with the error and
// Try again. A ready update grows a box in the header's news tone, which installs it: the sim
// closes, the desktop app installs it, and starts the sim again (user, 2026-10-31), which asks
// first, since it ends the flight; in a session, the session holds the update, so the box says to
// leave first, and the header shows no update row. The header's View update opens this section,
// scrolled into view.
type Update = "current" | "checking" | "downloading" | "ready" | "failed"
function DualInput({ start, session, show }: { start: Update; session: boolean; show?: boolean }) {
  const { Button, Separator, Spinner } = useUI()
  const [update, setUpdate] = useState(start)
  const [checked, setChecked] = useState("12 minutes ago")
  const at = useRef<HTMLElement>(null)
  // Opened from the header, the page starts scrolled to show the section whole, its title kept in
  // view, with no scroll to watch, as a page opened onto a part would. The canvas can draw a frame
  // before it lays it out, so the place is set again each frame until it holds still.
  useEffect(() => {
    if (!show || !at.current) return
    const el = at.current
    let frame = 0
    let last = NaN
    const place = () => {
      let box = el.parentElement
      while (box && getComputedStyle(box).overflowY !== "auto") box = box.parentElement
      if (!box || !box.clientHeight) return void (frame = requestAnimationFrame(place))
      const zoom = box.getBoundingClientRect().height / box.clientHeight || 1
      const top = (el.getBoundingClientRect().top - box.getBoundingClientRect().top) / zoom + box.scrollTop
      box.scrollTop = Math.min(top - 20, top + el.offsetHeight + 20 - box.clientHeight)
      if (box.scrollTop !== last) {
        last = box.scrollTop
        frame = requestAnimationFrame(place)
      }
    }
    frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [show])
  const check = () => {
    setUpdate("checking")
    window.setTimeout(() => {
      setChecked("just now")
      setUpdate("current")
    }, 1500)
  }
  const note =
    update === "current" ? (
      `Up to date, checked ${checked}`
    ) : update === "checking" ? (
      <span className="flex items-center gap-1.5">
        <Spinner className="size-3" />
        Checking for updates
      </span>
    ) : update === "downloading" ? (
      `Downloading ${NEXT}, 42%`
    ) : update === "failed" ? (
      `Couldn't download ${NEXT}: the connection timed out`
    ) : undefined
  return (
    <Section title="Dual Input" at={at}>
      <SettingsCard>
        <SwitchRow label="Start with Windows" />
        <Separator className="my-2" />
        <Row label={`Version ${VERSION}`} note={note} tone={update === "failed" ? "text-destructive" : undefined}>
          {(update === "current" || update === "checking") && (
            <Button size="sm" variant="secondary" disabled={update === "checking"} onClick={check}>
              Check now
            </Button>
          )}
          {update === "failed" && (
            <Button size="sm" variant="secondary" onClick={check}>
              Try again
            </Button>
          )}
        </Row>
        {update === "downloading" && (
          <div className="mx-(--card-spacing) mt-1 mb-2 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: "42%" }} />
          </div>
        )}
        {update === "ready" && (
          <div className="mx-(--card-spacing) mt-1.5 mb-2 flex flex-col gap-3 rounded-xl bg-primary/10 px-4 py-3.5">
            <div className="flex items-baseline gap-2.5">
              <CircleArrowUp className="size-4 shrink-0 text-primary [transform:translateY(3px)]" />
              <span className="flex flex-col gap-1">
                <span className="text-sm font-medium text-primary">Dual Input {NEXT} is ready</span>
                <span className="text-sm text-foreground/75">{session ? "Leave the session to install it." : "The sim closes, Dual Input updates, and the sim starts again."}</span>
              </span>
            </div>
            {!session && (
              <div className="pl-6.5">
                <ConfirmButton label="Install and restart" {...RESTART_SIM} align="start" tone="primary" trigger={{ size: "sm" }} onConfirm={() => toast("Restarting the sim to update")} />
              </div>
            )}
          </div>
        )}
      </SettingsCard>
    </Section>
  )
}

function SettingsPage({ session, bound, device, update, show }: { session: boolean; bound: Key; device?: "missing"; update: Update; show?: boolean }) {
  const [key, setKey] = useState<string | undefined>(bound && bound !== "waiting" ? bound : undefined)
  useFlightAround(session, key)
  return (
    <ScrollPage>
      <TakeControlKey start={bound} onBound={setKey} />
      <OutputDevice missing={device === "missing"} />
      <Recordings />
      <DualInput start={update} session={session} show={show} />
    </ScrollPage>
  )
}

export function SettingsFrame({
  theme,
  session = true,
  bound = "F9",
  device,
  update = "current",
  show,
}: {
  theme: Theme
  session?: boolean
  bound?: Key
  device?: "missing"
  update?: Update
  show?: boolean
}) {
  const status: HeaderStatus = update === "ready" ? { update: NEXT } : {}
  return (
    <AppFrame theme={theme} tab="settings" status={status} fixed>
      <SettingsPage session={session} bound={bound} device={device} update={update} show={show} />
    </AppFrame>
  )
}
