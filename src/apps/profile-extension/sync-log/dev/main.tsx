// The Sync log with no extension behind it: the log in a frame of VS Code's bottom panel, fed rows by hand, beside its
// named scenes and toggles for VS Code's theme and the panel's size. A scene named in the address, as
// `?scene=A%20row%20opened`, is the one it starts on, as on the other apps' dev pages.

import { useEffect, useRef, useState } from "react"
import type { ReactNode, Ref } from "react"
import { createRoot } from "react-dom/client"

import { Button, Root } from "@dualinput/ui"

import manifest from "../../package.json"
import { syntaxes } from "../../src/syntax.ts"
import { SyncLog } from "../src/sync-log.tsx"
import type { Palette, SyncLogHost } from "../src/view.ts"
import { SCENES } from "./scenes.ts"

/** The token colors the extension posts the log for each palette, read from the same manifest as it reads them. */
const SYNTAX = syntaxes(manifest)

/** The bottom panel's sizes to look at: a wide, short panel as it opens, a narrower one, and one dragged taller. */
const SIZES = [
  { name: "wide", width: 1100, height: 260 },
  { name: "narrow", width: 640, height: 260 },
  { name: "tall", width: 1100, height: 480 },
]

/** VS Code 1.147's Dark Modern and Light Modern colors around the panel (read in VS Code 1.147.0, `theme-defaults/themes/dark_modern.json` and `light_modern.json`). */
const VS_CODE: Record<Palette, { editor: string; panel: string; border: string; title: string; active: string; underline: string }> = {
  dark: { editor: "#1f1f1f", panel: "#181818", border: "#2b2b2b", title: "#9d9d9d", active: "#cccccc", underline: "#0078d4" },
  light: { editor: "#ffffff", panel: "#f8f8f8", border: "#e5e5e5", title: "#3b3b3b", active: "#3b3b3b", underline: "#005fb8" },
}

/** The panel's own views, whose tabs sit beside the Sync log's. */
const TABS = ["Problems", "Output", "Debug console", "Terminal", "Ports", "Sync log"]

/**
 * What this tab remembers across the reload `tools/dev.ts` makes after each edit, so you stay where you were reading:
 * the scene, and each scene's scroll. A browser can refuse session storage, as with its site data blocked, so a failed
 * read or write leaves the page to start afresh.
 */
function remembered(key: string): string | null {
  try {
    return window.sessionStorage.getItem(`sync-log-dev:${key}`)
  } catch {
    return null
  }
}

function remember(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(`sync-log-dev:${key}`, value)
  } catch {
    // The next reload starts afresh.
  }
}

/** The log's list inside the panel, the one element there that scrolls. */
function scrollerIn(root: HTMLElement): HTMLElement | null {
  const all = root.querySelectorAll<HTMLElement>("*")
  for (let at = 0; at < all.length; at++) {
    const one = all[at]!
    if (getComputedStyle(one).overflowY === "auto") return one
  }
  return null
}

const asked = new URLSearchParams(window.location.search).get("scene") ?? remembered("scene")
// The page opens on the scene the address names, or the one this tab last showed, and otherwise on every word of the
// log's copy, which the copy pass reviews in place.
const FIRST = asked !== null && asked in SCENES ? asked : "Every word"

/** The bottom panel as VS Code draws it, under the editor's edge, with its tabs over the webview, styled inline since the kit's classes reach only inside a root. */
function Panel({ palette, width, height, shot, children }: { palette: Palette; width: number; height: number; shot: Ref<HTMLDivElement>; children: ReactNode }) {
  const colors = VS_CODE[palette]
  return (
    <div ref={shot} style={{ display: "flex", flexDirection: "column", flexShrink: 0, width, background: colors.editor, boxShadow: "0 0 0 1px rgba(127,127,127,0.25)" }}>
      <div style={{ height: 72 }} />
      <div style={{ height, display: "flex", flexDirection: "column", background: colors.panel, borderTop: `1px solid ${colors.border}` }}>
        <div style={{ height: 35, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 8px", font: "11px/35px 'Segoe UI', sans-serif", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {TABS.map((tab) => (
            <span key={tab} style={{ margin: "0 10px", color: tab === "Sync log" ? colors.active : colors.title, borderBottom: `1px solid ${tab === "Sync log" ? colors.underline : "transparent"}`, lineHeight: "26px" }}>
              {tab}
            </span>
          ))}
        </div>
        {/* The webview, which the log fills and scrolls within. */}
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{children}</div>
      </div>
    </div>
  )
}

function Page() {
  const [name, setName] = useState(FIRST)
  const [palette, setPalette] = useState<Palette>("dark")
  // Tall is the size to judge a row's steps at, so the page opens on it.
  const [size, setSize] = useState(SIZES[2]!)
  const [heard, setHeard] = useState<string[]>([])
  const [rows, setRows] = useState(SCENES[FIRST]!.rows)
  const shot = useRef<HTMLDivElement>(null)
  const [host] = useState<SyncLogHost>(() => ({
    clear: () => {
      setRows([])
      setHeard((calls) => ["clear()", ...calls].slice(0, 6))
    },
    reveal: (entry) => setHeard((calls) => [`reveal(${JSON.stringify(entry)})`, ...calls].slice(0, 6)),
  }))
  const show = (next: string) => {
    setName(next)
    setRows(SCENES[next]!.rows)
    setHeard([])
    remember("scene", next)
  }
  // The log scrolls itself to its newest row as it draws, so the scene's saved place goes back after that, twice, since
  // an open row's steps can still be drawing at the first.
  useEffect(() => {
    const scroller = shot.current && scrollerIn(shot.current)
    if (!scroller) return
    const key = `scroll:${name}`
    const saved = remembered(key)
    const timers = saved === null ? [] : [100, 400].map((ms) => window.setTimeout(() => (scroller.scrollTop = Number(saved)), ms))
    const save = () => remember(key, String(scroller.scrollTop))
    scroller.addEventListener("scroll", save)
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      scroller.removeEventListener("scroll", save)
    }
  }, [name])
  // The handle tools/screenshots.ts drives on the other apps' pages: the scenes by name, a jump to one, and the element its picture is of.
  useEffect(() => {
    Object.assign(window, { DUALINPUT_DEV: { scenes: Object.keys(SCENES), show, shot: shot.current } })
  })
  const scene = SCENES[name]!
  return (
    <div style={{ display: "flex", alignItems: "flex-start", padding: 24, minHeight: "100vh", boxSizing: "border-box", background: "#0a0a0a" }}>
      <Panel palette={palette} width={size.width} height={size.height} shot={shot}>
        {/* A new key per scene and palette's start, so a scene's filter and open rows start from its own. */}
        <SyncLog key={name} rows={rows} palette={palette} syntax={SYNTAX[palette]} host={host} filter={scene.filter} open={scene.open} />
      </Panel>
      <Root>
        <div className="ml-6 max-w-xs space-y-3 text-sm text-foreground">
          <div className="flex flex-wrap">
            {Object.keys(SCENES).map((one) => (
              <Button key={one} size="xs" variant={one === name ? "default" : "ghost"} className="mb-1 mr-1" onClick={() => show(one)}>
                {one}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap">
            {(["dark", "light"] as const).map((one) => (
              <Button key={one} size="xs" variant={palette === one ? "default" : "outline"} className="mb-1 mr-1" onClick={() => setPalette(one)}>
                {one}
              </Button>
            ))}
            {SIZES.map((one) => (
              <Button key={one.name} size="xs" variant={size === one ? "default" : "outline"} className="mb-1 mr-1" onClick={() => setSize(one)}>
                {one.name}
              </Button>
            ))}
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            {heard.length ? heard.map((call, at) => <p key={at}>{call}</p>) : <p>The log's calls on the extension show here.</p>}
          </div>
        </div>
      </Root>
    </div>
  )
}

createRoot(document.getElementById("page") as HTMLElement).render(<Page />)
