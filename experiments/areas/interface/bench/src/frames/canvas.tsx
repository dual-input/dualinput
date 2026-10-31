// A Figma-like canvas for the EFB app's frames: sections of frames on a board that pans and
// zooms, with a layers list that jumps to a frame. The wheel pans, Ctrl or Cmd with the wheel
// zooms at the pointer, dragging the empty board pans, and double-clicking it zooms to 100% there.
// The layers list hides and shows with its button or Ctrl+\, as Figma's panels do. The frames draw
// in the style bench's theme as it was last saved, so a change made there shows here on reload.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Frame, LayoutGrid, Minus, PanelLeftClose, PanelLeftOpen, Plus, Scan } from "lucide-react"

import { TooltipProvider } from "@/components/ui/tooltip"
import { UI } from "@/bench/ui"
import { DEFAULT_THEME, themeLabel, themeVars, type Theme } from "@/bench/theme"
import { AppFrame, EFB, EveryIssueFrame } from "./shell"
import { SetupFlowFrame } from "./setup-check"
import { CrewmateStatesFrame, HeadsUpFrame, HomeFirstTimeFrame, HomeLaterFrame, ReconnectingFrame, RefusalsFrame, WaysFrame, type Action } from "./home"
import { AircraftPickerFrame } from "./aircraft"
import { AtcFrame, TrafficFrame } from "./traffic"

// A frame that's taller than the EFB gets a line where the EFB's height ends, and an animated
// one gets a Replay button beside its name, which draws it afresh. A home page with Host and Join
// also gets Play hosting and Play joining, which draw it afresh to play that by itself.
type FrameEntry = { name: string; tall?: boolean; replay?: boolean; plays?: boolean; draw: (t: Theme, play?: Action) => React.ReactNode }
const PLAYS: { play: Action; label: string }[] = [
  { play: "host", label: "Play hosting" },
  { play: "join", label: "Play joining" },
]
// How long after its frame opens the crewmate joins, or preflight starts, in milliseconds: long
// enough to take in the card as it was first.
const CREWMATE_JOINS_AFTER = 2500
// A section holds one run of the app, from where it starts to what follows on from it, so a run
// that continues another joins it rather than taking a section of its own. A frame's name says
// what sets it apart within its section.
const SECTIONS: { name: string; frames: FrameEntry[] }[] = [
  // First-time setup, then home's first visit, which setup's Continue leads to.
  {
    name: "First run",
    frames: [
      { name: "Setup, every check passes", replay: true, draw: (t) => <SetupFlowFrame theme={t} /> },
      { name: "Setup failed: Dual Input service", replay: true, draw: (t) => <SetupFlowFrame theme={t} failure="core" openOnFailure /> },
      { name: "Setup failed: sim add-on", replay: true, draw: (t) => <SetupFlowFrame theme={t} failure="addon" openOnFailure /> },
      { name: "Setup failed: PC offline", replay: true, draw: (t) => <SetupFlowFrame theme={t} failure="offline" openOnFailure /> },
      { name: "Setup failed: our servers", replay: true, draw: (t) => <SetupFlowFrame theme={t} failure="servers" openOnFailure /> },
      { name: "Setup failed: Windows Firewall", replay: true, draw: (t) => <SetupFlowFrame theme={t} failure="firewall" openOnFailure /> },
      { name: "Setup, crew card", replay: true, draw: (t) => <SetupFlowFrame theme={t} openOnCard /> },
      { name: "Home, the guide", replay: true, draw: (t) => <HomeFirstTimeFrame theme={t} aircraft="supported" /> },
      { name: "Home, on the aircraft check", replay: true, draw: (t) => <HomeFirstTimeFrame theme={t} aircraft="supported" openOnCheck /> },
      { name: "Home, on the aircraft check, unsupported", replay: true, draw: (t) => <HomeFirstTimeFrame theme={t} aircraft="unsupported" openOnCheck /> },
    ],
  },
  // Home on a later visit, then Host and Join from it. Our servers, faked, take Host and Join, refuse
  // them, or are slow; or the PC is offline, which the header shows too.
  {
    name: "Home",
    frames: [
      { name: "With the authors' notes", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" notes="short" /> },
      { name: "A long note", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" notes="long" /> },
      { name: "No notes", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" /> },
      { name: "Unsupported aircraft", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="unsupported" /> },
      { name: "Host or join, succeeds", replay: true, plays: true, draw: (t, play) => <HomeLaterFrame theme={t} aircraft="supported" play={play} /> },
      { name: "Host or join, refused", replay: true, plays: true, draw: (t, play) => <HomeLaterFrame theme={t} aircraft="supported" servers="refusing" play={play} /> },
      { name: "Host or join, slow", replay: true, plays: true, draw: (t, play) => <HomeLaterFrame theme={t} aircraft="supported" servers="slow" play={play} /> },
      { name: "Host or join, offline", replay: true, plays: true, draw: (t, play) => <HomeLaterFrame theme={t} aircraft="supported" servers="offline" header={{ offline: true }} play={play} /> },
      { name: "Every refusal", draw: (t) => <RefusalsFrame theme={t} /> },
    ],
  },
  // The session page, which is home once Host or Join succeeds, before preflight: hosted, alone, as a
  // crewmate joins, and once one has, with a sheet of where a crewmate can be; joined, with a sheet
  // of a joiner's ways to the pilot flying; and, for Later, a crew bigger than v1's two. Each opens
  // with its heads popping in, as the card turning to it does.
  {
    name: "Session",
    frames: [
      { name: "Hosted, alone", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="alone" /> },
      { name: "A crewmate joins", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="alone" next={{ after: CREWMATE_JOINS_AFTER, session: "crewmate" }} /> },
      { name: "Hosted, a crewmate joined", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="crewmate" /> },
      { name: "Every crewmate state", draw: (t) => <CrewmateStatesFrame theme={t} /> },
      { name: "Joined", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="joined" /> },
      { name: "Every way to the pilot flying", draw: (t) => <WaysFrame theme={t} /> },
      { name: "Later: a bigger crew", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="bigger-crew" /> },
    ],
  },
  // Preflight on the session page, once the PF is in a flight on the ground: starting, as the host
  // loads a flight; then on the host's side, alone, with the crewmate loading, with them in the
  // flight and ready, with the card folded to its row, while the host's aircraft settles, with the
  // crewmate dropped out, and counting down; then on the joiner's side, open and folded. Then, for
  // Later, the worst case, a big crew with the most messages at once and a long checklist; and a
  // sheet of every match check message.
  {
    name: "Preflight",
    frames: [
      { name: "Preflight starts", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="crewmate" next={{ after: CREWMATE_JOINS_AFTER, session: "preflight-loading" }} /> },
      { name: "Preflight, host alone", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="preflight-alone" /> },
      { name: "Preflight, crewmate loading", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="preflight-loading" /> },
      { name: "Preflight, crewmate ready", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="preflight-crew" /> },
      { name: "Preflight, card folded", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="preflight-crew" opensFolded /> },
      { name: "Preflight, aircraft settling", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="preflight-settling" /> },
      { name: "Preflight, crewmate dropped out", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="preflight-dropped" /> },
      { name: "Preflight, countdown", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="preflight-countdown" /> },
      { name: "Preflight, joiner", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="preflight-joined" /> },
      { name: "Preflight, joiner, card folded", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="preflight-joined" opensFolded /> },
      { name: "Later: preflight, worst case", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="preflight-worst" /> },
      { name: "Every match check message", tall: true, draw: (t) => <HeadsUpFrame theme={t} /> },
    ],
  },
  // The flight, once preflight's countdown has ended: the session card with its differences folded
  // to counts, and taking control in a strip under the tabs, on every tab. The joiner monitoring
  // while James flies, and the host flying; the joiner taking control with a hold, then James
  // taking it back; a click let go too soon; a late joiner's catch-up, which control waits for;
  // the link to James, flying, lost; and the strip with long bindings, held.
  {
    name: "Flying",
    frames: [
      { name: "Flying, pilot monitoring", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="flying-pm" /> },
      { name: "Flying, pilot flying", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="flying-pf" /> },
      { name: "Taking control, then James takes it back", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="flying-take" /> },
      { name: "A click let go too soon", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="flying-tap" /> },
      { name: "Flying, catching up", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="flying-catching-up" /> },
      { name: "Flying, link to the pilot flying lost", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="flying-pf-lost" /> },
      { name: "Flying, traffic and ATC from two pilots", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="flying-split" /> },
      { name: "Bound to a key combination", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="flying-combo" /> },
      { name: "Bound to a hardware button", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="flying-hardware" /> },
    ],
  },
  // The Traffic and ATC audio tabs, each holding its feature's sharing, settings, and warnings,
  // with an amber dot on the tab's icon while it holds a warning, in the order a session meets
  // them (user, 2026-10-31): nobody sharing; this pilot sharing, ATC waiting for its app before it
  // shares; James sharing, aircraft missing and extra before they're fixed; and outside a session.
  {
    name: "Traffic",
    frames: [
      { name: "Nobody shares traffic", draw: (t) => <TrafficFrame theme={t} where={{ session: true }} /> },
      { name: "Sharing traffic", draw: (t) => <TrafficFrame theme={t} where={{ session: true, sharer: "You" }} /> },
      { name: "Receiving, aircraft missing and extra", draw: (t) => <TrafficFrame theme={t} where={{ session: true, sharer: "James" }} packs="differ" counts={{ missing: 14, others: 6 }} /> },
      // James's traffic changes, so the missing count rolls, then the pilot's own AI traffic goes off.
      { name: "Receiving, counts changing", replay: true, draw: (t) => <TrafficFrame theme={t} where={{ session: true, sharer: "James" }} packs="differ" counts={{ missing: 14, others: 6 }} later={[{ after: 1500, counts: { missing: 12, others: 6 } }, { after: 3200, counts: { missing: 12, others: 0 } }]} /> },
      { name: "Receiving, everything matches", draw: (t) => <TrafficFrame theme={t} where={{ session: true, sharer: "James" }} /> },
      { name: "Traffic outside a session", draw: (t) => <TrafficFrame theme={t} where={{ session: false }} /> },
    ],
  },
  {
    name: "ATC audio",
    frames: [
      { name: "Nobody shares ATC", draw: (t) => <AtcFrame theme={t} where={{ session: true }} /> },
      { name: "Sharing, no ATC app running", draw: (t) => <AtcFrame theme={t} where={{ session: true, sharer: "You" }} capture="none" /> },
      { name: "Sharing ATC", draw: (t) => <AtcFrame theme={t} where={{ session: true, sharer: "You" }} /> },
      // The ATC app starts after the pilot turned sharing on, so Automatic takes it.
      { name: "Sharing, the ATC app starts", replay: true, draw: (t) => <AtcFrame theme={t} where={{ session: true, sharer: "You" }} capture="none" later={[{ after: 1800, capture: "capturing" }]} /> },
      { name: "Receiving ATC", draw: (t) => <AtcFrame theme={t} where={{ session: true, sharer: "James" }} /> },
      { name: "Receiving ATC, turned all the way down", draw: (t) => <AtcFrame theme={t} where={{ session: true, sharer: "James" }} volume={0} /> },
      { name: "ATC outside a session", draw: (t) => <AtcFrame theme={t} where={{ session: false }} /> },
    ],
  },
  // What the app's window says of itself on any page. The header on home, open over what needs the
  // pilot, or at rest, and in a flight, where its rows say what each costs there and an update
  // waits; with nothing, as on every other frame, it's the mark alone. Then the window
  // when its link to the service, the core, is lost: reconnecting after a crash, over home here,
  // where the service comes back on its own; not running; and quit.
  {
    name: "App status",
    frames: [
      { name: "Header, an update", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" header={{ update: "1.0.3" }} headerOpen /> },
      { name: "Header, needs attention", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" header={{ servers: "unreachable", firewall: "blocks", update: "1.0.3" }} headerOpen /> },
      { name: "Header, needs attention, at rest", draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" header={{ servers: "unreachable", firewall: "blocks", update: "1.0.3" }} /> },
      { name: "Header in a flight, needs attention", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="flying-pf" header={{ servers: "unreachable", firewall: "blocks", update: "1.0.3" }} headerOpen /> },
      { name: "Header in a flight, offline", replay: true, draw: (t) => <HomeLaterFrame theme={t} aircraft="supported" session="flying-pf" header={{ offline: true, firewall: "blocks" }} headerOpen /> },
      { name: "Header, every issue", tall: true, draw: (t) => <EveryIssueFrame theme={t} /> },
      { name: "Service, reconnecting", replay: true, draw: (t) => <ReconnectingFrame theme={t} /> },
      { name: "Service, not running", draw: (t) => <AppFrame theme={t} core="not-running" fixed /> },
      { name: "Service, closed", draw: (t) => <AppFrame theme={t} core="closed" fixed /> },
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

// The canvas keeps where the board was panned and zoomed to, and whether the layers list shows, in
// this browser too, so a reload opens where it was rather than fitting every frame again.
type View = { x: number; y: number; z: number }
const VIEW_KEY = "bench.canvas.view"
const LAYERS_KEY = "bench.canvas.layers"
function stored<T>(key: string, valid: (v: unknown) => v is T): T | undefined {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "null")
    return valid(v) ? v : undefined
  } catch {
    return undefined
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A browser that won't store it opens fitted, with the list hidden, next time.
  }
}
const isView = (v: unknown): v is View => !!v && typeof v === "object" && ["x", "y", "z"].every((k) => Number.isFinite((v as Record<string, unknown>)[k])) && (v as View).z > 0
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean"
// The layers list's width, w-60, which the board's place shifts by as it hides or shows.
const LAYERS_WIDTH = 240

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// A frame's content, drawn again only when its theme or what it plays changes, or the zoom the
// board is laid out at. The canvas renders on every step of a pan or zoom, and drawing every frame
// again with it took 12ms a step on the development PC with 20 frames, a third of a 165Hz display's
// frame rate. Once the zoom rests, though, CSS zoom rounds the text's lines afresh, and a box that
// measured its contents after a render, as the session card's turning part does, would keep the
// height from the old zoom, cutting off its last 3px or leaving a gap under it.
// Each frame mounts in a task of its own. Many frames measure themselves after a render and set
// state from it, and React counts those updates across one commit, stopping at 50: with every frame
// on the canvas mounting in the same commit, their chains together passed that on screens at 2x
// and 4x pixel density, and the canvas went blank with "Maximum update depth exceeded" (measured in
// Chromium, 2026-10-31, after the Flying and Traffic sections joined; skipping any one large
// section stopped it). A frame's first draw comes a task after the canvas's.
const FrameBody = memo(function FrameBody({ entry, theme, play }: { entry: FrameEntry; theme: Theme; play?: Action; zoom: number }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true))
    return () => clearTimeout(t)
  }, [])
  return mounted ? <>{entry.draw(theme, play)}</> : null
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
  const [savedView] = useState(() => stored(VIEW_KEY, isView))
  const [view, setView] = useState<View>(savedView ?? { x: 0, y: 0, z: 0.5 })
  useEffect(() => {
    const t = window.setTimeout(() => store(VIEW_KEY, view), SETTLE)
    return () => clearTimeout(t)
  }, [view])
  const [layers, setLayers] = useState(() => stored(LAYERS_KEY, isBoolean) ?? false)
  // The frames stay where they are on screen as the list hides or shows beside the board.
  const toggleLayers = useCallback(() => {
    setLayers(!layers)
    setView((v) => ({ ...v, x: v.x + (layers ? LAYERS_WIDTH : -LAYERS_WIDTH) }))
  }, [layers])
  useEffect(() => store(LAYERS_KEY, layers), [layers])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault()
        toggleLayers()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggleLayers])
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

  useLayoutEffect(() => {
    if (!savedView) fit(world.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        <aside className={"w-60 shrink-0 flex-col border-r border-white/10 bg-[#232323] " + (layers ? "flex" : "hidden")}>
          <div className="flex h-11 items-center gap-2 border-b border-white/10 pr-2 pl-4">
            <LayoutGrid className="size-4 text-neutral-400" />
            <span className="text-[13px] font-medium">EFB app</span>
            <span className="text-[13px] text-neutral-500">/ UI kit</span>
            <button className="ml-auto flex size-7 items-center justify-center rounded-md text-neutral-400 hover:bg-white/10 hover:text-neutral-200" title="Hide layers (Ctrl+\)" onClick={toggleLayers}>
              <PanelLeftClose className="size-4" />
            </button>
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
            onDoubleClick={(e) => {
              if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("[data-frame]")) return
              const box = e.currentTarget.getBoundingClientRect()
              zoomAt(1 / view.z, e.clientX - box.left, e.clientY - box.top)
            }}
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
                            <FrameBody entry={f} theme={theme} play={playing[idOf(s, f)]} zoom={laidOut} />
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

          {!layers && (
            <button className="absolute top-4 left-4 flex size-9 items-center justify-center rounded-lg border border-white/10 bg-[#2a2a2a] text-neutral-400 shadow-lg hover:text-neutral-200" title="Show layers (Ctrl+\)" onClick={toggleLayers}>
              <PanelLeftOpen className="size-4" />
            </button>
          )}
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
