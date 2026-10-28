// A Figma-like canvas for the EFB app's frames: sections of frames on a board that pans and
// zooms, with a layers list that jumps to a frame. The wheel pans, Ctrl or Cmd with the wheel
// zooms at the pointer, and dragging the empty board pans. The frames draw in the style bench's
// theme as it was last saved, so a change made there shows here on reload.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Frame, LayoutGrid, Minus, Plus, Scan } from "lucide-react"

import { TooltipProvider } from "@/components/ui/tooltip"
import { UI } from "@/bench/ui"
import { DEFAULT_THEME, themeLabel, themeVars, type Theme } from "@/bench/theme"
import { EFB } from "./shell"
import { PreflightFrame } from "./preflight"
import { SetupFrame } from "./setup"
import { HomeFirstTimeFrame } from "./home"

// A frame that's taller than the EFB gets a line where the EFB's height ends.
type FrameEntry = { name: string; tall?: boolean; draw: (t: Theme) => React.ReactNode }
const SECTIONS: { name: string; frames: FrameEntry[] }[] = [
  {
    name: "Setup and home",
    frames: [
      { name: "First-time setup", draw: (t) => <SetupFrame theme={t} /> },
      { name: "Home, first time", draw: (t) => <HomeFirstTimeFrame theme={t} aircraft="supported" /> },
      { name: "Home, first time, unsupported aircraft", draw: (t) => <HomeFirstTimeFrame theme={t} aircraft="unsupported" /> },
    ],
  },
  { name: "Preflight", frames: [{ name: "Preflight, with the UI kit", tall: true, draw: (t) => <PreflightFrame theme={t} /> }] },
]

// The style bench saves its theme in this browser; the canvas only reads it.
function savedTheme(): Theme {
  try {
    return { ...DEFAULT_THEME, ...JSON.parse(localStorage.getItem("bench.theme") ?? "{}") }
  } catch {
    return DEFAULT_THEME
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function Canvas() {
  const [theme] = useState(savedTheme)
  const board = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const frames = useRef(new Map<string, HTMLDivElement>())
  const [view, setView] = useState({ x: 0, y: 0, z: 0.5 })
  const [current, setCurrent] = useState<string | null>(null)
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
                    key={f.name}
                    className={"flex h-7 items-center gap-2 rounded-md pr-2 pl-7 text-left text-[13px] " + (current === f.name ? "bg-sky-500/20 text-sky-200" : "text-neutral-300 hover:bg-white/5")}
                    onClick={() => (setCurrent(f.name), fit(frames.current.get(f.name)))}
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
              if ((e.target as HTMLElement).closest("[data-frame]")) return
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
                their text stays sharp where a scale transform would blur it. */}
            <div className="absolute top-0 left-0" style={{ transform: `translate(${view.x}px, ${view.y}px)` }}>
              <div ref={world} className="flex flex-col items-start gap-40 p-20" style={{ zoom: view.z }}>
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
                          key={f.name}
                          ref={(el) => {
                            if (el) frames.current.set(f.name, el)
                          }}
                          data-frame
                          className="relative"
                          style={{ width: EFB.width }}
                        >
                          <span className={"absolute bottom-full left-0 whitespace-nowrap " + (current === f.name ? "text-sky-300" : "text-neutral-400")} style={{ fontSize: fixed(12), paddingBottom: fixed(6) }}>
                            {f.name}
                          </span>
                          {f.draw(theme)}
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
