// The banner's stack: the preflight summary first while preflight runs, then the notifications, newest first, 8px
// apart, in the box's height. A card arriving opens its room, the cards under it sliding down, and slides in 24px from
// the screen's edge as it fades in, once the room is half open; one going by its lifetime slides 24px toward the edge
// as it fades, then its room shuts; one dismissed by its × or a drag has already slid off, so its room shuts at once.
// Arriving and leaving share the one direction, toward the edge the banner sits on.

import { Rolling } from "@dualinput/crew"
import { Button, MOMENT } from "@dualinput/ui"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"

import { NoteBody, NoteCard } from "./note-card.tsx"
import { ONCE_MS } from "./note.ts"
import type { Note } from "./note.ts"
import { GAP, merge, MORE_LINE, ordered, place } from "./placing.ts"
import type { Item } from "./placing.ts"

/** The box in its own pixels on a 1,080-line screen, one card wide and as tall as the summary and three notifications. */
export const BOX = { width: 360, height: 390 }

const SUMMARY = "banner.summary"
const MORE = "banner.more"
const SLIDE = { out: 160, by: 24 }

type RowStage = "enter" | "open" | "rest" | "out" | "shut"

/** One row of the stack: it holds its gap under it, so a shut room leaves none. */
function Row({ fresh, leaving, away, onGone, children }: { fresh: boolean; leaving: boolean; away: boolean; onGone: () => void; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const [stage, setStage] = useState<RowStage>(fresh ? "enter" : "rest")
  const gone = useRef(onGone)
  gone.current = onGone
  // Coherent GT has no ResizeObserver, so the row measures itself after every render.
  useLayoutEffect(() => {
    const measured = inner.current?.offsetHeight ?? 0
    if (measured !== height) setHeight(measured)
  })
  useEffect(() => {
    if (!fresh) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setStage("open"))
    })
    const timer = window.setTimeout(() => setStage((now) => (now === "open" ? "rest" : now)), MOMENT.inAt + MOMENT.in)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [fresh])
  useEffect(() => {
    // Wanted again before it had gone, as a line can be when a card leaves and another arrives, it comes straight back.
    if (!leaving) {
      setStage((now) => (now === "out" || now === "shut" ? "rest" : now))
      return
    }
    const timers: number[] = []
    if (away) setStage("shut")
    else {
      setStage("out")
      timers.push(window.setTimeout(() => setStage("shut"), SLIDE.out))
    }
    timers.push(window.setTimeout(() => gone.current(), (away ? 0 : SLIDE.out) + MOMENT.move))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [leaving, away])
  const look: CSSProperties =
    stage === "enter"
      ? { opacity: 0, transform: `translateX(${SLIDE.by}px)` }
      : stage === "open"
        ? { opacity: 1, transform: "none", transition: `opacity ${MOMENT.in}ms ease-out ${MOMENT.inAt}ms, transform ${MOMENT.in}ms ease-out ${MOMENT.inAt}ms` }
        : stage === "out"
          ? { opacity: 0, transform: `translateX(${SLIDE.by}px)`, transition: `opacity ${SLIDE.out}ms ease-in, transform ${SLIDE.out}ms ease-in` }
          : stage === "shut"
            ? { opacity: 0 }
            : {}
  return (
    <div style={{ height: stage === "enter" || stage === "shut" ? 0 : stage === "rest" ? undefined : height, overflow: stage === "rest" ? "visible" : "hidden", transition: `height ${MOMENT.move}ms ease-in-out` }}>
      <div ref={inner} style={{ paddingBottom: GAP }}>
        <div style={look}>{children}</div>
      </div>
    </div>
  )
}

/** The line at the box's foot that counts the cards waiting, whose Dismiss all shows only when it's needed. */
function MoreLine({ count, onDismissAll }: { count: number; onDismissAll: () => void }) {
  return (
    <div className="pointer-events-auto flex w-full items-center justify-between rounded-4xl bg-card pl-3 pr-1.5 text-xs text-muted-foreground ring-1 ring-inset ring-foreground/10" style={{ height: MORE_LINE }}>
      <span className="flex items-center">
        <span className="mr-1">
          <Rolling value={count} />
        </span>
        more
      </span>
      <Button variant="ghost" size="xs" onClick={onDismissAll}>
        Dismiss all
      </Button>
    </div>
  )
}

/**
 * A notification's first-seen order, newest first. The core lists them by ID, so the page keeps when each arrived, and
 * one that clears and comes back is new again.
 */
function useNewestFirst(notes: Note[]): Note[] {
  const arrived = useRef(new Map<string, number>())
  const next = useRef(1)
  const up = new Set(notes.map((note) => note.id))
  arrived.current.forEach((_, id) => {
    if (!up.has(id)) arrived.current.delete(id)
  })
  notes.forEach((note) => {
    if (!arrived.current.has(note.id)) arrived.current.set(note.id, next.current++)
  })
  return [...notes].sort((a, b) => arrived.current.get(b.id)! - arrived.current.get(a.id)!)
}

export function Stack({ notes, summary, onOpen }: { notes: Note[]; summary: ReactNode; onOpen: (note: Note) => void }) {
  const newest = useNewestFirst(notes)
  // Each card a pilot dismissed or that ran out its time, and whether it had already slid off. A held one stays hidden until its cause ends, and shows again if the cause comes back.
  const [gone, setGone] = useState(new Map<string, boolean>())
  const leave = (id: string, away: boolean) => setGone((now) => new Map(now).set(id, away))
  useEffect(() => {
    const cleared = Array.from(gone.keys()).filter((id) => !notes.some((note) => note.id === id))
    if (cleared.length === 0) return
    setGone((now) => {
      const next = new Map(now)
      cleared.forEach((id) => next.delete(id))
      return next
    })
  }, [notes, gone])
  const live = newest.filter((note) => !gone.has(note.id))

  // Which fit depends on how their words wrap, so each is measured from a copy laid out unseen.
  const measure = useRef<HTMLDivElement>(null)
  const summaryBox = useRef<HTMLDivElement>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  useLayoutEffect(() => {
    const next: Record<string, number> = { [SUMMARY]: summaryBox.current?.offsetHeight ?? heights[SUMMARY] ?? 0 }
    measure.current?.querySelectorAll<HTMLElement>("[data-measure]").forEach((copy) => {
      next[copy.dataset.measure!] = copy.offsetHeight
    })
    if (Object.keys(next).some((id) => next[id] !== heights[id])) setHeights(next)
  })
  const room = BOX.height - (summary ? (heights[SUMMARY] ?? 0) + GAP : 0)
  const placed = place(live, (id) => heights[id] ?? 0, room)

  const lastOrder = useRef<string[]>([])
  const wasWaiting = useRef(new Set<string>())
  const shown = ordered(placed.shown, lastOrder.current, wasWaiting.current)
  useLayoutEffect(() => {
    lastOrder.current = shown.map((note) => note.id)
    wasWaiting.current = new Set(placed.waiting.map((note) => note.id))
  })

  const wanted = [...(summary ? [SUMMARY] : []), ...shown.map((note) => note.id), ...(placed.waiting.length > 0 ? [MORE] : [])]
  const wantedKey = wanted.join()
  const [items, setItems] = useState<Item[]>(() => wanted.map((id) => ({ id })))
  useLayoutEffect(() => {
    setItems((now) => merge(now, wanted, (id) => !!gone.get(id)))
    // The items follow what's wanted, which the key names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey])

  // A card keeps drawing what it last said while it leaves, as the line keeps its last count.
  const last = useRef(new Map<string, Note>())
  live.forEach((note) => last.current.set(note.id, note))
  const lastCount = useRef(0)
  if (placed.waiting.length > 0) lastCount.current = placed.waiting.length

  return (
    <div className="relative flex flex-col" style={{ width: BOX.width }}>
      {items.map((item) => {
        const note = last.current.get(item.id)
        return (
          <Row key={item.id} fresh={!!item.fresh} leaving={!!item.leaving} away={!!item.away} onGone={() => setItems((all) => all.filter((other) => other.id !== item.id))}>
            {item.id === SUMMARY ? (
              <div ref={summaryBox}>{summary}</div>
            ) : item.id === MORE ? (
              <MoreLine count={lastCount.current} onDismissAll={() => setGone(new Map(notes.map((one) => [one.id, false])))} />
            ) : note ? (
              <NoteCard note={note} lifetime={note.once ? ONCE_MS : undefined} onOpen={() => onOpen(note)} onDismiss={() => leave(item.id, true)} onExpire={() => leave(item.id, false)} />
            ) : null}
          </Row>
        )
      })}
      <div ref={measure} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex flex-col" style={{ width: BOX.width }}>
        {live.map((note) => (
          <div key={note.id} data-measure={note.id}>
            <NoteBody note={note} measuring />
          </div>
        ))}
      </div>
    </div>
  )
}
