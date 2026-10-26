// The EFB app designed from the user's sketches of 2026-10-26: first-time setup, the home page in
// each of its variants, and preflight, at the EFB's app size, laid out as one frame per state for
// design review. The sketches set the direction, not the details. The aircraft, the authors'
// notes, the crew, and the checklist's items are examples.
import { useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle, Check, ChevronDown, CircleX, Copy, Diamond, Headset, LogOut, Maximize2, PersonStanding, Plane, Settings as Gear, UserPlus, Users,
} from "lucide-react"

import { ThemeContext, UI, UIContext, useUI } from "@/bench/ui"
import { color, themeVars, type Theme } from "@/bench/theme"
import { AtcAudio, Avatars, Settings, StatusChip, Traffic } from "@/bench/screens"

// The sim's EFB sizes its apps from a 516 by 716 base (record/areas/interface/log.md, 2026-10-24).
export const EFB = { width: 516, height: 716 }

export type EfbState = {
  screen: "setup" | "home" | "preflight"
  firstTime: boolean
  aircraft: "supported" | "unsupported"
  notes: boolean
  crew: "alone" | "full"
  adam: "ready" | "not-ready" | "other-aircraft" | "link-lost"
  // Whether this pilot is the pilot flying, which a host alone always is.
  flying: boolean
  // The crew's card folded to one line, so the checklist takes the page.
  folded: boolean
  youReady?: boolean
  countdown?: boolean
}

const BASE: EfbState = {
  screen: "setup", firstTime: true, aircraft: "supported", notes: true, crew: "alone", adam: "not-ready", flying: true, folded: false,
}
const frame = (group: string, label: string, patch: Partial<EfbState>) => ({ group, label, state: { ...BASE, ...patch } })

// Every state the sketches draw, plus the crew's cases the record names, one frame each.
export const FRAMES = [
  frame("Setup and home", "First-time setup", {}),
  frame("Setup and home", "Home, first time", { screen: "home" }),
  frame("Setup and home", "Home, first time, unsupported aircraft", { screen: "home", aircraft: "unsupported" }),
  frame("Setup and home", "Home, notes from the profile's authors", { screen: "home", firstTime: false }),
  frame("Setup and home", "Home, no notes", { screen: "home", firstTime: false, notes: false }),
  frame("Setup and home", "Home, unsupported aircraft", { screen: "home", firstTime: false, aircraft: "unsupported" }),
  frame("Preflight", "Nobody joined yet", { screen: "preflight" }),
  frame("Preflight", "Crew, you flying", { screen: "preflight", crew: "full" }),
  frame("Preflight", "Adam in another aircraft", { screen: "preflight", crew: "full", adam: "other-aircraft" }),
  frame("Preflight", "Adam's link lost, you ready", { screen: "preflight", crew: "full", adam: "link-lost", youReady: true }),
  frame("Preflight", "You not flying", { screen: "preflight", crew: "full", flying: false, adam: "ready" }),
  frame("Preflight", "Everyone ready, the countdown", { screen: "preflight", crew: "full", adam: "ready", youReady: true, countdown: true }),
  frame("Preflight", "Crew folded, checklist expanded", { screen: "preflight", crew: "full", adam: "other-aircraft", folded: true }),
]
export const FRAME_GROUPS = [...new Set(FRAMES.map((f) => f.group))]

const LOADED = { name: "Black Square Baron 58P", short: "Baron 58P", maturity: "Stable" }
const UNSUPPORTED = { name: "Fenix A320", short: "Fenix A320" }
const SUPPORTED = [
  { name: "Black Square Baron 58P", maturity: "Stable" },
  { name: "Synaptic A220", maturity: "Stable" },
  { name: "A2A Simulations PA24-250 Comanche", maturity: "Experimental" },
]
const DISPLAY_NAME = "Jordan"
// An example Windows username, as the first-time setup pre-fills it.
const WINDOWS_USERNAME = "jordan"

// Dual Input's own items, state sync's counted controls, go to the pilot flying alone; the
// profile's authors' items go to every pilot.
const STARTING_VALUES = [{ text: "Set speed to 80." }]
const AUTHORS_ITEMS = [
  { text: "Ensure every pilot has identical state in the DisplayUnits panel, so sync can start from an equal point.", learn: true },
  { text: "In the tablet, set the radios the same for every pilot." },
  { text: "Set the tablet's failure rate to 0 on every machine." },
]

const TABS = [
  { id: "session", icon: Users, label: "Session" },
  { id: "traffic", icon: Plane, label: "Traffic" },
  { id: "atc", icon: Headset, label: "ATC" },
  { id: "avatars", icon: PersonStanding, label: "Avatars" },
  { id: "settings", icon: Gear, label: "Settings" },
] as const
type Tab = (typeof TABS)[number]["id"]

// The small uppercase label that heads a group, as in shadcn's own sections.
function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={"text-[11px] font-medium tracking-wider text-muted-foreground uppercase " + className}>{children}</span>
}

function StateDot({ level }: { level: "success" | "trouble" | "muted" }) {
  const fill = { success: "bg-success", trouble: "bg-destructive", muted: "bg-muted-foreground/50" }[level]
  return <span className={"size-1.5 shrink-0 rounded-full " + fill} />
}

function Header({ s }: { s: EfbState }) {
  const aircraftOk = s.screen === "preflight" || s.aircraft === "supported"
  const aircraft = s.screen === "preflight" || aircraftOk ? LOADED.short : UNSUPPORTED.short
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 select-none">
      <span className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Diamond className="size-3.5" strokeWidth={2.5} />
      </span>
      <span className="text-sm font-semibold tracking-tight">Dual Input</span>
      <span className="text-[11px] text-muted-foreground tabular-nums">1.0.2</span>
      {s.screen !== "setup" && (
        <div className="ml-auto flex items-center gap-1.5">
          <span className="flex h-6 items-center gap-1.5 rounded-full bg-muted/60 px-2.5 text-xs text-muted-foreground">
            <StateDot level="success" /> Sim
          </span>
          <span
            className={"flex h-6 max-w-40 items-center gap-1.5 rounded-full px-2.5 text-xs " + (aircraftOk ? "bg-muted/60 text-muted-foreground" : "bg-destructive/15 text-destructive")}
            title={aircraftOk ? "Supported aircraft" : "Not supported"}
          >
            <StateDot level={aircraftOk ? "success" : "trouble"} />
            <span className="truncate">{aircraft}</span>
          </span>
        </div>
      )}
    </header>
  )
}

function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav className="grid h-16 shrink-0 grid-cols-5 border-t px-2">
      {TABS.map(({ id, icon: Icon, label }) => {
        const on = tab === id
        return (
          <button
            key={id}
            onClick={() => onTab(id)}
            className={"group flex flex-col items-center justify-center gap-1 outline-none " + (on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <span className={"flex h-7 w-12 items-center justify-center rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring " + (on ? "bg-primary/15 text-primary" : "")}>
              <Icon className="size-[18px]" />
            </span>
            <span className="text-[11px] font-medium">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function Setup() {
  const { Button, Field, FieldLabel, FieldDescription, Input } = useUI()
  const [name, setName] = useState(WINDOWS_USERNAME)
  return (
    <div className="flex h-full flex-col px-10 pt-16 pb-10">
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Diamond className="size-7" strokeWidth={2} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Welcome to Dual Input</h1>
          <p className="text-sm text-muted-foreground">Pick a display name</p>
        </div>
      </div>
      <Field className="mt-10">
        <FieldLabel htmlFor="efb-display-name">Display name</FieldLabel>
        <Input id="efb-display-name" className="h-11 text-base" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
        <FieldDescription>This will be shown to other pilots. We pre-filled your Windows username.</FieldDescription>
      </Field>
      <Button size="lg" className="mt-auto h-11 w-full" disabled={!name.trim()}>
        Continue
      </Button>
    </div>
  )
}

function AircraftTile({ supported }: { supported: boolean }) {
  return (
    <span className={"flex size-10 shrink-0 items-center justify-center rounded-xl " + (supported ? "bg-muted text-foreground" : "bg-destructive/15 text-destructive")}>
      <Plane className="size-5" />
    </span>
  )
}

function StartCard({ supported }: { supported: boolean }) {
  const { Button, Card, CardContent, Separator, InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } = useUI()
  const [joining, setJoining] = useState(false)
  const [code, setCode] = useState("")
  const aircraft = supported ? LOADED : UNSUPPORTED
  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        <AircraftTile supported={supported} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{aircraft.name}</span>
          <span className="text-xs text-muted-foreground">{supported ? `Supported · ${LOADED.maturity}` : "Not supported yet"}</span>
        </div>
      </CardContent>
      <Separator />
      <CardContent>
        {joining ? (
          <div className="flex flex-col gap-3">
            <Eyebrow>Invite code</Eyebrow>
            <div className="flex items-center justify-between gap-3">
              <InputOTP maxLength={6} value={code} onChange={(v: string) => setCode(v.toUpperCase())}>
                <InputOTPGroup>
                  {[0, 1, 2].map((i) => (
                    <InputOTPSlot key={i} index={i} className="size-10 font-mono text-base" />
                  ))}
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  {[3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} className="size-10 font-mono text-base" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" size="lg" onClick={() => setJoining(false)}>
                Cancel
              </Button>
              <Button size="lg" disabled={code.length < 6}>
                Join
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" className="h-11">
              Host
            </Button>
            <Button size="lg" variant="outline" className="h-11" onClick={() => setJoining(true)}>
              Join
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SeeHow() {
  return (
    <a href="#" onClick={(e) => e.preventDefault()} className="font-medium text-primary underline-offset-4 hover:underline">
      see how
    </a>
  )
}

function SupportedList() {
  const { Card, CardContent, Separator } = useUI()
  return (
    <section className="flex flex-col gap-2">
      <Eyebrow className="px-1">Supported aircraft</Eyebrow>
      <Card size="sm">
        <CardContent className="flex flex-col gap-0">
          {SUPPORTED.map((a, i) => (
            <div key={a.name} className="flex flex-col">
              {i > 0 && <Separator />}
              <div className="flex items-center justify-between gap-3 py-2.5">
                <span className="truncate text-sm">{a.name}</span>
                <StatusChip level={a.maturity === "Stable" ? "success" : "warning"}>{a.maturity}</StatusChip>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}

// The order of a first session, as v1's scope walks it (record/areas/product/03-v1-scope.md).
const FIRST_STEPS = ["Host, and share the invite code with your crew.", "Your crew joins and loads the flight at your stand.", "Everyone works through the checklist and presses Ready."]

function Welcome({ supported }: { supported: boolean }) {
  return (
    <section className="flex flex-col gap-3 px-1">
      <h2 className="text-lg font-semibold tracking-tight">Welcome, {DISPLAY_NAME}.</h2>
      {supported ? (
        <>
          <p className="text-sm text-muted-foreground">Looks like you've already loaded an aircraft supported by Dual Input. Click Host above and share the invite code with someone to start flying together.</p>
          <ol className="mt-1 flex flex-col gap-2.5">
            {FIRST_STEPS.map((step, i) => (
              <li key={step} className="flex items-start gap-3 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium tabular-nums">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Looks like you've loaded an aircraft that Dual Input doesn't support yet. You can switch to a supported aircraft from the list below, or get your hands dirty building a profile for the {UNSUPPORTED.name} (<SeeHow />).
        </p>
      )}
    </section>
  )
}

function Unsupported() {
  return (
    <section className="flex flex-col gap-2 px-1 text-sm">
      <h2 className="text-lg font-semibold tracking-tight">Unsupported aircraft</h2>
      <p className="text-muted-foreground">
        Dual Input has no profile for the {UNSUPPORTED.name} yet, so its switches and displays won't sync. You can still fly it together: its movement, control, traffic, and ATC sync.
      </p>
      <p className="text-muted-foreground">
        Switch to a supported aircraft from the list below, or get your hands dirty building a profile for it (<SeeHow />).
      </p>
    </section>
  )
}

function Notes() {
  const { Card, CardContent } = useUI()
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <Eyebrow>Notes from the profile's authors</Eyebrow>
        <span className="text-[11px] text-muted-foreground">{LOADED.short}</span>
      </div>
      <Card size="sm">
        <CardContent className="flex flex-col gap-3 text-sm leading-relaxed">
          <p>Set the tablet's failure rate to 0 on every machine before you fly, since each sim rolls its own failures.</p>
          <ul className="flex flex-col gap-2 text-muted-foreground">
            <li className="flex gap-2.5">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />A pilot who joins late starts the ADF's elapsed timer at 0.
            </li>
            <li className="flex gap-2.5">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
              The KNS-81's 10 waypoints don't sync, so enter them on each machine.
            </li>
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}

function NoNotes() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-12 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
        <Plane className="size-7" />
      </span>
      <p className="text-sm text-muted-foreground">Click Host and share the invite code with someone to start flying together.</p>
    </div>
  )
}

// Host and Join stay in an unsupported aircraft, since a session there still flies it: flight-model
// sync, control, traffic, and ATC run, and only what the profile names stays idle
// (record/areas/product/03-v1-scope.md, Preflight match check).
function Home({ s }: { s: EfbState }) {
  const supported = s.aircraft === "supported"
  return (
    <div className="flex min-h-full flex-col gap-6 p-4">
      <StartCard supported={supported} />
      {s.firstTime ? <Welcome supported={supported} /> : !supported ? <Unsupported /> : s.notes ? <Notes /> : <NoNotes />}
      {!supported && <SupportedList />}
    </div>
  )
}

type Member = { name: string; hue: string; you?: boolean; flying: boolean; detail: string; state: "ready" | "not-ready" | "cant" | "lost" }

function crewOf(s: EfbState, ready: boolean): Member[] {
  const flying = s.crew === "alone" || s.flying
  const you: Member = { name: DISPLAY_NAME, hue: "orange", you: true, flying, detail: flying ? "Pilot flying" : "In the flight", state: ready ? "ready" : "not-ready" }
  if (s.crew === "alone") return [you]
  const adam: Member = {
    name: "Adam",
    hue: "green",
    flying: false,
    detail: { ready: "Direct · 40ms", "not-ready": "Direct · 40ms", "other-aircraft": "In the A320", "link-lost": "Link lost 0:42 ago" }[s.adam],
    state: s.adam === "ready" ? "ready" : s.adam === "other-aircraft" ? "cant" : s.adam === "link-lost" ? "lost" : "not-ready",
  }
  return [you, { name: "James", hue: "red", flying: !flying, detail: flying ? "Relay · 120ms" : "Pilot flying · Relay · 120ms", state: "ready" }, adam]
}

function differencesOf(s: EfbState) {
  if (s.crew === "alone") return []
  const list: { level: "error" | "warning"; text: string; then?: string }[] = []
  if (s.adam === "other-aircraft") list.push({ level: "error", text: `Adam is in the A320, not the ${LOADED.short}.`, then: `He loads the ${LOADED.short} to fly with the crew.` })
  list.push({ level: "error", text: "Adam runs version 2.1.2 of the aircraft, and you run 2.1.3.", then: "Adam updates it." })
  list.push({ level: "warning", text: "Different liveries.", then: "Each pilot sees their own." })
  return list
}

function Avatar({ m, size = "md" }: { m: Member; size?: "md" | "sm" }) {
  const box = size === "md" ? "size-9 text-sm" : "size-7 text-xs"
  return (
    <span className={"relative flex shrink-0 items-center justify-center rounded-full font-semibold text-neutral-950 " + box} style={{ background: color(m.hue, 300) }}>
      {m.name[0]}
      {size === "sm" && m.state !== "not-ready" && (
        <span className={"absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full ring-2 ring-card " + (m.state === "ready" ? "bg-success" : "bg-destructive")}>
          {m.state === "ready" ? <Check className="size-2.5" strokeWidth={3} /> : <span className="h-0.5 w-1.5 rounded-full bg-neutral-950" />}
        </span>
      )}
    </span>
  )
}

function MemberState({ m }: { m: Member }) {
  if (m.state === "ready") return <StatusChip level="success">Ready</StatusChip>
  if (m.state === "cant") return <StatusChip level="trouble">Can't fly</StatusChip>
  if (m.state === "lost") return <StatusChip level="trouble">Link lost</StatusChip>
  return <span className="text-xs text-muted-foreground">Not ready</span>
}

function Leave() {
  const ui = useUI()
  const { Button, AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } = ui
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>
        <LogOut data-icon="inline-start" /> Leave
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave the session?</AlertDialogTitle>
          <AlertDialogDescription>You can join again with the same code.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Leave</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CopyButton({ label }: { label?: boolean }) {
  const { Button } = useUI()
  return (
    <Button variant="secondary" size={label ? "sm" : "icon-sm"} title="Copy the invite code" onClick={() => toast("Copied the invite code")}>
      <Copy data-icon={label ? "inline-start" : undefined} />
      {label && "Copy"}
    </Button>
  )
}

function ReadyAction({ ready, countdown, onReady }: { ready: boolean; countdown?: boolean; onReady: () => void }) {
  const { Button, Progress } = useUI()
  if (countdown)
    return (
      <div className="flex flex-col gap-2.5 rounded-2xl bg-success/10 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-success">Everyone's ready. Starting in 3s.</span>
          <Button variant="ghost" size="sm" onClick={onReady}>
            Not ready
          </Button>
        </div>
        <Progress value={33} className="[&_[data-slot=progress-indicator]]:bg-success" />
      </div>
    )
  return ready ? (
    <Button size="lg" variant="secondary" className="h-11 w-full" onClick={onReady}>
      <Check data-icon="inline-start" className="text-success" /> You're ready · Undo
    </Button>
  ) : (
    <Button size="lg" className="h-11 w-full" onClick={onReady}>
      Ready
    </Button>
  )
}

function Checklist({ flying, folded, onFold }: { flying: boolean; folded: boolean; onFold: () => void }) {
  const { Badge, Button, Card, CardContent, Checkbox, Separator } = useUI()
  const [done, setDone] = useState<Set<string>>(() => new Set())
  const items = [...(flying ? STARTING_VALUES : []), ...AUTHORS_ITEMS]
  const toggle = (t: string) => setDone((d) => (d.has(t) ? (d.delete(t), new Set(d)) : new Set(d.add(t))))
  const row = (c: { text: string; learn?: boolean }, flyingOnly?: boolean) => (
    <label key={c.text} className="flex cursor-pointer items-start gap-3 py-2.5 text-sm">
      <Checkbox className="mt-0.5" checked={done.has(c.text)} onCheckedChange={() => toggle(c.text)} />
      <span className={"flex-1 " + (done.has(c.text) ? "text-muted-foreground line-through decoration-muted-foreground/50" : "")}>
        {c.text}{" "}
        {c.learn && (
          <a href="#" onClick={(e) => e.preventDefault()} className="font-medium text-primary underline-offset-4 hover:underline">
            Learn more
          </a>
        )}
      </span>
      {flyingOnly && <Badge variant="outline">Pilot flying</Badge>}
    </label>
  )
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-baseline gap-2">
          <Eyebrow>Preflight checklist</Eyebrow>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {done.size} of {items.length}
          </span>
        </div>
        {!folded && (
          <Button variant="ghost" size="icon-sm" title="Give the checklist the page" onClick={onFold}>
            <Maximize2 />
          </Button>
        )}
      </div>
      <Card size="sm">
        <CardContent className="flex flex-col gap-0">
          {flying && (
            <>
              <span className="pt-1 text-xs text-muted-foreground">Starting values, from Dual Input</span>
              {STARTING_VALUES.map((c) => row(c, true))}
              <Separator className="my-1" />
              <span className="pt-2 text-xs text-muted-foreground">From the {LOADED.short} profile's authors</span>
            </>
          )}
          {AUTHORS_ITEMS.map((c) => row(c))}
        </CardContent>
      </Card>
    </section>
  )
}

function Preflight({ s }: { s: EfbState }) {
  const { Button, Card, CardContent, Separator } = useUI()
  const [ready, setReady] = useState(s.youReady ?? false)
  const [folded, setFolded] = useState(s.folded)
  const crew = crewOf(s, ready)
  const differences = differencesOf(s)
  const readyCount = crew.filter((m) => m.state === "ready").length
  const flying = crew[0].flying
  const toggleReady = () => setReady((r) => !r)

  return (
    <div className="flex flex-col gap-6 p-4">
      {folded ? (
        <Card size="sm">
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-base font-medium tracking-[0.12em]">K7R-4XM</span>
              <CopyButton />
              <div className="ml-auto flex items-center gap-2">
                <div className="flex -space-x-1.5">
                  {crew.map((m) => (
                    <span key={m.name} className="rounded-full ring-2 ring-card" title={`${m.name}: ${m.state}`}>
                      <Avatar m={m} size="sm" />
                    </span>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {readyCount} of {crew.length} ready
                </span>
              </div>
            </div>
            {differences[0] && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {differences[0].level === "error" ? <CircleX className="size-3.5 shrink-0 text-destructive" /> : <AlertTriangle className="size-3.5 shrink-0 text-warning" />}
                <span className="truncate">{differences[0].text}</span>
                {differences.length > 1 && <span className="shrink-0">+{differences.length - 1} more</span>}
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <ReadyAction ready={ready} countdown={s.countdown} onReady={toggleReady} />
              </div>
              <Button variant="ghost" size="icon-lg" title="Show the crew" onClick={() => setFolded(false)}>
                <ChevronDown />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Eyebrow>Invite code</Eyebrow>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[28px] leading-none font-medium tracking-[0.12em]">K7R-4XM</span>
                <CopyButton label />
              </div>
            </div>
            <Leave />
          </CardContent>
          <Separator />
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Eyebrow>Crew</Eyebrow>
              <span className="text-xs text-muted-foreground tabular-nums">
                Preflight · {readyCount} of {crew.length} ready
              </span>
            </div>
            <ul className="flex flex-col gap-3">
              {crew.map((m) => (
                <li key={m.name} className="flex items-center gap-3">
                  <Avatar m={m} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {m.name}
                      {m.you && <span className="font-normal text-muted-foreground"> (you)</span>}
                    </span>
                    <span className={"truncate text-xs " + (m.state === "cant" || m.state === "lost" ? "text-destructive" : "text-muted-foreground")}>{m.detail}</span>
                  </div>
                  {m.state === "lost" && (
                    <Button variant="outline" size="sm" disabled={!ready} title={ready ? undefined : "Press Ready first"}>
                      Go without
                    </Button>
                  )}
                  <MemberState m={m} />
                </li>
              ))}
              {s.crew === "alone" && (
                <li className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground">
                    <UserPlus className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm text-muted-foreground">Waiting for your crew</span>
                    <span className="text-xs text-muted-foreground">Send them the invite code above.</span>
                  </div>
                </li>
              )}
            </ul>
            {differences.length > 0 && (
              <ul className="flex flex-col gap-2.5 rounded-2xl bg-muted/50 p-3">
                {differences.map((d) => (
                  <li key={d.text} className="flex items-start gap-2.5 text-sm">
                    {d.level === "error" ? <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />}
                    <span>
                      {d.text} {d.then && <span className="text-muted-foreground">{d.then}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <ReadyAction ready={ready} countdown={s.countdown} onReady={toggleReady} />
          </CardContent>
        </Card>
      )}

      <Checklist flying={flying} folded={folded} onFold={() => setFolded(true)} />
    </div>
  )
}

type Props = { theme: Theme; state: EfbState }

export function EfbApp({ theme, state: s }: Props) {
  const ui = UI[theme.preset] ?? UI.nova
  const [tab, setTab] = useState<Tab>("session")

  const page = () => {
    if (s.screen === "setup") return <Setup />
    switch (tab) {
      case "traffic":
        return <Traffic />
      case "atc":
        return <AtcAudio />
      case "avatars":
        return <Avatars />
      case "settings":
        return <Settings />
    }
    return s.screen === "home" ? <Home s={s} /> : <Preflight s={s} />
  }

  return (
    <ThemeContext.Provider value={theme}>
      <UIContext.Provider value={ui}>
        <div
          className="dark flex flex-col overflow-hidden rounded-[28px] border bg-background font-sans text-foreground shadow-2xl"
          style={{ ...(themeVars(theme) as React.CSSProperties), width: EFB.width, height: EFB.height }}
        >
          <Header s={s} />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{page()}</div>
          {s.screen !== "setup" && <TabBar tab={tab} onTab={setTab} />}
        </div>
      </UIContext.Provider>
    </ThemeContext.Provider>
  )
}
