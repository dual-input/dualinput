// One notification's card. The sim blurs whatever lies behind a panel's painted pixels, and we know no way to turn it
// off, so a card is opaque, with its edge an inset ring and no shadow, since a translucent pixel would show the blur.
// A click anywhere on it opens the EFB app where the notification is explained or acted on; its × or a drag toward
// the screen's edge dismisses it (record/areas/interface/decisions.md, "The banner is a box of opaque cards at the
// screen's top right").

import { EmptyHead, Head } from "@dualinput/crew"
import { Button, cx, mouseIn, part, Room, showPressOn, Spinner, useMoment, useRoot } from "@dualinput/ui"
import { CircleX, Info, TriangleAlert, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import type { Level } from "../../../engines/messages/ts/clients/Level.ts"
import type { Note } from "./note.ts"

/**
 * Takes a card's click from under its content, which lets presses through, so hovering its × or Ready lights that and
 * not the card, with no `:has()`, which Coherent GT isn't measured to have. It carries the card's edge, since its hover
 * fill would cover an edge drawn under it.
 */
export const CARD_LAYER = "absolute inset-x-0 inset-y-0 rounded-4xl ring-1 ring-inset ring-foreground/10 hover:bg-muted"
/** A card nudges down one real pixel while it's pressed, as the kit's buttons do. */
export const CARD_NUDGE = "data-[pressed]:translate-y-[var(--hair)]"

const LEVEL_ICON: Record<Level, ReactNode> = {
  information: <Info className="size-4 text-info" />,
  warning: <TriangleAlert className="size-4 text-warning" />,
  trouble: <CircleX className="size-4 text-destructive" />,
}

/** A press becomes a drag past 6px, so a pointer that wobbles still clicks; let go past a third of its width, or flung faster than 0.5px/ms, a card slides away. */
const DRAG = { start: 6, away: 1 / 3, fling: 0.5, ms: 200 }
/** How far past the box's edge a card slides, to clear the screen's edge. */
const CLEAR = 16

function useDragAway(onAway: () => void, scale: number) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const moved = useRef(false)
  const away = (width: number) => {
    setDx(width + CLEAR)
    window.setTimeout(onAway, DRAG.ms)
  }
  const start = (press: React.MouseEvent<HTMLElement>, card: HTMLElement) => {
    moved.current = false
    const width = card.offsetWidth
    const from = mouseIn(press, scale).x
    let last = { x: from, t: performance.now() }
    let speed = 0
    let d = 0
    const move = (event: MouseEvent) => {
      const x = mouseIn(event, scale).x
      d = Math.max(0, x - from)
      if (!moved.current && d < DRAG.start) return
      moved.current = true
      const now = performance.now()
      speed = (x - last.x) / Math.max(1, now - last.t)
      last = { x, t: now }
      setDragging(true)
      setDx(d)
    }
    const up = () => {
      window.removeEventListener("mousemove", move, true)
      window.removeEventListener("mouseup", up, true)
      setDragging(false)
      if (!moved.current) return
      if (d > width * DRAG.away || speed > DRAG.fling) away(width)
      else setDx(0)
    }
    window.addEventListener("mousemove", move, true)
    window.addEventListener("mouseup", up, true)
  }
  return { dx, dragging, moved, start, away }
}

/** A one-time card goes after its time, which pauses while the pointer rests on it, so it stays as the pilot reaches for it. */
function useLifetime(element: React.RefObject<HTMLElement | null>, lifetime: number | undefined, words: string, onExpire: () => void): void {
  const expire = useRef(onExpire)
  expire.current = onExpire
  useEffect(() => {
    const card = element.current
    if (!lifetime || !card) return
    let left = lifetime
    let since = performance.now()
    let timer = window.setTimeout(() => expire.current(), left)
    const pause = () => {
      window.clearTimeout(timer)
      left -= performance.now() - since
    }
    const resume = () => {
      since = performance.now()
      timer = window.setTimeout(() => expire.current(), left)
    }
    card.addEventListener("mouseenter", pause)
    card.addEventListener("mouseleave", resume)
    return () => {
      window.clearTimeout(timer)
      card.removeEventListener("mouseenter", pause)
      card.removeEventListener("mouseleave", resume)
    }
    // A card whose news moves on starts its time over.
  }, [element, lifetime, words])
}

/**
 * What a card says. A head is 28px, taller than the title's line, so a card led by one centers on it; an icon stands in
 * a box the title's line tall, so it centers on the title whatever follows it. `measuring` draws an empty head, since a
 * card laid out unseen to measure it needs no figure traced.
 */
export function NoteBody({ note, measuring }: { note: Note; measuring?: boolean }) {
  return (
    <div className={cx("pointer-events-none relative flex p-3", note.pilot ? "items-center" : "items-start")}>
      {note.pilot ? (
        <span className="mr-3 flex shrink-0">{measuring ? <EmptyHead /> : <Head pilot={note.pilot} slumped={note.out} />}</span>
      ) : (
        <span className="mr-3 flex h-5 shrink-0 items-center">{note.busy ? <Spinner className="size-4 text-muted-foreground" /> : LEVEL_ICON[note.level]}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col pr-7">
        <span className="text-sm font-medium">{note.text}</span>
        {note.detail && <span className="mt-0.5 text-xs text-muted-foreground">{note.detail}</span>}
        {note.list && (
          <span className="mt-1.5 flex flex-col space-y-0.5 text-xs">
            {note.list.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </span>
        )}
      </span>
    </div>
  )
}

export function NoteCard({ note: given, lifetime, onOpen, onDismiss, onExpire }: { note: Note; lifetime: number | undefined; onOpen: () => void; onDismiss: () => void; onExpire: () => void }) {
  const { scale } = useRoot()
  const card = useRef<HTMLDivElement>(null)
  const nudge = useRef<HTMLDivElement>(null)
  const drag = useDragAway(onDismiss, scale)
  // A held card whose news moves on changes in place: its words fade out, it eases to the new words' height, and they fade in.
  const moment = useMoment(given.text, given)
  const note = moment.shown
  useLifetime(card, lifetime, given.text, onExpire)
  const width = card.current?.offsetWidth ?? 0
  return (
    <div
      ref={card}
      className="pointer-events-auto relative w-full"
      style={{
        transform: `translateX(${drag.dx}px)`,
        opacity: width ? Math.max(0, 1 - drag.dx / width) : 1,
        transition: drag.dragging ? "none" : `transform ${DRAG.ms}ms ease-out, opacity ${DRAG.ms}ms ease-out`,
      }}
    >
      <div ref={nudge} className={cx("relative rounded-4xl bg-card text-card-foreground", CARD_NUDGE)}>
        <button
          type="button"
          aria-label="Open Dual Input on the EFB"
          className={CARD_LAYER}
          onClick={() => {
            if (!drag.moved.current) onOpen()
          }}
          onMouseDown={(press) => {
            if (press.button !== 0) return
            showPressOn(nudge.current!)
            drag.start(press, card.current!)
          }}
        />
        <Room open>
          <div style={part(moment.stage, true)}>
            <NoteBody note={note} />
          </div>
        </Room>
        {/* Eight in from the card's top and right, so the ×s line up down the stack, or on a card that's only a title, centered on its height. */}
        <span className={cx("absolute right-2 flex items-center", note.detail || note.list ? "top-2" : "inset-y-0")}>
          <Button variant="ghost" size="icon-sm" aria-label="Dismiss" className="text-muted-foreground" onClick={() => drag.away(card.current!.offsetWidth)}>
            <X />
          </Button>
        </span>
      </div>
    </div>
  )
}
