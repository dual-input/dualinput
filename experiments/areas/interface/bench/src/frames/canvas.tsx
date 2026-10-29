// A Figma-like canvas for the EFB app's frames: sections of frames on a board that pans and
// zooms, with a layers list that jumps to a frame. The wheel pans, Ctrl or Cmd with the wheel
// zooms at the pointer, and dragging the empty board pans. The frames draw in the style bench's
// theme as it was last saved, so a change made there shows here on reload.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Frame, LayoutGrid, Minus, Plus, Scan } from "lucide-react"

import { TooltipProvider } from "@/components/ui/tooltip"
import { UI } from "@/bench/ui"
import { DEFAULT_THEME, themeLabel, themeVars, type Theme } from "@/bench/theme"
import { AppFrame, EFB, EveryIssueFrame } from "./shell"
import { PreflightFrame } from "./preflight"
import { SetupFlowFrame } from "./setup-check"
import { HomeFirstTimeFrame, HomeLaterFrame, ReconnectingFrame, RefusalsFrame, type Action } from "./home"
import { AircraftPickerFrame } from "./aircraft"

// A frame that's taller than the EFB gets a line where the EFB's height ends, and an animated
// one gets a Replay button beside its name, which draws it afresh. A home page with Host and Join
// also gets Play hosting and Play joining, which draw it afresh to play that by itself.
type FrameEntry = { name: string; tall?: boolean; replay?: boolean; plays?: boolean; draw: (t: Theme, play?: Action) => React.ReactNode }
const PLAYS: { play: Action; label: string }[] = [
  { play: "host", label: "Play hosting" },
  { play: "join", label: "Play joining" },
]
const SECTIONS: { name: string; frames: FrameEntry[] }[] = [
  {
    name: "First-time setup",
    frames: [
      { name: "Every check passes", replay: true, draw: (t) => <SetupFlowFrame theme={t} /> },
      { name: "Failed: Dual Input service", replay: true, draw: (t) => <SetupFlowFrame theme={t} failure="core" openOnFailure /> },
      { name: "Failed: sim add-on", replay: true, draw: (t) => <SetupFlowFrame theme={t} failure="addon" openOnFailure /> },
      { name: "Failed: PC offline", replay: true, draw: (t) => <SetupFlowFrame theme={t} failure="offline" openOnFailure /> },
      { name: "Failed: our servers", replay: true, draw: (t) => <SetupFlowFrame theme={t} failure="servers" openOnFailure /> },
      { name: "Failed: Windows Firewall", replay: true, draw: (t) => <SetupFlowFrame theme={t} failure="firewall" openOnFailure /> },
      { name: "Crew card", replay: true, draw: (t) => <SetupFlowFrame theme={t} openOnCard /> },
    ],
  },
  // Sections hold what a frame shows, a page or a part several pages open, so a frame's name says
  // only what sets it apart within its section.
  {
    name: "Home, first visit",
    frames: [
      { name: "The guide", replay: true, draw: (t) => <HomeFirstTimeFrame theme={t} aircraft="supported" /> },
      { name: "On the aircraft check", replay: true, draw: (t) => <HomeFirstTimeFrame theme={t} aircraft="supported" openOnCheck /> },
      { name: "On the aircraft check, unsupported", replay: true, draw: (t) => <HomeFirstTimeFrame theme={t} aircraft="unsupported" openOnCheck /> },
    ],
  },
  {
    name: "Home, later visit",
    frames: [
      { name: "With the authors' notes", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" notes="short" /> },
      { name: "A long note", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" notes="long" /> },
      { name: "No notes", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" /> },
      { name: "Unsupported aircraft", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="unsupported" /> },
    ],
  },
  // Our servers, faked, take Host and Join in the first frame, refuse them in the second, and are
  // slow in the third; in the fourth the PC is offline, which the header shows too.
  {
    name: "Hosting and joining",
    frames: [
      { name: "Succeeds", replay: true, plays: true, draw: (t, play) => <HomeLaterFrame theme={t} aircraft="supported" play={play} /> },
      { name: "Refused", replay: true, plays: true, draw: (t, play) => <HomeLaterFrame theme={t} aircraft="supported" servers="refusing" play={play} /> },
      { name: "Slow", replay: true, plays: true, draw: (t, play) => <HomeLaterFrame theme={t} aircraft="supported" servers="slow" play={play} /> },
      { name: "Offline", replay: true, plays: true, draw: (t, play) => <HomeLaterFrame theme={t} aircraft="supported" servers="offline" header={{ offline: true }} play={play} /> },
      { name: "Every refusal", draw: (t) => <RefusalsFrame theme={t} /> },
    ],
  },
  // The session page, which is home once Host or Join succeeds: hosted, with nobody else yet; and,
  // for Later, a crew bigger than v1's two. Hosting and joining's Succeeds plays the way in.
  {
    name: "Session",
    frames: [
      { name: "Hosted, alone", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="alone" /> },
      { name: "Later: a bigger crew", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="bigger-crew" /> },
    ],
  },
  // The header on home, open over what needs the pilot, or at rest; with nothing, as on every other
  // frame, it's the mark alone.
  {
    name: "Header",
    frames: [
      { name: "An update", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" header={{ update: "1.0.3" }} headerOpen /> },
      { name: "Needs attention", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" header={{ servers: "unreachable", firewall: "blocks", update: "1.0.3" }} headerOpen /> },
      { name: "Needs attention, at rest", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" header={{ servers: "unreachable", firewall: "blocks", update: "1.0.3" }} /> },
      { name: "Every issue", draw: (t) => <EveryIssueFrame theme={t} /> },
    ],
  },
  // The app's window when its link to the service, the core, is lost, on any page: reconnecting
  // after a crash, over home here, where the service comes back on its own; not running; and quit.
  {
    name: "Service",
    frames: [
      { name: "Reconnecting", replay: true, draw: (t) => <ReconnectingFrame theme={t} /> },
      { name: "Not running", draw: (t) => <AppFrame theme={t} core="not-running" fixed /> },
      { name: "Closed", draw: (t) => <AppFrame theme={t} core="closed" fixed /> },
    ],
  },
  {
    name: "Aircraft picker",
    frames: [
      { name: "Installed aircraft", replay: true, draw: (t) => <AircraftPickerFrame theme={t} /> },
      { name: "In a flight", replay: true, draw: (t) => <AircraftPickerFrame theme={t} at="flight" /> },
      { name: "None installed", replay: true, draw: (t) => <AircraftPickerFrame theme={t} noneInstalled /> },
    ],
  },
  // The preflight page from the sketch, with an example of every kit component in its checklist's
  // place, kept as the kit's reference while preflight gets designed afresh.
  { name: "All components", frames: [{ name: "All components", tall: true, draw: (t) => <PreflightFrame theme={t} /> }] },
]

// A frame's name is short and can repeat across sections, so the canvas knows a frame by both.
const idOf = (s: { name: string }, f: FrameEntry) => `${s.name} / ${f.name}`

// The style bench saves its theme in this browser; the canvas only reads it.
function savedTheme(): Theme {
  try {
    return { ...DEFAULT_THEME, ...JSON.parse(localStorage.getItem("bench.theme") ?? "{}") }
  } catch {
    return DEFAULT_THEME
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// A frame's content, drawn again only when its theme or what it plays changes. The canvas renders
// on every step of a pan or zoom, and drawing every frame again with it took 12ms a step on the
// development PC with 20 frames, a third of a 165Hz display's frame rate.
const FrameBody = memo(function FrameBody({ entry, theme, play }: { entry: FrameEntry; theme: Theme; play?: Action }) {
  return <>{entry.draw(theme, play)}</>
})

// CSS zoom lays every frame out again, about 100ms a step on the development PC with 20 frames, so
// while the zoom changes a scale transform carries it, and the board is laid out at the new zoom
// once the zoom has rested this long. The transform's layer keeps the raster it started with, since
// rasterizing the board again at each new scale took 12ms a step; the text is soft until it rests.
const SETTLE = 200

export function Canvas() {
  const [theme] = useState(savedTheme)
  const board = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const frames = useRef(new Map<string, HTMLDivElement>())
  const [view, setView] = useState({ x: 0, y: 0, z: 0.5 })
  // The zoom the board is laid out at, which follows the view's once it rests.
  const [laidOut, setLaidOut] = useState(view.z)
  useEffect(() => {
    if (view.z === laidOut) return
    const t = window.setTimeout(() => setLaidOut(view.z), SETTLE)
    return () => clearTimeout(t)
  }, [view.z, laidOut])
  const [current, setCurrent] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, number>>({})
  const [playing, setPlaying] = useState<Record<string, Action | undefined>>({})
  const rerun = (name: string, play?: Action) => {
    setPlaying((p) => ({ ...p, [name]: play }))
    setRuns((r) => ({ ...r, [name]: (r[name] ?? 0) + 1 }))
  }
  const drag = useRef<{ x: number; y: number } | null>(null)

  // Fits an element of the world to the board. Rects come back on screen, so the world's place
  // and zoom turn them back into the world's own units.
  const fit = useCallback(
    (el: HTMLElement | null | undefined, most = 1) => {
      const b = board.current
      if (!b || !el) return
      const box = b.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const wx = (r.left - box.left - view.x) / view.z
      const wy = (r.top - box.top - view.y) / view.z
      const w = r.width / view.z
      const h = r.height / view.z
      const z = clamp(Math.min((box.width - 120) / w, (box.height - 120) / h), 0.05, most)
      setView({ z, x: (box.width - w * z) / 2 - wx * z, y: (box.height - h * z) / 2 - wy * z })
    },
    [view]
  )

  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    const b = board.current
    if (!b) return
    const box = b.getBoundingClientRect()
    const cx = px ?? box.width / 2
    const cy = py ?? box.height / 2
    setView((v) => {
      const z = clamp(v.z * factor, 0.05, 4)
      return { z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) }
    })
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => fit(world.current), [])

  useEffect(() => {
    const b = board.current
    if (!b) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const box = b.getBoundingClientRect()
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - box.left, e.clientY - box.top)
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    b.addEventListener("wheel", onWheel, { passive: false })
    return () => b.removeEventListener("wheel", onWheel)
  }, [zoomAt])

  // Menus, dialogs, and toasts open in a portal at the document's root, outside every frame,
  // so the root takes the frames' theme too.
  useEffect(() => {
    const root = document.documentElement
    for (const [k, v] of Object.entries(themeVars(theme))) root.style.setProperty(k, v)
  }, [theme])

  const Toaster = (UI[theme.preset] ?? UI.nova).Toaster
  // Labels keep one size on screen whatever the zoom, as Figma draws frame and section names.
  const fixed = (px: number) => px / view.z

  return (
    <TooltipProvider>
      <div className="fixed inset-0 flex bg-[#1b1b1b] font-sans text-neutral-200">
        <aside className="flex w-60 shrink-0 flex-col border-r border-white/10 bg-[#232323]">
          <div className="flex h-11 items-center gap-2 border-b border-white/10 px-4">
            <LayoutGrid className="size-4 text-neutral-400" />
            <span className="text-[13px] font-medium">EFB app</span>
            <span className="text-[13px] text-neutral-500">/ UI kit</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2 pt-3">
            <span className="px-2 text-[11px] font-medium tracking-wider text-neutral-500 uppercase">Layers</span>
            {SECTIONS.map((s) => (
              <div key={s.name} className="flex flex-col">
                <span className="flex h-7 items-center gap-2 px-2 text-[13px] font-medium">
                  <LayoutGrid className="size-3.5 text-neutral-500" /> {s.name}
                </span>
                {s.frames.map((f) => (
                  <button
                    key={idOf(s, f)}
                    className={"flex h-7 items-center gap-2 rounded-md pr-2 pl-7 text-left text-[13px] " + (current === idOf(s, f) ? "bg-sky-500/20 text-sky-200" : "text-neutral-300 hover:bg-white/5")}
                    onClick={() => (setCurrent(idOf(s, f)), fit(frames.current.get(idOf(s, f))))}
                  >
                    <Frame className="size-3.5 shrink-0 text-neutral-500" />
                    <span className="truncate">{f.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <p className="border-t border-white/10 p-4 text-[11px] leading-relaxed text-neutral-500">{themeLabel(theme)}</p>
        </aside>

        <div className="relative min-w-0 flex-1">
          <div
            ref={board}
            // Clip rather than hide, since focus can scroll a box whose overflow is hidden.
            className="absolute inset-0 cursor-grab overflow-clip active:cursor-grabbing"
            style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)", backgroundSize: `${24 * view.z}px ${24 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
            onPointerDown={(e) => {
              // React bubbles a press in a frame's popover or menu here too, though they open in a
              // portal at the document's root, and capturing the pointer for a drag would take
              // their buttons' clicks, so only a press on the board itself drags.
              if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("[data-frame]")) return
              drag.current = { x: e.clientX, y: e.clientY }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (!drag.current) return
              const dx = e.clientX - drag.current.x
              const dy = e.clientY - drag.current.y
              drag.current = { x: e.clientX, y: e.clientY }
              setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
            }}
            onPointerUp={() => (drag.current = null)}
          >
            {/* The board zooms with CSS zoom, which lays the frames out again at the new size, so
                their text stays sharp where a scale transform would blur it; the transform carries
                only a zoom still under way. */}
            <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z / laidOut})`, willChange: view.z !== laidOut ? "transform" : undefined }}>
              <div ref={world} className="flex flex-col items-start gap-40 p-20" style={{ zoom: laidOut }}>
                {SECTIONS.map((s) => (
                  <div key={s.name} className="relative rounded-3xl border border-white/10 bg-white/[0.03] px-20 pt-16 pb-20">
                    <span className="absolute bottom-full left-0 whitespace-nowrap" style={{ paddingBottom: fixed(10) }}>
                      <span className="block rounded-md bg-white/10 font-medium text-neutral-200" style={{ fontSize: fixed(13), padding: `${fixed(4)}px ${fixed(10)}px` }}>
                        {s.name}
                      </span>
                    </span>
                    <div className="flex items-start gap-20">
                      {s.frames.map((f) => (
                        <div
                          key={idOf(s, f)}
                          ref={(el) => {
                            if (el) frames.current.set(idOf(s, f), el)
                          }}
                          data-frame
                          className="relative"
                          style={{ width: EFB.width }}
                        >
                          <span className={"absolute bottom-full left-0 whitespace-nowrap " + (current === idOf(s, f) ? "text-sky-300" : "text-neutral-400")} style={{ fontSize: fixed(12), paddingBottom: fixed(6) }}>
                            {f.name}
                            {f.replay && (
                              <button className="text-sky-300 hover:underline" style={{ marginLeft: fixed(10) }} onClick={() => rerun(idOf(s, f))}>
                                Replay
                              </button>
                            )}
                            {f.plays &&
                              PLAYS.map(({ play, label }) => (
                                <button key={play} className="text-sky-300 hover:underline" style={{ marginLeft: fixed(10) }} onClick={() => rerun(idOf(s, f), play)}>
                                  {label}
                                </button>
                              ))}
                          </span>
                          <div key={runs[idOf(s, f)] ?? 0}>
                            <FrameBody entry={f} theme={theme} play={playing[idOf(s, f)]} />
                          </div>
                          {f.tall && (
                            <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-sky-400/60" style={{ top: EFB.height }}>
                              <span className="absolute top-0 left-full whitespace-nowrap text-sky-300/80" style={{ fontSize: fixed(11), paddingLeft: fixed(8), transform: "translateY(-50%)" }}>
                                EFB height, {EFB.height}px
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="absolute right-4 bottom-4 flex items-center gap-0.5 rounded-lg border border-white/10 bg-[#2a2a2a] p-1 text-[12px] shadow-lg">
            <button className="flex size-7 items-center justify-center rounded-md hover:bg-white/10" title="Zoom out" onClick={() => zoomAt(1 / 1.25)}>
              <Minus className="size-3.5" />
            </button>
            <button className="h-7 min-w-14 rounded-md px-2 tabular-nums hover:bg-white/10" title="Zoom to 100%" onClick={() => zoomAt(1 / view.z)}>
              {Math.round(view.z * 100)}%
            </button>
            <button className="flex size-7 items-center justify-center rounded-md hover:bg-white/10" title="Zoom in" onClick={() => zoomAt(1.25)}>
              <Plus className="size-3.5" />
            </button>
            <span className="mx-1 h-4 w-px bg-white/10" />
            <button className="flex h-7 items-center gap-1.5 rounded-md px-2 hover:bg-white/10" title="Fit every frame" onClick={() => (setCurrent(null), fit(world.current))}>
              <Scan className="size-3.5" /> Fit
            </button>
          </div>
        </div>
      </div>
      {Toaster && <Toaster theme="dark" position="bottom-center" />}
    </TooltipProvider>
  )
}
