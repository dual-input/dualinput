// The pilot's checklist, under the session card for them to work through before Ready. It's here for state
// sync's part to draw its rows with, which comes with that feature's stage. Its rows read as an aircraft's
// checklist does, each control, dots, then its starting value, and a row checked turns green. Each row is at
// least 44px tall, so a VR controller's pointer lands on one without careful aim. Profile authors write the
// names, values, and descriptions, and Dual Input makes some entries itself, so the rows take any length rather
// than a format limiting it (record/areas/interface/decisions.md, "The checklist takes any entry an author writes").

import { Button, cx, showPress } from "@dualinput/ui"
import { RotateCcw } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"

export type ChecklistItem = { id: string; name: string; default: string; description?: string }

/** A name too long for its line slides left to show its end while the pointer rests on its row: after a beat, so a pointer passing over doesn't set it moving, at a pace to read by, and back once the pointer leaves. */
const SLIDE = { wait: 500, pxPerSecond: 50, backMs: 250 }
const LEADER = ".".repeat(80)
const capFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function Name({ text, sliding }: { text: string; sliding: boolean }) {
  const line = useRef<HTMLSpanElement>(null)
  const name = useRef<HTMLSpanElement>(null)
  const [past, setPast] = useState(0)
  useLayoutEffect(() => {
    if (line.current && name.current) setPast(Math.max(0, name.current.offsetWidth - line.current.clientWidth))
  }, [text, sliding])
  const go = sliding && past > 0
  return (
    <span ref={line} className="relative top-px mr-3 min-w-0 overflow-hidden whitespace-nowrap">
      <span
        ref={name}
        className="inline-block"
        style={{ transform: go ? `translateX(${-past}px)` : undefined, transition: go ? `transform ${(past / SLIDE.pxPerSecond) * 1000}ms linear ${SLIDE.wait}ms` : `transform ${SLIDE.backMs}ms ease-out` }}
      >
        {capFirst(text)}
      </span>
    </span>
  )
}

/** A row's box, drawn as an avionics display draws one: a square outline with sharp corners, dimmed while open, and once checked, a check stroked inside it with square ends. */
function Box({ checked }: { checked: boolean }) {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" aria-hidden className="mr-3 size-4 shrink-0">
      <rect x="1" y="1" width="16" height="16" strokeWidth={1.5} opacity={checked ? 1 : 0.6} />
      {checked && <polyline points="4.5,9.5 7.5,12.5 13.5,5.5" strokeWidth={2.25} strokeLinecap="square" strokeLinejoin="miter" />}
    </svg>
  )
}

export function Checklist({ items }: { items: ChecklistItem[] }) {
  const [done, setDone] = useState<string[]>([])
  const [pointed, setPointed] = useState<string | null>(null)
  const toggle = (id: string) => setDone((now) => (now.includes(id) ? now.filter((other) => other !== id) : [...now, id]))
  return (
    <section className="flex shrink-0 flex-col">
      <h3 className="text-base font-semibold">Preflight Checklist</h3>
      <p className="mb-2 mt-1 text-sm text-muted-foreground">Check these before you click Ready, so every cockpit starts in sync.</p>
      {/* The rows reach 8px past the text on either side, so their text lines up with the title while a hovered row's tint has room around it. */}
      <ul className="-mx-2 flex flex-col font-checklist text-[13px]">
        {items.map((item) => {
          const checked = done.includes(item.id)
          return (
            <li key={item.id}>
              {/* Not a button, whose content Coherent GT sizes to fit, so a row's dots couldn't reach its end. */}
              <div
                role="checkbox"
                tabIndex={0}
                aria-checked={checked}
                onMouseDown={showPress}
                onClick={() => toggle(item.id)}
                onKeyDown={(event) => {
                  if (event.keyCode === 13 || event.keyCode === 32) toggle(item.id)
                }}
                onMouseEnter={() => setPointed(item.id)}
                onMouseLeave={() => setPointed((now) => (now === item.id ? null : now))}
                className={cx("flex min-h-11 cursor-pointer flex-col justify-center rounded-[6px] p-2 hover:bg-muted/50 data-[pressed]:translate-y-[var(--hair)]", checked && "text-success")}
              >
                <div className="flex items-center">
                  <Box checked={checked} />
                  <Name text={item.name} sliding={pointed === item.id} />
                  {/* No width of its own, since Coherent GT gives a flex item room for its text however it's clipped; it takes what's left, and keeps at least three dots. */}
                  <span className="relative top-px mr-3 w-0 min-w-6 grow overflow-hidden whitespace-nowrap opacity-40">{LEADER}</span>
                  <span className="relative top-px max-w-[50%] shrink-0 break-words text-right">{capFirst(item.default)}</span>
                </div>
                {item.description && <span className="mt-0.5 pl-7 text-[11px] leading-snug opacity-60">{item.description}</span>}
              </div>
            </li>
          )
        })}
      </ul>
      <Button variant="ghost" size="sm" className="-ml-2 mt-2 self-start text-muted-foreground" disabled={done.length === 0} onClick={() => setDone([])}>
        <RotateCcw className="size-4" />
        Reset checklist
      </Button>
    </section>
  )
}
