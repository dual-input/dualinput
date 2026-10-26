// A Figma-like canvas for the EFB app's frames: sections of frames on a board that pans and
// zooms, with a layers list that jumps to a frame. The wheel pans, Ctrl or Cmd with the wheel
// zooms at the pointer, and dragging the empty board pans. The frames draw in the style bench's
// theme as it was last saved, so a change made there shows here on reload.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Frame, LayoutGrid, Minus, Plus, Scan } from "lucide-react"

import { TooltipProvider } from "@/components/ui/tooltip"
import { UI } from "@/bench/ui"
import { DEFAULT_THEME, themeLabel, themeVars, type Theme } from "@/bench/theme"
import { EFB, EfbApp, FRAME_GROUPS, FRAMES } from "./efb"

const GAP = 80
const PAD = 80
const TITLE = 40
const LABEL = 32
const SECTION_GAP = 200

type Rect = { x: number; y: number; w: number; h: number }

function layout() {
  const sections: (Rect & { group: string })[] = []
  const frames: (Rect & (typeof FRAMES)[number])[] = []
  let y = 0
  for (const group of FRAME_GROUPS) {
    const list = FRAMES.filter((f) => f.group === group)
    const w = PAD * 2 + list.length * EFB.width + (list.length - 1) * GAP
    const h = TITLE + LABEL + EFB.height + PAD
    sections.push({ group, x: 0, y, w, h })
    list.forEach((f, i) => frames.push({ ...f, x: PAD + i * (EFB.width + GAP), y: y + TITLE + LABEL, w: EFB.width, h: EFB.height }))
    y += h + SECTION_GAP
  }
  return { sections, frames, w: Math.max(...sections.map((s) => s.w)), h: y - SECTION_GAP }
}
const BOARD = layout()

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
  const [view, setView] = useState({ x: 0, y: 0, z: 0.2 })
  const [current, setCurrent] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  const fit = useCallback((r: Rect, most = 1) => {
    const el = board.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const z = Math.min(most, (width - 120) / r.w, (height - 120) / r.h)
    setView({ z, x: (width - r.w * z) / 2 - r.x * z, y: (height - r.h * z) / 2 - r.y * z })
  }, [])
  const fitAll = useCallback(() => (setCurrent(null), fit({ x: 0, y: 0, w: BOARD.w, h: BOARD.h })), [fit])

  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    const el = board.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = px ?? rect.width / 2
    const cy = py ?? rect.height / 2
    setView((v) => {
      const z = clamp(v.z * factor, 0.05, 4)
      return { z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) }
    })
  }, [])

  useLayoutEffect(() => fitAll(), [fitAll])

  useEffect(() => {
    const el = board.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [zoomAt])

  // Menus, dialogs, and toasts open in a portal at the document's root, outside every frame,
  // so the root takes the frames' theme too.
  useEffect(() => {
    const root = document.documentElement
    for (const [k, v] of Object.entries(themeVars(theme))) root.style.setProperty(k, v)
  }, [theme])

  const Toaster = (UI[theme.preset] ?? UI.nova).Toaster
  const onBoard = (e: React.PointerEvent) => e.target === e.currentTarget || (e.target as HTMLElement).dataset.board !== undefined

  return (
    <TooltipProvider>
      <div className="fixed inset-0 flex bg-[#1b1b1b] font-sans text-neutral-200">
        <aside className="flex w-60 shrink-0 flex-col border-r border-white/10 bg-[#232323]">
          <div className="flex h-11 items-center gap-2 border-b border-white/10 px-4">
            <LayoutGrid className="size-4 text-neutral-400" />
            <span className="text-[13px] font-medium">EFB app</span>
            <span className="text-[13px] text-neutral-500">/ Outline</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2 pt-3">
            <span className="px-2 text-[11px] font-medium tracking-wider text-neutral-500 uppercase">Layers</span>
            {BOARD.sections.map((s) => (
              <div key={s.group} className="flex flex-col">
                <button className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium hover:bg-white/5" onClick={() => (setCurrent(null), fit(s))}>
                  <LayoutGrid className="size-3.5 text-neutral-500" /> {s.group}
                </button>
                {BOARD.frames
                  .filter((f) => f.group === s.group)
                  .map((f) => (
                    <button
                      key={f.label}
                      className={"flex h-7 items-center gap-2 rounded-md pr-2 pl-7 text-left text-[13px] " + (current === f.label ? "bg-sky-500/20 text-sky-200" : "text-neutral-300 hover:bg-white/5")}
                      onClick={() => (setCurrent(f.label), fit({ x: f.x - 40, y: f.y - LABEL - 20, w: f.w + 80, h: f.h + LABEL + 60 }))}
                    >
                      <Frame className="size-3.5 shrink-0 text-neutral-500" />
                      <span className="truncate">{f.label}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
          <p className="border-t border-white/10 p-4 text-[11px] leading-relaxed text-neutral-500">{themeLabel(theme)}</p>
        </aside>

        <div
          ref={board}
          // Clip rather than hide, since focus can scroll a box whose overflow is hidden, which
          // moved the zoom controls and the frames together.
          className="relative min-w-0 flex-1 cursor-grab overflow-clip active:cursor-grabbing"
          style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)", backgroundSize: `${24 * view.z}px ${24 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
          onPointerDown={(e) => {
            if (!onBoard(e)) return
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
          <div data-board className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, width: BOARD.w, height: BOARD.h }}>
            {BOARD.sections.map((s) => (
              <div key={s.group} data-board className="absolute rounded-[24px] border border-white/10 bg-white/[0.03]" style={{ left: s.x, top: s.y, width: s.w, height: s.h }}>
                {/* Above the section, at one size whatever the zoom, as Figma draws a section's name. */}
                <span className="absolute bottom-full left-0 origin-bottom-left whitespace-nowrap" style={{ transform: `scale(${1 / view.z})`, paddingBottom: 10 }}>
                  <span className="block rounded-md bg-white/10 px-2.5 py-1 text-[13px] font-medium text-neutral-200">{s.group}</span>
                </span>
              </div>
            ))}
            {BOARD.frames.map((f) => (
              <div key={f.label} className="absolute" style={{ left: f.x, top: f.y, width: f.w, height: f.h }}>
                <span
                  className={"absolute bottom-full left-0 origin-bottom-left whitespace-nowrap " + (current === f.label ? "text-sky-300" : "text-neutral-400")}
                  style={{ transform: `scale(${1 / view.z})`, fontSize: 12, paddingBottom: 6 }}
                >
                  {f.label}
                </span>
                <EfbApp theme={theme} state={f.state} />
              </div>
            ))}
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
            <button className="flex h-7 items-center gap-1.5 rounded-md px-2 hover:bg-white/10" title="Fit every frame" onClick={fitAll}>
              <Scan className="size-3.5" /> Fit
            </button>
          </div>
        </div>
      </div>
      {Toaster && <Toaster theme="dark" position="bottom-center" />}
    </TooltipProvider>
  )
}
