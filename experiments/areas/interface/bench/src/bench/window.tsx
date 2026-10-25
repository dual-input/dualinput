// The desktop app's window as the user's sketch of 2026-10-25 draws it: a title bar, a row
// of status, the page, and a tab bar along the bottom, at the sketch's portrait size.
import { Diamond, Headset, Minus, PersonStanding, Plane, Settings as Gear, Square, Users, X } from "lucide-react"

import { ThemeContext, UI, UIContext } from "./ui"
import { themeVars, type Theme } from "./theme"
import { AtcAudio, Avatars, Components, Home, Join, Session, Settings, StatusRow, Traffic, type Status } from "./screens"

export type Screen = "home" | "join" | "session" | "traffic" | "atc" | "avatars" | "settings" | "components"
export const SCREENS: { id: Screen; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "join", label: "Join" },
  { id: "session", label: "Session" },
  { id: "traffic", label: "Traffic" },
  { id: "atc", label: "ATC audio" },
  { id: "avatars", label: "Avatars" },
  { id: "settings", label: "Settings" },
  { id: "components", label: "Every component" },
]

const TABS = [
  { id: "session", icon: Users, label: "Session" },
  { id: "traffic", icon: Plane, label: "Traffic" },
  { id: "atc", icon: Headset, label: "ATC audio" },
  { id: "avatars", icon: PersonStanding, label: "Avatars" },
  { id: "settings", icon: Gear, label: "Settings" },
] as const

export const WINDOW = { width: 600, height: 840 }

type Props = {
  theme: Theme
  screen: Screen
  status: Status
  inSession: boolean
  onScreen?: (s: Screen) => void
  onSession?: (on: boolean) => void
}

export function AppWindow({ theme, screen, status, inSession, onScreen, onSession }: Props) {
  const ui = UI[theme.preset] ?? UI.nova
  const go = (s: Screen) => onScreen?.(s)
  const tabOf = (s: Screen) => (s === "home" || s === "join" ? "session" : s)
  const page = () => {
    switch (screen) {
      case "home":
        return <Home onHost={() => (onSession?.(true), go("session"))} onJoin={() => go("join")} />
      case "join":
        return <Join onBack={() => go("home")} onJoined={() => (onSession?.(true), go("session"))} />
      case "session":
        return inSession ? <Session onLeave={() => (onSession?.(false), go("home"))} /> : <Home onHost={() => (onSession?.(true), go("session"))} onJoin={() => go("join")} />
      case "traffic":
        return <Traffic />
      case "atc":
        return <AtcAudio />
      case "avatars":
        return <Avatars />
      case "settings":
        return <Settings />
      case "components":
        return <Components />
    }
  }
  return (
    <ThemeContext.Provider value={theme}>
    <UIContext.Provider value={ui}>
      <div
        className="dark flex flex-col overflow-hidden rounded-xl border bg-background font-sans text-foreground shadow-2xl"
        style={{ ...(themeVars(theme) as React.CSSProperties), width: WINDOW.width, height: WINDOW.height }}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 pl-4 select-none">
          <Diamond className="size-4 text-primary" />
          <span className="text-sm font-medium">Dual Input</span>
          <span className="text-xs text-muted-foreground">v1.0.2</span>
          <div className="ml-auto flex h-full">
            {[Minus, Square, X].map((Icon, i) => (
              <span key={i} className={"flex w-11 items-center justify-center text-muted-foreground hover:bg-accent " + (i === 2 ? "hover:bg-destructive hover:text-white" : "")}>
                <Icon className={i === 1 ? "size-3" : "size-4"} />
              </span>
            ))}
          </div>
        </div>
        <StatusRow status={status} inSession={inSession} />
        <div className="min-h-0 flex-1 overflow-y-auto">{page()}</div>
        <nav className="flex h-14 shrink-0 border-t">
          {TABS.map(({ id, icon: Icon, label }) => {
            const on = tabOf(screen) === id
            return (
              <button
                key={id}
                title={label}
                onClick={() => go(id === "session" && !inSession ? "home" : id)}
                className={
                  "relative flex flex-1 items-center justify-center transition-colors outline-none hover:text-foreground focus-visible:bg-accent " +
                  (on ? "text-primary" : "text-muted-foreground")
                }
              >
                {on && <span className="absolute inset-x-4 -top-px h-0.5 rounded-full bg-primary" />}
                <Icon className="size-5" />
              </button>
            )
          })}
        </nav>
      </div>
    </UIContext.Provider>
    </ThemeContext.Provider>
  )
}
