// The desktop app's window. Every screen a pilot uses Dual Input through is in the EFB app, so this holds only the desktop
// app's own (record/areas/interface/decisions.md, "Dual Input's one full window is its EFB app"). TODO: when the user has
// outlined its screens, build them here: the 24 hours of figures, what quitting costs, the first run's welcome, and the
// update's progress.

import { Root } from "@dualinput/ui"

export function DesktopWindow({ version }: { version: string }) {
  return (
    <Root>
      <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground">
        <h1 className="text-lg font-semibold">Dual Input</h1>
        <p className="mt-1 text-sm text-muted-foreground">Version {version}</p>
      </div>
    </Root>
  )
}
