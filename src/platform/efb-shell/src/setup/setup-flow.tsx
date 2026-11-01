// First-time setup as a short sequence: the welcome alone on the page, then a system check that runs one check at
// a time in one centered slot, stopping on a failure, then the pilot's crew card with a portrait of their figure
// (record/areas/interface/decisions.md, "First-time setup asks for the name and color once, and checks the PC and
// our servers").

import { Button, Confirm, Link, Room, Spinner, useReveal } from "@dualinput/ui"
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { FailureBox } from "../lost-service.tsx"
import { MarkTile } from "../mark.tsx"
import { IdentityCard, NAME_MAX } from "./identity-card.tsx"

/** How long each step holds, in milliseconds. Each check runs for a slightly different time, so the sequence doesn't tick like a metronome. */
const STEP = { welcomeHold: 1600, welcomeOut: 450, enter: 220, runMin: 250, runSpread: 600, hold: 700, handoff: 450, fix: 1400 }

/** What a check failing looks like. A failure Dual Input can work around also offers Continue anyway, in amber rather than red. */
type Failure = { title: string; detail: string; action: { kind: "fix" | "restart" | "wait"; label?: string; busy: string }; skippable?: boolean }

export type SetupFailure = "addon" | "offline" | "servers" | "firewall"
export type SetupFacts = { failure?: SetupFailure; username: string; addonVersion?: string; version: string }

const failures = (facts: SetupFacts): Record<SetupFailure, Failure> => ({
  // The EFB app is part of the add-on, so the add-on loaded; it can only be from another version, since the sim loads add-ons when it starts and Dual Input updates while it's closed.
  addon: { title: "Add-on version mismatch", detail: `The sim loaded version ${facts.addonVersion} of Dual Input's add-on when Dual Input is ${facts.version}. Restart the sim to load the right one.`, action: { kind: "restart", label: "Restart the sim", busy: "Closing the sim" } },
  offline: { title: "Your PC seems offline", detail: "Dual Input needs an internet connection. Check your setup?", action: { kind: "wait", busy: "Waiting for a connection" }, skippable: true },
  servers: { title: "Can't reach our servers", detail: "You won't be able to host or join a session until they are back online. Sorry!", action: { kind: "wait", busy: "Waiting for our servers" }, skippable: true },
  firewall: { title: "Windows Firewall is blocking Dual Input", detail: "You can still connect through our relay servers, but with more latency.", action: { kind: "fix", label: "Fix", busy: "Waiting for Windows" }, skippable: true },
})

type Check = { name: string; id: "core" | "addon" | "servers" | "firewall" }
const CHECKS: Check[] = [
  { name: "Dual Input service", id: "core" },
  { name: "Dual Input sim add-on", id: "addon" },
  { name: "Our servers", id: "servers" },
  { name: "Windows Firewall", id: "firewall" },
]
const checkOf = (failure: SetupFailure): Check["id"] => (failure === "offline" ? "servers" : failure)

type Phase = { kind: "welcome"; out: boolean } | { kind: "checks"; index: number; step: "enter" | "run" | "result" | "handoff"; failed?: boolean; fixing?: boolean; skipped: number[] } | { kind: "card" }

function Welcome({ out }: { out: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center" style={{ opacity: out ? 0 : 1, transition: `opacity ${STEP.welcomeOut}ms ease-out` }}>
      <h1 className="flex items-baseline text-2xl font-semibold" style={{ animation: "dualinput-rise-in 700ms ease-out" }}>
        <span className="mr-2">Welcome to</span>
        <span className="flex items-baseline text-primary">
          <span className="mr-1.5">
            <MarkTile />
          </span>
          Dual Input
        </span>
      </h1>
    </div>
  )
}

type CheckState = "run" | "ok" | "failed" | "skipped"

/** One check in the slot: it rises in, and on a handoff lifts up and fades as the next rises in beneath it, on a curve that starts gently, so it leaves calmly rather than looking yanked off the page. */
function CheckRow({ name, state, skippable, leaving, delay = 0 }: { name: string; state: CheckState; skippable: boolean; leaving?: boolean; delay?: number }) {
  return (
    <div
      className="absolute inset-x-0 top-0 flex items-center justify-center"
      style={{ animation: `dualinput-rise-in ${STEP.enter}ms ease-out ${delay}ms backwards`, transition: `opacity ${STEP.handoff}ms cubic-bezier(0.45, 0, 0.55, 1), transform ${STEP.handoff}ms cubic-bezier(0.45, 0, 0.55, 1)`, ...(leaving ? { opacity: 0, transform: "translateY(-24px)" } : {}) }}
    >
      <span className="mr-3 flex size-5 shrink-0 items-center justify-center">
        {state === "run" && <Spinner className="size-5 text-muted-foreground" />}
        {state === "ok" && <CircleCheck className="size-5 animate-zoom-in text-success" />}
        {state === "failed" && (skippable ? <TriangleAlert className="size-5 animate-zoom-in text-warning" /> : <CircleX className="size-5 animate-zoom-in text-destructive" />)}
        {state === "skipped" && <TriangleAlert className="size-5 text-warning" />}
      </span>
      <span className={state === "run" ? "text-lg text-muted-foreground" : "text-lg"}>{name}</span>
    </div>
  )
}

function Checks({ phase, failing, onFix, onSkip }: { phase: Extract<Phase, { kind: "checks" }>; failing: Failure | undefined; onFix: () => void; onSkip: () => void }) {
  const { index: at, step } = phase
  const state: CheckState = step === "enter" || step === "run" ? "run" : phase.failed ? "failed" : phase.skipped.includes(at) ? "skipped" : "ok"
  const shown = useRef(failing)
  if (failing) shown.current = failing
  const reveal = useReveal(!!phase.failed)
  const box = shown.current
  const tone = box?.skippable ? "warning" : "danger"
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-12">
      <span className="text-xs text-muted-foreground">System check</span>
      <div className="relative mt-6 h-7 w-full">
        <CheckRow key={at} name={CHECKS[at]!.name} state={state} skippable={!!box?.skippable} leaving={step === "handoff"} />
        {/* The next check waits until the last one is about half faded, so the two don't sit on top of each other. */}
        {step === "handoff" && at + 1 < CHECKS.length && <CheckRow key={at + 1} name={CHECKS[at + 1]!.name} state="run" skippable={false} delay={STEP.handoff * 0.45} />}
      </div>
      {/* The whole group stays centered, so a failure's words grow in from no height, and the group glides up to make room. */}
      <div className="w-full">
        <Room open={reveal.open} style={reveal.style} pad="flex flex-col items-center pt-3">
          {box && (
            <FailureBox title={box.title} detail={box.detail} waiting={box.action.kind === "wait" ? box.action.busy : undefined} amber={box.skippable}>
              {box.action.kind === "wait" && box.skippable && (
                <Link className="mt-3 inline-block font-medium" tone="warning" onClick={onSkip}>
                  Continue anyway
                </Link>
              )}
              {box.action.kind !== "wait" && (
                <div className="mt-3 flex items-center justify-center">
                  {box.action.kind === "restart" && !phase.fixing ? (
                    <Confirm variant={tone} question="Restart the sim?" go="Restart now" onConfirm={onFix}>
                      {box.action.label}
                    </Confirm>
                  ) : (
                    <Button variant={tone} disabled={phase.fixing} onClick={onFix}>
                      {phase.fixing ? (
                        <>
                          <Spinner />
                          {box.action.busy}
                        </>
                      ) : (
                        box.action.label
                      )}
                    </Button>
                  )}
                  {box.skippable && !phase.fixing && (
                    <Link className="ml-4 font-medium" tone="warning" onClick={onSkip}>
                      Continue anyway
                    </Link>
                  )}
                </div>
              )}
            </FailureBox>
          )}
        </Room>
      </div>
    </div>
  )
}

function CrewCard({ username, onDone }: { username: string; onDone: (name: string, color: string) => void }) {
  const [name, setName] = useState(username.slice(0, NAME_MAX))
  const [color, setColor] = useState("orange")
  const form = useRef<HTMLFormElement>(null)
  return (
    <form
      ref={form}
      className="flex flex-1 animate-rise-in flex-col justify-center space-y-6 px-8"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) onDone(name.trim(), color)
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">How should others see you?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pick a name and a color for your figure.</p>
      </div>
      <IdentityCard name={name} onName={setName} color={color} onColor={setColor} region={form} focus />
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

export type SetupFlowProps = {
  facts: SetupFacts
  /** Asks the desktop app to fix the firewall, or the tray app to restart the sim. */
  onFix: (failure: SetupFailure) => void
  onDone: (name: string, color: string) => void
}

export function SetupFlow({ facts, onFix, onDone }: SetupFlowProps) {
  const failure = facts.failure
  const failingAt = failure ? CHECKS.findIndex((check) => check.id === checkOf(failure)) : -1
  const runFor = useMemo(() => CHECKS.map(() => STEP.runMin + Math.random() * STEP.runSpread), [])
  const [phase, setPhase] = useState<Phase>({ kind: "welcome", out: false })
  const [fixed, setFixed] = useState(false)
  // A failure the pilot fixes outside Dual Input clears by itself, and the sequence goes on once it does.
  const stillFailing = !fixed && !!failure

  useEffect(() => {
    let timer = 0
    const after = (ms: number, next: Phase) => {
      timer = window.setTimeout(() => setPhase(next), ms)
    }
    if (phase.kind === "welcome") after(phase.out ? STEP.welcomeOut : STEP.welcomeHold, phase.out ? { kind: "checks", index: 0, step: "enter", skipped: [] } : { kind: "welcome", out: true })
    if (phase.kind === "checks") {
      const failing = stillFailing && phase.index === failingAt && !phase.skipped.includes(phase.index)
      if (phase.step === "enter") after(STEP.enter, { ...phase, step: "run" })
      if (phase.step === "run") after(runFor[phase.index]!, { ...phase, step: "result", failed: failing })
      if (phase.step === "result" && !phase.failed) after(STEP.hold, { ...phase, step: "handoff" })
      if (phase.step === "result" && phase.failed && !failing) setPhase({ ...phase, failed: false })
      if (phase.step === "handoff") after(STEP.handoff, phase.index + 1 < CHECKS.length ? { ...phase, index: phase.index + 1, step: "run" } : { kind: "card" })
    }
    return () => window.clearTimeout(timer)
  }, [phase, stillFailing, failingAt, runFor])

  if (phase.kind === "welcome") return <Welcome out={phase.out} />
  if (phase.kind === "checks") {
    const failing = failure && phase.index === failingAt ? failures(facts)[failure] : undefined
    return (
      <Checks
        phase={phase}
        failing={failing}
        onFix={() => {
          if (!failure) return
          onFix(failure)
          setPhase({ ...phase, fixing: true })
          // A restart closes the sim, and the EFB app with it, so it stays on its busy words.
          if (failing?.action.kind === "restart") return
          window.setTimeout(() => {
            setFixed(true)
            setPhase({ ...phase, fixing: false, failed: false })
          }, STEP.fix)
        }}
        onSkip={() => setPhase({ ...phase, failed: false, skipped: [...phase.skipped, phase.index] })}
      />
    )
  }
  return <CrewCard username={facts.username} onDone={onDone} />
}
