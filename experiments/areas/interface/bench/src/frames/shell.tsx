// What every frame of the EFB app shares: its size, the header, the tab bar, the small label,
// and the frame that gives a page the theme and the preset's components.
import { Check, CircleX, Headset, PersonStanding, Plane, Settings as Gear, Users } from "lucide-react"

import { ThemeContext, UI, UIContext } from "@/bench/ui"
import { themeVars, type Theme } from "@/bench/theme"

// The sim's EFB sizes its apps from a 516 by 716 base (record/areas/interface/log.md, 2026-10-24).
export const EFB = { width: 516, height: 716 }

const TABS = [
  { id: "session", icon: Users, label: "Session" },
  { id: "traffic", icon: Plane, label: "Traffic" },
  { id: "atc", icon: Headset, label: "ATC audio" },
  { id: "avatars", icon: PersonStanding, label: "Avatars" },
  { id: "settings", icon: Gear, label: "Settings" },
]

// Dual Input's mark: two lines merging into one, two pilots' inputs flying one aircraft. The user
// picked it on 2026-10-28, from the marks of the 2026-10-24 apps design page.
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M4 8.5C12 8.5 13.5 16 20.5 16M4 23.5C12 23.5 13.5 16 20.5 16H28" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" />
    </svg>
  )
}

// The mark cut out of a sky-300 tile, sized in em so the tile stands as tall as a capital letter
// beside it: Geist's capital D measured 0.75em tall. Set it on the text's baseline, which flexbox
// takes from the tile's bottom edge only while the tile has no content in flow, so the mark sits
// absolutely inside it. The stroke is heavier than the mark's own, since the mark inside is only
// about 10px at text-xl.
export function MarkTile() {
  return (
    <span className="relative inline-block shrink-0 rounded-[0.16em] bg-primary text-background" style={{ width: "0.75em", height: "0.75em" }}>
      <svg viewBox="0 0 32 32" fill="none" aria-hidden className="absolute inset-0 m-auto" style={{ width: "0.5em", height: "0.5em" }}>
        <path d="M4 8.5C12 8.5 13.5 16 20.5 16M4 23.5C12 23.5 13.5 16 20.5 16H28" stroke="currentColor" strokeWidth={4.5} strokeLinecap="round" />
      </svg>
    </span>
  )
}

export function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>
}

// The header's status: the sim, and whether Dual Input supports the loaded aircraft. Setup shows none.
export type HeaderStatus = { aircraft: "supported" | "unsupported" } | null

export function Header({ status }: { status: HeaderStatus }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-4 select-none">
      <Mark className="size-4 text-primary" />
      <span className="text-sm font-medium">Dual Input</span>
      <span className="text-xs text-muted-foreground">v1.0.2</span>
      {status && (
        <div className="ml-auto flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            Sim <Check className="size-3.5 text-success" />
          </span>
          {status.aircraft === "supported" ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              Aircraft <Check className="size-3.5 text-success" />
            </span>
          ) : (
            <span className="flex items-center gap-1 text-destructive">
              Aircraft <CircleX className="size-3.5" />
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export function TabBar() {
  return (
    <nav className="flex h-14 shrink-0 border-t">
      {TABS.map(({ id, icon: Icon, label }, i) => (
        <button key={id} title={label} className={"relative flex flex-1 items-center justify-center outline-none hover:text-foreground " + (i === 0 ? "text-primary" : "text-muted-foreground")}>
          {i === 0 && <span className="absolute inset-x-4 -top-px h-0.5 rounded-full bg-primary" />}
          <Icon className="size-5" />
        </button>
      ))}
    </nav>
  )
}

// A frame of the EFB app. It's the EFB's height at least, and grows past it for a page that
// shows more than one screen holds, such as the preflight page with the UI kit.
export function AppFrame({ theme, status, header = true, tabs = true, children }: { theme: Theme; status: HeaderStatus; header?: boolean; tabs?: boolean; children: React.ReactNode }) {
  const ui = UI[theme.preset] ?? UI.nova
  return (
    <ThemeContext.Provider value={theme}>
      <UIContext.Provider value={ui}>
        <div
          className="dark flex flex-col overflow-hidden rounded-xl border bg-background font-sans text-foreground shadow-2xl"
          style={{ ...(themeVars(theme) as React.CSSProperties), width: EFB.width, minHeight: EFB.height }}
        >
          {header && <Header status={status} />}
          <div className="flex flex-1 flex-col">{children}</div>
          {tabs && <TabBar />}
        </div>
      </UIContext.Provider>
    </ThemeContext.Provider>
  )
}
