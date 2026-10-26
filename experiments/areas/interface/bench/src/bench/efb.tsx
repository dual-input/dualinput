// The EFB app as the user's sketches of 2026-10-26 draw it: first-time setup, the home page in
// each of its variants, and preflight, at the EFB's app size, with a state for every variant the
// sketches show. The aircraft, the authors' notes, and the checklist's items are examples; the
// words follow the sketches where they have words.
import { useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, Check, ChevronDown, CircleDashed, CircleX, Copy, Diamond, Headset, LogOut, Maximize2, PersonStanding, Plane, Settings as Gear, Users, X } from "lucide-react"

import { ThemeContext, UI, UIContext, useUI } from "./ui"
import { color, themeVars, type Theme } from "./theme"
import { AtcAudio, Avatars, Settings, StatusChip, Traffic } from "./screens"

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
}

export const DEFAULT_EFB: EfbState = {
  screen: "setup", firstTime: true, aircraft: "supported", notes: true, crew: "alone", adam: "not-ready", flying: true, folded: false,
}

const UNSUPPORTED = "Fenix A320"
const SUPPORTED = [
  { name: "Black Square Baron 58P", maturity: "Stable" },
  { name: "Synaptic A220", maturity: "Stable" },
  { name: "A2A Simulations PA24-250 Comanche", maturity: "Experimental" },
]

// One list, from two sources: Dual Input's own items, such as state sync's counted controls,
// which only the pilot flying sees, and the profile's authors', which every pilot sees.
const CHECKLIST = [
  { text: "Ensure every pilot has identical state in the DisplayUnits panel, so sync can start from an equal point.", learn: true },
  { text: "Set speed to 80.", flyingOnly: true },
  { text: "In the BKSQ tablet, set the radios the same for every pilot." },
  { text: "Load the same fuel and payload on every machine." },
]

const TABS = [
  { id: "session", icon: Users, label: "Session" },
  { id: "traffic", icon: Plane, label: "Traffic" },
  { id: "atc", icon: Headset, label: "ATC audio" },
  { id: "avatars", icon: PersonStanding, label: "Avatars" },
  { id: "settings", icon: Gear, label: "Settings" },
] as const
type Tab = (typeof TABS)[number]["id"]

function Header({ chips, aircraftOk }: { chips: boolean; aircraftOk: boolean }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-4 select-none">
      <Diamond className="size-4 text-primary" />
      <span className="text-sm font-medium">Dual Input</span>
      <span className="text-xs text-muted-foreground">v1.0.2</span>
      {chips && (
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            Sim <Check className="size-3.5 text-success" />
          </span>
          <span className={"flex items-center gap-1 " + (aircraftOk ? "" : "text-destructive")}>
            Aircraft {aircraftOk ? <Check className="size-3.5 text-success" /> : <CircleX className="size-3.5" />}
          </span>
        </div>
      )}
    </div>
  )
}

function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav className="flex h-12 shrink-0 border-t">
      {TABS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          title={label}
          onClick={() => onTab(id)}
          className={"relative flex flex-1 items-center justify-center transition-colors outline-none hover:text-foreground focus-visible:bg-accent " + (tab === id ? "text-primary" : "text-muted-foreground")}
        >
          {tab === id && <span className="absolute inset-x-4 -top-px h-0.5 rounded-full bg-primary" />}
          <Icon className="size-5" />
        </button>
      ))}
    </nav>
  )
}

function Setup({ name, onName, onContinue }: { name: string; onName: (n: string) => void; onContinue: () => void }) {
  const { Button, Field, FieldDescription, Input } = useUI()
  return (
    <div className="flex h-full flex-col px-10 pb-10">
      <div className="flex flex-1 flex-col justify-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-semibold">Welcome to Dual Input</h1>
          <p className="text-sm text-muted-foreground">Pick a display name</p>
        </div>
        <Field>
          <Input id="efb-display-name" aria-label="Display name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onName(e.target.value)} />
          <FieldDescription>This will be shown to other pilots. We pre-filled your Windows username.</FieldDescription>
        </Field>
      </div>
      <Button size="lg" className="w-40 self-center" disabled={!name.trim()} onClick={onContinue}>
        Continue
      </Button>
    </div>
  )
}

function HostJoin({ onHost, onJoin }: { onHost: () => void; onJoin: () => void }) {
  const { Button, Card, CardContent, InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } = useUI()
  const [joining, setJoining] = useState(false)
  const [code, setCode] = useState("")
  return (
    <Card>
      <CardContent className="flex min-h-16 flex-wrap items-center gap-3">
        {joining ? (
          <>
            <InputOTP maxLength={6} value={code} onChange={(v: string) => setCode(v.toUpperCase())}>
              <InputOTPGroup>
                {[0, 1, 2].map((i) => (
                  <InputOTPSlot key={i} index={i} className="font-mono" />
                ))}
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                {[3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} className="font-mono" />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <Button disabled={code.length < 6} onClick={onJoin}>
              Join
            </Button>
            <Button variant="ghost" onClick={() => setJoining(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="lg" className="w-32" onClick={onHost}>
              Host
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setJoining(true)}>
              Join
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function SeeHow() {
  return (
    <a href="#" onClick={(e) => e.preventDefault()} className="text-primary underline-offset-4 hover:underline">
      see how
    </a>
  )
}

function SupportedList() {
  const { Badge } = useUI()
  return (
    <div className="flex flex-col gap-3 rounded-3xl bg-muted/50 p-5">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Supported aircraft</h2>
      <ul className="flex flex-col gap-2.5">
        {SUPPORTED.map((a) => (
          <li key={a.name} className="flex flex-wrap items-center gap-2 text-sm">
            {a.name} <Badge variant="secondary">{a.maturity}</Badge>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Welcome({ name, supported }: { name: string; supported: boolean }) {
  return (
    <section className="flex flex-col gap-3 text-sm">
      <h2 className="text-base font-semibold">Welcome to Dual Input, {name}.</h2>
      {supported ? (
        <p>Looks like you've already loaded an aircraft supported by Dual Input. Click Host above and share the invite code with someone to start flying together.</p>
      ) : (
        <p>
          Looks like you've loaded an aircraft that's currently not supported by Dual Input. You can switch to a supported aircraft from the list below or get your hands dirty building a profile for {UNSUPPORTED} (<SeeHow />).
        </p>
      )}
    </section>
  )
}

function Notes() {
  return (
    <section className="flex flex-col gap-3 text-sm">
      <h2 className="text-base font-semibold">Notes from the profile authors</h2>
      <p>Set the tablet's failure rate to 0 on every machine before you fly, since each sim rolls its own failures.</p>
      <ul className="flex list-disc flex-col gap-1.5 pl-5">
        <li>A pilot who joins late starts the ADF's elapsed timer at 0.</li>
        <li>The KNS-81's 10 waypoints don't sync, so enter them on each machine.</li>
      </ul>
    </section>
  )
}

function NoNotes() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-10 text-center text-sm text-muted-foreground">
      <Plane className="size-16 stroke-1" />
      <p>Click Host and share the invite code with someone to start flying together.</p>
    </div>
  )
}

function Unsupported() {
  return (
    <section className="flex flex-col gap-3 text-sm">
      <h2 className="text-base font-semibold">Unsupported aircraft</h2>
      <p>{UNSUPPORTED} is currently not supported by Dual Input.</p>
      <p>
        You can switch to a supported aircraft from the list below or get your hands dirty building a profile for it (<SeeHow />).
      </p>
    </section>
  )
}

// Host and Join stay in an unsupported aircraft, since a session there still flies it: flight-model
// sync, control, traffic, and ATC run, and only what the profile names stays idle
// (record/areas/product/03-v1-scope.md, Preflight match check).
function Home({ s, name, onHost, onJoin }: { s: EfbState; name: string; onHost: () => void; onJoin: () => void }) {
  const supported = s.aircraft === "supported"
  return (
    <div className="flex h-full flex-col gap-6 p-5">
      <HostJoin onHost={onHost} onJoin={onJoin} />
      {s.firstTime ? <Welcome name={name} supported={supported} /> : !supported ? <Unsupported /> : s.notes ? <Notes /> : <NoNotes />}
      {!supported && <SupportedList />}
    </div>
  )
}

type Member = { name: string; hue: string; flying: boolean; link?: string; state: "ready" | "not-ready" | "cant" | "lost" }

function crewOf(s: EfbState, ready: boolean): Member[] {
  const flying = s.crew === "alone" || s.flying
  const you: Member = { name: "You", hue: "orange", flying, state: ready ? "ready" : "not-ready" }
  if (s.crew === "alone") return [you]
  const adam: Member = {
    name: "Adam",
    hue: "green",
    flying: false,
    link: s.adam === "link-lost" ? undefined : "Direct · 40ms",
    state: s.adam === "ready" ? "ready" : s.adam === "other-aircraft" ? "cant" : s.adam === "link-lost" ? "lost" : "not-ready",
  }
  return [you, { name: "James", hue: "red", flying: !flying, link: "Relay · 120ms", state: "ready" }, adam]
}

function differencesOf(s: EfbState) {
  if (s.crew === "alone") return []
  const list: { level: "error" | "warning"; text: string }[] = []
  if (s.adam === "other-aircraft") list.push({ level: "error", text: "Adam is in the A320, not the session's Baron 58P." })
  list.push({ level: "error", text: "Adam runs version 2.1.2 of the aircraft, and you run 2.1.3." })
  list.push({ level: "warning", text: "Different liveries." })
  return list
}

function ReadyButton({ ready, onReady }: { ready: boolean; onReady: () => void }) {
  const { Button } = useUI()
  return (
    <Button size="sm" variant={ready ? "default" : "outline"} onClick={onReady}>
      {ready && <Check data-icon="inline-start" />} Ready
    </Button>
  )
}

function MemberState({ m }: { m: Member }) {
  const { Badge } = useUI()
  if (m.state === "ready") return <StatusChip level="success">Ready</StatusChip>
  if (m.state === "cant") return <StatusChip level="trouble">Can't fly</StatusChip>
  if (m.state === "lost") return <StatusChip level="trouble">Link lost</StatusChip>
  return <Badge variant="ghost">Not ready</Badge>
}

function Leave({ onLeave }: { onLeave: () => void }) {
  const ui = useUI()
  const { Button, AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } = ui
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        Leave <LogOut data-icon="inline-end" />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave the session?</AlertDialogTitle>
          <AlertDialogDescription>You can join again with the same code.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onLeave}>
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CopyCode({ big }: { big?: boolean }) {
  const { Button } = useUI()
  return (
    <div className="flex items-center gap-1.5">
      <span className={"font-mono tracking-wider " + (big ? "text-2xl font-medium" : "text-base")}>K7R-4XM</span>
      <Button variant="ghost" size="icon-sm" title="Copy the invite code" onClick={() => toast("Copied the invite code")}>
        <Copy />
      </Button>
    </div>
  )
}

function Preflight({ s, ready, onReady, onFold, onLeave }: { s: EfbState; ready: boolean; onReady: () => void; onFold: (folded: boolean) => void; onLeave: () => void }) {
  const { Badge, Button, Card, CardContent, Checkbox, Separator } = useUI()
  const crew = crewOf(s, ready)
  const differences = differencesOf(s)
  const dropped = crew.find((m) => m.state === "lost")
  const flying = crew[0].flying
  // Only a pilot who's ready can go without one who dropped out (record/areas/product/03-v1-scope.md, Preflight).
  const goWithout = dropped && (
    <Button variant="outline" size="sm" disabled={!ready} title={ready ? undefined : "Press Ready first"}>
      Go without {dropped.name}
    </Button>
  )

  return (
    <div className="flex flex-col gap-6 p-5">
      {s.folded ? (
        <Card size="sm">
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <CopyCode />
              <div className="flex items-center gap-1.5">
                {crew.map((m) => (
                  <span key={m.name} title={m.name} className="flex size-6 items-center justify-center rounded-full text-white" style={{ background: color(m.hue, 400) }}>
                    {m.name !== "You" && (m.state === "ready" ? <Check className="size-3.5" /> : m.state === "cant" || m.state === "lost" ? <X className="size-3.5" /> : null)}
                  </span>
                ))}
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-2">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground">
                {differences[0] && (
                  <>
                    {differences[0].level === "error" ? <CircleX className="size-4 shrink-0 text-destructive" /> : <AlertTriangle className="size-4 shrink-0 text-warning" />}
                    <span className="truncate">{differences[0].text}</span>
                  </>
                )}
              </span>
              {goWithout}
              <ReadyButton ready={ready} onReady={onReady} />
              <Button variant="ghost" size="icon-sm" title="Show the crew" onClick={() => onFold(false)}>
                <ChevronDown />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Invite code</span>
              <CopyCode big />
            </div>
            <Leave onLeave={onLeave} />
          </CardContent>
          <Separator />
          <CardContent className="flex flex-col gap-3">
            <span className="text-xs text-muted-foreground">Crew</span>
            <ul className="flex flex-col gap-2.5">
              {crew.map((m) => (
                <li key={m.name} className="flex items-center gap-2.5">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: color(m.hue, 400) }} />
                  <span className="text-sm font-medium">{m.name}</span>
                  {m.flying && <Badge variant="secondary">Pilot flying</Badge>}
                  {m.link && <Badge variant="secondary" className="font-normal text-muted-foreground">{m.link}</Badge>}
                  <span className="ml-auto">{m.name === "You" ? <ReadyButton ready={ready} onReady={onReady} /> : <MemberState m={m} />}</span>
                </li>
              ))}
            </ul>
            {s.crew === "alone" && (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <CircleDashed className="size-4" /> Send the code above to invite others.
              </span>
            )}
            {differences.length > 0 && (
              <ul className="flex flex-col gap-1.5 pt-1 text-sm text-muted-foreground">
                {differences.map((d) => (
                  <li key={d.text} className="flex items-start gap-2">
                    {d.level === "error" ? <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />}
                    {d.text}
                  </li>
                ))}
              </ul>
            )}
            {goWithout && <div className="flex justify-end">{goWithout}</div>}
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Preflight checklist</h2>
          {!s.folded && (
            <Button variant="ghost" size="icon-sm" title="Give the checklist the page" onClick={() => onFold(true)}>
              <Maximize2 />
            </Button>
          )}
        </div>
        <ul className="flex flex-col gap-3">
          {CHECKLIST.filter((c) => flying || !c.flyingOnly).map((c) => (
            <li key={c.text}>
              <label className="flex items-start gap-3 text-sm">
                <Checkbox className="mt-0.5" />
                <span>
                  {c.text}{" "}
                  {c.learn && (
                    <a href="#" onClick={(e) => e.preventDefault()} className="text-primary underline-offset-4 hover:underline">
                      Learn more
                    </a>
                  )}
                  {c.flyingOnly && (
                    <Badge variant="outline" className="ml-1 align-middle">
                      Pilot flying
                    </Badge>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

type Props = { theme: Theme; state: EfbState; onState?: (patch: Partial<EfbState>) => void }

export function EfbApp({ theme, state: s, onState }: Props) {
  const ui = UI[theme.preset] ?? UI.nova
  const [tab, setTab] = useState<Tab>("session")
  // An example Windows username, as the first-time setup pre-fills it.
  const [name, setName] = useState("jordan")
  const [ready, setReady] = useState(false)
  const set = (patch: Partial<EfbState>) => onState?.(patch)

  const page = () => {
    if (s.screen === "setup") return <Setup name={name} onName={setName} onContinue={() => set({ screen: "home", firstTime: true })} />
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
    if (s.screen === "home")
      return <Home s={s} name={name.trim() || "pilot"} onHost={() => set({ screen: "preflight", crew: "alone", flying: true })} onJoin={() => set({ screen: "preflight", crew: "full", flying: false })} />
    return <Preflight s={s} ready={ready} onReady={() => setReady((r) => !r)} onFold={(folded) => set({ folded })} onLeave={() => (setReady(false), set({ screen: "home", firstTime: false, folded: false }))} />
  }

  return (
    <ThemeContext.Provider value={theme}>
      <UIContext.Provider value={ui}>
        <div
          className="dark flex flex-col overflow-hidden rounded-xl border bg-background font-sans text-foreground shadow-2xl"
          style={{ ...(themeVars(theme) as React.CSSProperties), width: EFB.width, height: EFB.height }}
        >
          <Header chips={s.screen !== "setup"} aircraftOk={s.screen === "preflight" || s.aircraft === "supported"} />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{page()}</div>
          {s.screen !== "setup" && <TabBar tab={tab} onTab={setTab} />}
        </div>
      </UIContext.Provider>
    </ThemeContext.Provider>
  )
}
