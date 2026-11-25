// First-time setup: the pilot's crew card with a portrait of their figure, alone on the page
// (record/areas/interface/decisions.md, "First-time setup asks for the name and color once").

import { Button } from "@dualinput/ui"
import { useRef, useState } from "react"

import { IdentityCard, NAME_MAX } from "./identity-card.tsx"

export type SetupFlowProps = {
  /** The Windows username, which the name field starts with. */
  username: string
  onDone: (name: string, color: string) => void
}

export function SetupFlow({ username, onDone }: SetupFlowProps) {
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
