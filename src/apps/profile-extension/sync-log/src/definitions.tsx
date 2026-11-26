// The engine's words in the log, each with a dotted underline, and the one definition the log shows at a time: on a word
// the mouse rests on, open while the mouse moves into it to select its text, or pinned by a click, with a link into the
// authors' docs once they're published
// (record/areas/profiles/06-the-sync-log.md, "What an author sees"). The log holds thousands of words, so one listener
// on the log finds the word under the mouse, rather than a popup of the kit's for each.

import { cx } from "@dualinput/ui"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { HTMLAttributes, MouseEvent as ReactMouseEvent, Ref } from "react"

import { docsLink, isWord, type Word, WORDS } from "../../src/words.ts"

/** How long the mouse rests on a word before its definition opens, in milliseconds. */
const DELAY = 400
/**
 * How long a definition stays open after the mouse leaves its word or the definition, in milliseconds, so the mouse can
 * cross the gap between them and select the definition's text.
 */
const GRACE = 200
/** The definition's distance from its word, and its least distance from the view's edges, in px. */
const GAP = 6
const EDGE = 4

/** A word as the log shows it: its label, with the dotted underline that says it has a definition. */
export function WordText({ word }: { word: Word }) {
  return (
    // The underline is a border, as the kit's links draw theirs, so it sits clear of the letters.
    <span data-word={word} className="cursor-help border-b border-dotted border-muted-foreground/50">
      {WORDS[word].label}
    </span>
  )
}

type Open = { word: Word; anchor: HTMLElement; pinned: boolean }

/** Gives each `WordText` inside it its definition. */
export function Definitions({ children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const [open, setOpen] = useState<Open | null>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const waiting = useRef(0)
  const closing = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(waiting.current)
      window.clearTimeout(closing.current)
    },
    [],
  )
  // A definition the mouse left closes after a moment, unless the mouse comes back to it or its word, or it was pinned.
  const closeSoon = () => {
    window.clearTimeout(closing.current)
    closing.current = window.setTimeout(() => setOpen((now) => (now && !now.pinned ? null : now)), GRACE)
  }

  useLayoutEffect(() => {
    const box = bubble.current
    if (!open || !box) return setPlace(null)
    setPlace(placeOf(open.anchor.getBoundingClientRect(), box))
  }, [open])

  // A scroll moves the definition with its word while the word stays in the list's view, as when a new row comes in at
  // the bottom of a list that follows the newest, and closes it once the word scrolls out; a pinned one also closes on a
  // press outside it or Escape. A browser fires a scroll event a frame after the scroll, so one can come just after the
  // definition opened, from a scroll before it, and only a word that moved since it opened counts.
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(null)
    const was = open.anchor.getBoundingClientRect()
    const list = scrollerOf(open.anchor)
    const onScroll = () => {
      const now = open.anchor.getBoundingClientRect()
      if (now.top === was.top && now.left === was.left) return
      const view = list?.getBoundingClientRect()
      if (view && (now.bottom <= view.top || now.top >= view.bottom)) return close()
      if (bubble.current) setPlace(placeOf(now, bubble.current))
    }
    const onPress = (event: MouseEvent) => {
      const target = event.target as Node
      if (!bubble.current?.contains(target) && !open.anchor.contains(target)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("scroll", onScroll, true)
    if (open.pinned) {
      document.addEventListener("mousedown", onPress)
      document.addEventListener("keydown", onKey)
    }
    return () => {
      window.removeEventListener("scroll", onScroll, true)
      document.removeEventListener("mousedown", onPress)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const wordAt = (event: ReactMouseEvent): { word: Word; anchor: HTMLElement } | null => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-word]") : null
    const word = anchor?.dataset.word
    return anchor && word && isWord(word) ? { word, anchor } : null
  }

  return (
    <div
      {...rest}
      onMouseOver={(event) => {
        const found = wordAt(event)
        if (!found || open?.pinned) return
        if (open?.anchor === found.anchor) return window.clearTimeout(closing.current)
        window.clearTimeout(waiting.current)
        waiting.current = window.setTimeout(() => setOpen({ ...found, pinned: false }), DELAY)
      }}
      onMouseOut={(event) => {
        const found = wordAt(event)
        if (!found || found.anchor.contains(event.relatedTarget as Node | null)) return
        window.clearTimeout(waiting.current)
        closeSoon()
      }}
      onClick={(event) => {
        const found = wordAt(event)
        // A press that ends a selection of the step's words selects them, and pins nothing.
        if (!found || window.getSelection()?.toString()) return
        window.clearTimeout(waiting.current)
        setOpen((now) => (now?.pinned && now.anchor === found.anchor ? null : { ...found, pinned: true }))
      }}
    >
      {children}
      {open && (
        <Bubble
          ref={bubble}
          word={open.word}
          place={place}
          onMouseEnter={() => window.clearTimeout(closing.current)}
          onMouseLeave={closeSoon}
          // A press in the definition, as to select its text, pins it, so it stays open as the selection drags past its edge.
          onMouseDown={() => setOpen((now) => now && { ...now, pinned: true })}
        />
      )}
    </div>
  )
}

/** A definition's place: below its word, or above it where the view's bottom edge would cut it, as in a bottom panel a few rows tall. */
function placeOf(at: DOMRect, box: HTMLElement): { left: number; top: number } {
  const below = at.bottom + GAP
  const top = below + box.offsetHeight <= window.innerHeight - EDGE ? below : Math.max(EDGE, at.top - GAP - box.offsetHeight)
  return { left: Math.max(EDGE, Math.min(at.left, window.innerWidth - EDGE - box.offsetWidth)), top }
}

/** The list a word scrolls in: its nearest ancestor that scrolls. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement) if (/auto|scroll/.test(getComputedStyle(at).overflowY)) return at
  return null
}

type BubbleProps ={ ref: Ref<HTMLDivElement>; word: Word; place: { left: number; top: number } | null } & Pick<HTMLAttributes<HTMLDivElement>, "onMouseEnter" | "onMouseLeave" | "onMouseDown">

function Bubble({ ref, word, place, ...mouse }: BubbleProps) {
  const link = docsLink(word)
  return (
    // In the kit's tooltip's colors, and placed by the window's edges, since the log scrolls inside the view. Its text
    // selects, for an author who copies a definition.
    <div
      ref={ref}
      role="tooltip"
      {...mouse}
      className="fixed z-50 max-w-xs select-text rounded-xl bg-foreground px-3 py-2 text-xs text-background shadow-lg"
      style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? "visible" : "hidden" }}
    >
      <p className="font-medium">{WORDS[word].label}</p>
      <p className="mt-0.5 opacity-80">{WORDS[word].definition}</p>
      {link && (
        <p className="mt-1.5">
          <a href={link} className="border-b border-current">
            In the authors' docs
          </a>
        </p>
      )}
    </div>
  )
}
