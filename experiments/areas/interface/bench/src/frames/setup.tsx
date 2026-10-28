// The EFB app's first-time setup, designed from the user's sketch of 2026-10-26: one question, the
// display name, asked before the first Host or Join and pre-filled with the Windows username,
// which here is an example.
import { useState } from "react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame } from "./shell"

const WINDOWS_USERNAME = "jordan"

function Setup() {
  const { Button, Field, FieldDescription, Input } = useUI()
  const [name, setName] = useState(WINDOWS_USERNAME)
  return (
    <div className="flex flex-1 flex-col px-10 pb-10">
      <div className="flex flex-1 flex-col justify-center gap-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-semibold">Welcome to Dual Input</h1>
          <p className="text-sm text-muted-foreground">Pick a display name</p>
        </div>
        <Field>
          <Input aria-label="Display name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
          <FieldDescription>This will be shown to other pilots. We pre-filled your Windows username.</FieldDescription>
        </Field>
      </div>
      <Button size="lg" className="w-48 self-center" disabled={!name.trim()}>
        Continue
      </Button>
    </div>
  )
}

export function SetupFrame({ theme }: { theme: Theme }) {
  return (
    <AppFrame theme={theme} status={null} tabs={false}>
      <Setup />
    </AppFrame>
  )
}
