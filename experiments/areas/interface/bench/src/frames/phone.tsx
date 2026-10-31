// One frame alone, fitted to the screen, for trying it by touch on a phone over the LAN (user,
// 2026-10-30): ?frame=worst, the default, ?frame=crewmate, or ?frame=dropped. It draws in the
// bench's default theme, since a phone has none saved.
import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "@fontsource/b612-mono/400.css"
import "../index.css"
import { TooltipProvider } from "@/components/ui/tooltip"
import { UI } from "@/bench/ui"
import { DEFAULT_THEME, themeVars } from "@/bench/theme"
import { EFB } from "./shell"
import { HomeLaterFrame, type SessionKey } from "./home"

const FRAMES: Record<string, SessionKey> = { worst: "preflight-worst", crewmate: "preflight-crew", dropped: "preflight-dropped" }

function Phone() {
  const session = FRAMES[new URLSearchParams(location.search).get("frame") ?? "worst"] ?? FRAMES.worst
  const fit = () => Math.min(innerWidth / EFB.width, innerHeight / EFB.height)
  const [zoom, setZoom] = useState(fit)
  useEffect(() => {
    const again = () => setZoom(fit())
    addEventListener("resize", again)
    return () => removeEventListener("resize", again)
  }, [])
  // Menus, dialogs, and toasts open at the document's root, outside the frame, so the root takes
  // the theme too.
  useEffect(() => {
    for (const [k, v] of Object.entries(themeVars(DEFAULT_THEME))) document.documentElement.style.setProperty(k, v)
  }, [])
  const Toaster = (UI[DEFAULT_THEME.preset] ?? UI.nova).Toaster
  return (
    <TooltipProvider>
      <div className="fixed inset-0 flex items-center justify-center bg-black">
        <div style={{ zoom, width: EFB.width }}>
          <HomeLaterFrame theme={DEFAULT_THEME} aircraft="supported" session={session} />
        </div>
      </div>
      {Toaster && <Toaster theme="dark" position="bottom-center" />}
    </TooltipProvider>
  )
}

createRoot(document.getElementById("root")!).render(<Phone />)
