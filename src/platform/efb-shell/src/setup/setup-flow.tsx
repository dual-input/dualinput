// First-time setup as a short sequence: the welcome alone on the page, then the pilot's crew card with a portrait of
// their figure (record/areas/interface/decisions.md, "First-time setup greets the pilot and asks for the name and color
// once").

import { Button, MarkTile } from "@dualinput/ui"
import { useEffect, useRef, useState } from "react"

import { IdentityCard, NAME_MAX } from "./identity-card.tsx"

/** How long the greeting holds and fades, in milliseconds. */
const GREETING = { hold: 1600, out: 450 }

type Phase = { kind: "welcome"; out: boolean } | { kind: "card" }

/** The greeting. The desktop app's welcome, src/platform/desktop-shell/src/welcome.tsx, draws the same one with the same timings, so change both together. */
function Welcome({ out }: { out: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center" style={{ opacity: out ? 0 : 1, transition: `opacity ${GREETING.out}ms ease-out` }}>
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

function CrewCard({ username, onDone }: { username: string; onDone: (name: string, color: string) => void }) {
  const [name, setName] = useState(username.slice(0, NAME_MAX))
  // `FIRST_COLOR` in src/features/avatars/efb/part.tsx and `HomeRest`'s fallback in ../session/home-rest.tsx name the
  // same color, so change all three together.
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
  /** The Windows username, which the name field starts with. */
  username: string
  onDone: (name: string, color: string) => void
}

export function SetupFlow({ username, onDone }: SetupFlowProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "welcome", out: false })

  useEffect(() => {
    if (phase.kind !== "welcome") return
    const timer = window.setTimeout(() => setPhase(phase.out ? { kind: "card" } : { kind: "welcome", out: true }), phase.out ? GREETING.out : GREETING.hold)
    return () => window.clearTimeout(timer)
  }, [phase])

  if (phase.kind === "welcome") return <Welcome out={phase.out} />
  return <CrewCard username={username} onDone={onDone} />
}
