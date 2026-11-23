// The Dual Input panel with no extension behind it: the panel in a frame of VS Code's secondary side bar, on the
// stand-in for the extension, beside its named scenes and toggles for VS Code's theme and the side bar's width. A scene
// named in the address, as `?scene=Pick%20displays`, is the one it starts on, as on the other apps' dev pages.

import { useEffect, useRef, useState } from "react"
import type { ReactNode, Ref } from "react"
import { createRoot } from "react-dom/client"

import { Button, Root } from "@dualinput/ui"

import { Panel } from "../src/panel.tsx"
import type { Palette } from "../src/view.ts"
import { SCENES, standIn } from "./stand-in.ts"
import type { Scene } from "./stand-in.ts"

/** The side bar's widths to look at: about the 300px it opens at, and narrower and wider, since an author can drag its edge. */
const WIDTHS = [240, 300, 400]

/** VS Code 1.147's Dark Modern and Light Modern colors around a view (read in VS Code 1.147.0, `theme-defaults/themes/dark_modern.json` and `light_modern.json`). */
const VS_CODE: Record<Palette, { editor: string; sideBar: string; border: string; title: string }> = {
  dark: { editor: "#1f1f1f", sideBar: "#181818", border: "#2b2b2b", title: "#cccccc" },
  light: { editor: "#ffffff", sideBar: "#f8f8f8", border: "#e5e5e5", title: "#3b3b3b" },
}

const asked = new URLSearchParams(window.location.search).get("scene")
const FIRST = asked !== null && asked in SCENES ? asked : "Run, a switch"

/** The side bar as VS Code draws it, with the editor's edge beside it and the view's title over the webview, styled inline since the kit's classes reach only inside a root. */
function SideBar({ palette, width, shot, children }: { palette: Palette; width: number; shot: Ref<HTMLDivElement>; children: ReactNode }) {
  const colors = VS_CODE[palette]
  return (
    <div ref={shot} style={{ display: "flex", flexShrink: 0, height: 760, background: colors.editor, boxShadow: "0 0 0 1px rgba(127,127,127,0.25)" }}>
      <div style={{ width: 96 }} />
      <div style={{ width, display: "flex", flexDirection: "column", background: colors.sideBar, borderLeft: `1px solid ${colors.border}` }}>
        <div style={{ height: 35, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 8px 0 20px", color: colors.title, font: "11px/35px 'Segoe UI', sans-serif", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          <span style={{ flex: 1 }}>Dual Input</span>
          <span style={{ fontSize: 16, letterSpacing: 1 }}>···</span>
        </div>
        {/* The webview, which the panel fills and scrolls within. */}
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{children}</div>
      </div>
    </div>
  )
}

function Page() {
  const [name, setName] = useState(FIRST)
  const [scene, setScene] = useState<Scene>(SCENES[FIRST]!)
  const [palette, setPalette] = useState<Palette>("dark")
  const [width, setWidth] = useState(300)
  const [heard, setHeard] = useState<string[]>([])
  const shot = useRef<HTMLDivElement>(null)
  // The stand-in's calls land after a render, so it reads the scene as it stands, not as it was when it was made.
  const latest = useRef(scene)
  latest.current = scene
  const [host] = useState(() =>
    standIn(
      () => latest.current,
      (next) => {
        latest.current = next
        setScene(next)
      },
      (call) => setHeard((calls) => [call, ...calls].slice(0, 6)),
    ),
  )
  const show = (next: string) => {
    setName(next)
    setScene(SCENES[next]!)
    setHeard([])
  }
  // The handle tools/screenshots.ts drives on the other apps' pages: the scenes by name, a jump to one, and the element its picture is of.
  useEffect(() => {
    Object.assign(window, { DUALINPUT_DEV: { scenes: Object.keys(SCENES), show, shot: shot.current } })
  })
  return (
    <div style={{ display: "flex", alignItems: "flex-start", padding: 24, minHeight: "100vh", boxSizing: "border-box", background: "#0a0a0a" }}>
      <SideBar palette={palette} width={width} shot={shot}>
        {/* A new key per scene, so a scene's value field starts from its own text. */}
        <Panel key={name} view={{ ...scene, palette }} host={host} />
      </SideBar>
      <Root>
        <div className="ml-6 max-w-xl space-y-3 text-sm text-foreground">
          <div className="flex flex-wrap">
            {Object.keys(SCENES).map((one) => (
              <Button key={one} size="xs" variant={one === name ? "default" : "ghost"} className="mb-1 mr-1" onClick={() => show(one)}>
                {one}
              </Button>
            ))}
          </div>
          <div className="space-x-1">
            {(["dark", "light"] as const).map((one) => (
              <Button key={one} size="xs" variant={palette === one ? "default" : "outline"} onClick={() => setPalette(one)}>
                {one}
              </Button>
            ))}
            {WIDTHS.map((one) => (
              <Button key={one} size="xs" variant={width === one ? "default" : "outline"} onClick={() => setWidth(one)}>
                {one}px
              </Button>
            ))}
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            {heard.length ? heard.map((call, at) => <p key={at}>{call}</p>) : <p>The panel's calls on the extension show here.</p>}
          </div>
        </div>
      </Root>
    </div>
  )
}

createRoot(document.getElementById("page") as HTMLElement).render(<Page />)
