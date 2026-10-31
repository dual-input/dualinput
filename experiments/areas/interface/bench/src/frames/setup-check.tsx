// First-time setup as a short sequence: the welcome alone on the page, then a system check that
// runs one check at a time in one centered slot, stopping on a failure, then the pilot's crew card
// with a portrait of their figure (identity.tsx), which the Figures tab changes later. The checks'
// outcomes and the name are examples.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, Label, MarkTile } from "./shell"
import { IdentityCard, WINDOWS_USERNAME } from "./identity"
import { ConfirmButton, RESTART_SIM } from "./confirm"
import { FailureBox, SERVICE_NOT_RUNNING, toneOf, type Failure } from "./failure"


// How long each step of the sequence holds, in milliseconds.
const WELCOME_HOLD = 1600
const WELCOME_OUT = 450
const CHECK_ENTER = 220
// Each check runs for a slightly different time, so the sequence doesn't tick like a metronome.
const CHECK_RUN_MIN = 250
const CHECK_RUN_SPREAD = 600
const CHECK_HOLD = 700
// A checked item drifts up and fades on an ease-in-out curve, which starts gently, so it leaves
// calmly rather than looking yanked off the page, as an ease-out curve made it look.
const CHECK_HANDOFF = 450
const FIX_WAIT = 1400

// Its name throughout, since the icon beside it says how the check went. A failure stops the
// sequence, so it has time for its box under the check.
type Check = { name: string; fail?: Failure }

type CheckId = "core" | "addon" | "servers" | "firewall"
// The servers check fails in two ways the pilot can tell apart: their PC offline, which Windows
// reports, or our servers out of reach while the internet works. The backend down and both relays
// down share one failure, since before a session either one stops the pilot hosting or joining;
// the core's log and the header tell them apart. One relay down passes, since cores home at the
// other one.
export type CheckFailure = "core" | "addon" | "offline" | "servers" | "firewall"
const CHECK_OF: Record<CheckFailure, CheckId> = { core: "core", addon: "addon", offline: "servers", servers: "servers", firewall: "firewall" }

const FAILURES: Record<CheckFailure, Failure> = {
  core: SERVICE_NOT_RUNNING,
  // The EFB app is part of the add-on, so the add-on loaded; it can only be from another version,
  // since the sim loads add-ons when it starts and Dual Input updates while it's closed.
  addon: {
    title: "Add-on version mismatch",
    detail: "The sim loaded version 1.0.1 of Dual Input's add-on when Dual Input is 1.0.2. Restart the sim to load the right one.",
    action: { kind: "restart", label: "Restart the sim", busy: "Closing the sim" },
  },
  offline: {
    title: "Your PC seems offline",
    detail: "Dual Input needs an internet connection. Check your setup?",
    action: { kind: "wait", busy: "Waiting for a connection" },
    skippable: true,
  },
  servers: {
    title: "Can't reach our servers",
    detail: "You won't be able to host or join a session until they are back online. Sorry!",
    action: { kind: "wait", busy: "Waiting for our servers" },
    skippable: true,
  },
  firewall: {
    title: "Windows Firewall is blocking Dual Input",
    detail: "You can still connect through our relay servers, but with more latency.",
    action: { kind: "fix", label: "Fix", busy: "Waiting for Windows" },
    skippable: true,
  },
}

const CHECK_ORDER: { name: string; id: CheckId }[] = [
  { name: "Dual Input service", id: "core" },
  { name: "Dual Input sim add-on", id: "addon" },
  { name: "Our servers", id: "servers" },
  { name: "Windows Firewall", id: "firewall" },
]

function checksOf(failure?: CheckFailure): Check[] {
  return CHECK_ORDER.map((c) => ({ name: c.name, fail: failure && c.id === CHECK_OF[failure] ? FAILURES[failure] : undefined }))
}

type Phase =
  | { kind: "welcome"; out: boolean }
  | { kind: "checks"; i: number; step: "enter" | "run" | "result" | "handoff"; failed?: boolean; fixing?: boolean; skipped: number[] }
  | { kind: "card" }

function Welcome({ out }: { out: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center transition-opacity ease-out" style={{ opacity: out ? 0 : 1, transitionDuration: `${WELCOME_OUT}ms` }}>
      <h1 className="flex animate-in items-baseline gap-2 text-2xl font-semibold duration-700 fade-in slide-in-from-bottom-3">
        Welcome to
        <span className="flex items-baseline gap-1.5 text-primary">
          <MarkTile />
          Dual Input
        </span>
      </h1>
    </div>
  )
}

type CheckState = "run" | "ok" | "failed" | "skipped"

// One check in the slot: it rises in, and on a handoff lifts up and fades as the next rises in
// beneath it.
function CheckRow({ check, state, leaving, delay = 0 }: { check: Check; state: CheckState; leaving?: boolean; delay?: number }) {
  const { Spinner } = useUI()
  return (
    <div
      className="absolute inset-x-0 top-0 flex animate-in items-center justify-center gap-3 transition-all fade-in slide-in-from-bottom-4"
      style={{
        animationDuration: `${CHECK_ENTER}ms`,
        animationDelay: `${delay}ms`,
        animationFillMode: "backwards",
        transitionDuration: `${CHECK_HANDOFF}ms`,
        transitionTimingFunction: "cubic-bezier(0.45, 0, 0.55, 1)",
        ...(leaving ? { opacity: 0, transform: "translateY(-24px)" } : {}),
      }}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        {state === "run" && <Spinner className="size-5 text-muted-foreground" />}
        {state === "ok" && <CircleCheck className="size-5 animate-in text-success duration-200 zoom-in-50" />}
        {state === "failed" &&
          (check.fail?.skippable ? (
            <TriangleAlert className="size-5 animate-in text-warning duration-200 zoom-in-50" />
          ) : (
            <CircleX className="size-5 animate-in text-destructive duration-200 zoom-in-50" />
          ))}
        {state === "skipped" && <TriangleAlert className="size-5 text-warning" />}
      </span>
      <span className={"text-lg transition-colors " + (state === "run" ? "text-muted-foreground" : "")}>{check.name}</span>
    </div>
  )
}

function Checks({ checks, phase, onFix, onSkip }: { checks: Check[]; phase: Extract<Phase, { kind: "checks" }>; onFix: () => void; onSkip: () => void }) {
  const { Button, Spinner } = useUI()
  const { i, step } = phase
  const state: CheckState = step === "enter" || step === "run" ? "run" : phase.failed ? "failed" : phase.skipped.includes(i) ? "skipped" : "ok"
  const failing = phase.failed ? checks[i].fail : undefined

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-12">
      <Label>System check</Label>
      <div className="relative mt-6 h-7 w-full">
        <CheckRow key={i} check={checks[i]} state={state} leaving={step === "handoff"} />
        {/* The next check waits until the last one is about half faded, so the two don't sit on top of each other. */}
        {step === "handoff" && i + 1 < checks.length && <CheckRow key={i + 1} check={checks[i + 1]} state="run" delay={CHECK_HANDOFF * 0.45} />}
      </div>
      {/* The whole group stays centered. A failure's words grow in from no height, so the group
          glides up to make room rather than jumping. */}
      <div className="grid w-full transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: phase.failed ? "1fr" : "0fr" }}>
      <div className="flex min-h-0 flex-col items-center gap-3 overflow-hidden text-center">
        <span className="h-3 shrink-0" />
        {failing && (
          <FailureBox failure={failing}>
            {/* Continue anyway is bare text, a link, so the fix is the box's one button; alone under
                the waiting line, a button's unseen padding would also leave the box's bottom 8px
                deeper than its top. */}
            {failing.action.kind === "wait" && failing.skippable && (
              <Button variant="link" className={"h-auto border-0 p-0 " + toneOf(failing).text} onClick={onSkip}>
                Continue anyway
              </Button>
            )}
            {failing.action.kind !== "wait" && (
              // A link has no padding of its own, so it sits further from the button than a ghost button would.
              <div className="flex items-center gap-4">
                {/* A restart asks first, since it closes the sim; once agreed, the button shows it's busy as any fix's does. */}
                {failing.action.kind === "restart" && !phase.fixing ? (
                  <ConfirmButton label={failing.action.label!} {...RESTART_SIM} onConfirm={onFix} className={toneOf(failing).button} tone={toneOf(failing).tone} />
                ) : (
                  <Button className={toneOf(failing).button} onClick={onFix} disabled={phase.fixing}>
                    {phase.fixing ? (
                      <>
                        <Spinner data-icon="inline-start" /> {failing.action.busy}
                      </>
                    ) : (
                      failing.action.label
                    )}
                  </Button>
                )}
                {failing.skippable && !phase.fixing && (
                  <Button variant="link" className={"h-auto border-0 p-0 " + toneOf(failing).text} onClick={onSkip}>
                    Continue anyway
                  </Button>
                )}
              </div>
            )}
          </FailureBox>
        )}
      </div>
      </div>
    </div>
  )
}

function CrewCard() {
  const { Button } = useUI()
  const [name, setName] = useState(WINDOWS_USERNAME)
  const [hue, setHue] = useState("orange")
  const form = useRef<HTMLFormElement>(null)
  return (
    <form
      ref={form}
      className="flex flex-1 animate-in flex-col justify-center gap-6 px-8 duration-500 fade-in zoom-in-95"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) toast(`Continued as ${name.trim()}`)
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">How should others see you?</h2>
        <p className="text-sm text-muted-foreground">Pick a name and a color for your figure.</p>
      </div>
      <IdentityCard name={name} onName={setName} hue={hue} onHue={setHue} region={form} focus />
      <p className="text-xs text-muted-foreground">
        We pre-filled your Windows username.
        <br />
        You can change both later on the Figures tab.
      </p>
      <Button type="submit" size="lg" className="w-full" disabled={!name.trim()}>
        Continue
      </Button>
    </form>
  )
}

// A frame for a failure opens on it, and the crew card's frame on the card, so their look and words
// can be judged without waiting for the sequence.
function SetupFlow({ failure, openOnFailure, openOnCard }: { failure?: CheckFailure; openOnFailure?: boolean; openOnCard?: boolean }) {
  const checks = useMemo(() => checksOf(failure), [failure])
  const runFor = useMemo(() => checks.map(() => CHECK_RUN_MIN + Math.random() * CHECK_RUN_SPREAD), [checks])
  const failingAt = failure ? CHECK_ORDER.findIndex((c) => c.id === CHECK_OF[failure]) : -1
  const [phase, setPhase] = useState<Phase>(
    openOnCard
      ? { kind: "card" }
      : openOnFailure && failingAt >= 0
        ? { kind: "checks", i: failingAt, step: "result", failed: true, skipped: [] }
        : { kind: "welcome", out: false },
  )
  const [fixed, setFixed] = useState(false)

  useEffect(() => {
    let timer = 0
    const after = (ms: number, next: Phase) => (timer = window.setTimeout(() => setPhase(next), ms))
    if (phase.kind === "welcome") after(phase.out ? WELCOME_OUT : WELCOME_HOLD, phase.out ? { kind: "checks", i: 0, step: "enter", skipped: [] } : { kind: "welcome", out: true })
    if (phase.kind === "checks") {
      const failing = !!checks[phase.i].fail && !fixed && !phase.skipped.includes(phase.i)
      if (phase.step === "enter") after(CHECK_ENTER, { ...phase, step: "run" })
      if (phase.step === "run") after(runFor[phase.i], { ...phase, step: "result", failed: failing })
      if (phase.step === "result" && !phase.failed) after(CHECK_HOLD, { ...phase, step: "handoff" })
      if (phase.step === "handoff") after(CHECK_HANDOFF, phase.i + 1 < checks.length ? { ...phase, i: phase.i + 1, step: "run" } : { kind: "card" })
    }
    return () => window.clearTimeout(timer)
  }, [phase, fixed, checks, runFor])

  if (phase.kind === "welcome") return <Welcome out={phase.out} />
  if (phase.kind === "checks")
    return (
      <Checks
        checks={checks}
        phase={phase}
        onFix={() => {
          const action = checks[phase.i].fail?.action.kind
          // Checking again runs the check afresh, which passes here, as if the pilot fixed it.
          if (action === "retry") {
            setFixed(true)
            setPhase({ ...phase, failed: false, step: "run" })
            return
          }
          setPhase({ ...phase, fixing: true })
          // A restart closes the sim, and the EFB app with it, so the mockup stays on "Closing the sim".
          if (action === "restart") return
          window.setTimeout(() => {
            setFixed(true)
            setPhase({ ...phase, fixing: false, failed: false })
          }, FIX_WAIT)
        }}
        onSkip={() => setPhase({ ...phase, failed: false, skipped: [...phase.skipped, phase.i] })}
      />
    )
  return <CrewCard />
}

export function SetupFlowFrame({ theme, failure, openOnFailure, openOnCard }: { theme: Theme; failure?: CheckFailure; openOnFailure?: boolean; openOnCard?: boolean }) {
  return (
    <AppFrame theme={theme} header={false} tabs={false}>
      <SetupFlow failure={failure} openOnFailure={openOnFailure} openOnCard={openOnCard} />
    </AppFrame>
  )
}
