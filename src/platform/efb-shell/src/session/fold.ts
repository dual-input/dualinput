// How the session card looks at each point of its fold, as a phone app's collapsing header does: from the
// page's top, the first stretch of scrolling folds the whole card into its row
// (record/areas/interface/decisions.md, "The session card folds with the page's scroll").
//
// The row and the whole card are one card in two forms, both drawn: the whole card in the page's flow, the
// row over its top, hidden until the card folds. On the way, the whole card's content scrolls with the page,
// and the row builds itself at the top as the crew rows reach it, so a pause anywhere looks deliberate. Each of
// the row's heads, and this pilot's Ready, takes over from its twin in the crew list where that twin is,
// scrolling with it until it reaches its place in the row, and sliding sideways into it over the last dock
// pixels before. It's the row's own part that travels, since the crew list is a window of its own that would
// cut off a part leaving it. What's above this pilot's crew row fades as it slides under the card's top edge,
// and everything else below fades as it nears the docked row, so it slides under it rather than across it.
//
// Per scroll this styles the parts directly rather than rendering, so a frame's work is a few dozen writes.
// A part marks itself `data-fold-glide="<key>"`, one that travels with its twin of that key in the other form,
// `data-fold-fade`, one that fades, or `data-fold-follows="<key>"`, one that stands in for the key it isn't the
// twin of, as the count of pilots the row has no room for.

import { placeIn } from "@dualinput/ui"

import { setHeadTurn } from "@dualinput/crew"

/** How long the flight's start takes to unfold a folded card, in milliseconds; how long a wheel rests before a fold it left partway finishes; over how many pixels a part fades as it nears the docked row, and a twin slides sideways; and how much of an animated fold its fades take at either end. */
export const FOLD = { ms: 380, snapAfter: 120, edgeFade: 24, dock: 64, blendOut: 0.4, blendIn: 0.5 }

export type FoldParts = {
  both: HTMLElement
  full: HTMLElement
  row: HTMLElement
  clip: HTMLElement | null
  glidesFull: HTMLElement[]
  glidesRow: HTMLElement[]
  fadesFull: HTMLElement[]
  fadesRow: HTMLElement[]
  standIns: HTMLElement[]
}

const all = (form: HTMLElement, selector: string) => Array.from(form.querySelectorAll<HTMLElement>(selector))

/** The fold's parts in what `inner` holds, or undefined with a form missing. A part marked to fade never takes a gliding part inside it along. */
export function scanFold(inner: HTMLElement | null): FoldParts | undefined {
  const full = inner?.querySelector<HTMLElement>('[data-fold-form="full"]')
  const row = inner?.querySelector<HTMLElement>('[data-fold-form="row"]')
  if (!full || !row || !full.parentElement) return undefined
  const fades = (form: HTMLElement) => all(form, "[data-fold-fade]").filter((part) => !part.querySelector("[data-fold-glide]"))
  return {
    both: full.parentElement,
    full,
    row,
    clip: full.closest<HTMLElement>("[data-fold-clip]"),
    glidesFull: all(full, "[data-fold-glide]"),
    glidesRow: all(row, "[data-fold-glide]"),
    fadesFull: fades(full),
    fadesRow: fades(row),
    standIns: all(row, "[data-fold-follows]"),
  }
}

export const foldRange = ({ full, row }: FoldParts) => full.offsetHeight - row.offsetHeight

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** A part's look in the fold: how far it's moved, for the row's parts that travel, how much of it shows, and for a row's head, how far round to its back it has turned. */
type Look = { x?: number; y?: number; opacity: number; turn?: number }
/** Every part's look, and how much of the whole card shows around its marked parts. */
export type FoldLook = { parts: Map<HTMLElement, Look>; full: number }

/** Back to the whole card at rest, every style the fold set taken off. */
export function clearFold({ full, row, glidesFull, glidesRow, fadesFull, fadesRow, standIns }: FoldParts): void {
  for (const part of [...glidesFull, ...glidesRow, ...fadesFull, ...fadesRow, ...standIns]) {
    part.style.transform = ""
    part.style.opacity = ""
    setHeadTurn(part, undefined)
  }
  full.style.transform = ""
  full.style.opacity = ""
  row.style.opacity = ""
}

/** How the fold looks at `p`, above 0, as a finger scrubs it. It only reads the page. */
export function foldLook(parts: FoldParts, p: number): FoldLook {
  const { both, full, row, clip, glidesFull, glidesRow, fadesFull, fadesRow, standIns } = parts
  const range = foldRange(parts)
  const inForm = (part: HTMLElement, form: HTMLElement) => ({ ...placeIn(part, form), height: part.offsetHeight })
  const twinIn = (part: HTMLElement, others: HTMLElement[]) => others.find((other) => other.dataset.foldGlide === part.dataset.foldGlide)
  /** How much of a part the window it scrolls in shows, from 0 to 1, or all of it outside one. */
  const shown = (part: HTMLElement) => {
    const window = part.closest<HTMLElement>("[data-scroll-window]")
    if (!window) return 1
    const top = placeIn(part, window).y
    const bottom = top + part.offsetHeight
    return Math.min(1, Math.max(0, (Math.min(bottom, window.clientHeight) - Math.max(top, 0)) / (part.offsetHeight || 1)))
  }
  // A crew-list part and its twin in the row: dx and dy take the twin from the part's place to its own, so the twin docks at the scroll -dy.
  const pairs = glidesFull.map((part) => {
    const twin = twinIn(part, glidesRow)
    const from = inForm(part, full)
    const to = twin && inForm(twin, row)
    return { part, twin, from, dx: to ? to.x - from.x : 0, dy: to ? to.y - from.y : 0, shown: shown(part) }
  })
  const docked = pairs.filter((pair) => pair.twin)
  // The page has scrolled `scrolled` into the fold. A twin's approach runs 0 to 1 over the dock pixels before it docks. The docked row ends at dockLine, and this pilot's crew row starts at firstRow.
  const scrolled = p * range
  const dockLine = Math.max(0, ...docked.map((pair) => inForm(pair.twin!, row)).map((to) => to.y + to.height))
  const firstRow = Math.min(...docked.map((pair) => pair.from.y))
  const approach = (dy: number) => (p >= 1 ? 1 : smooth(1 - (-dy - scrolled) / FOLD.dock))
  // Above this pilot's row, a part fades as it slides under the card's top edge, over its own height or edgeFade for a short one; below it, as it nears the docked row.
  const pad = clip ? placeIn(both, clip).y : 0
  const fading = (from: number, top: number, height: number) => smooth(from < firstRow ? (pad + top + height) / Math.max(height, FOLD.edgeFade) : (top - dockLine) / FOLD.edgeFade)
  const look = new Map<HTMLElement, Look>()
  for (const { part, twin, from, dx, dy, shown: seen } of pairs) {
    if (!twin) {
      look.set(part, { opacity: fading(from.y, from.y - scrolled, from.height) })
      continue
    }
    look.set(part, { opacity: 0 })
    const k = approach(dy)
    // As much of it shows as its window showed, and the rest comes in as it nears its place, but no sooner than the fold's first dock pixels: a head scrolled out over the top of a scrolled list is already past its place.
    look.set(twin, { x: -dx * (1 - k), y: p >= 1 ? 0 : Math.max(0, -dy - scrolled), opacity: seen + (1 - seen) * Math.min(k, smooth(scrolled / FOLD.dock)), turn: twin.dataset.foldGlide?.startsWith("head-") ? k : undefined })
  }
  // A crew row's words are gone by the time its head is halfway through its approach.
  for (const part of fadesFull) {
    const at = inForm(part, full)
    const head = part.closest("li")?.querySelector<HTMLElement>("[data-fold-glide]")
    const pair = head && docked.find((candidate) => candidate.part === head)
    look.set(part, { opacity: pair ? 1 - smooth(approach(pair.dy) * 2) : fading(at.y, at.y - scrolled, at.height) })
  }
  for (const part of glidesRow) if (!twinIn(part, glidesFull)) look.set(part, { opacity: smooth((p - 0.8) / 0.2) })
  // A badge rides its head, which carries it, and comes in as the head lands.
  for (const part of fadesRow) {
    const key = part.closest<HTMLElement>("[data-fold-glide]")?.dataset.foldGlide
    const pair = key ? docked.find((candidate) => candidate.part.dataset.foldGlide === key) : undefined
    look.set(part, { opacity: pair ? smooth((approach(pair.dy) - 0.6) / 0.4) : p >= 1 ? 1 : 0 })
  }
  // The count of the crew the row has no room for fades in at its own place when the first head left out would have docked there. It isn't a pilot, so it doesn't fly in from a pilot's row.
  for (const part of standIns) {
    const head = glidesFull.find((candidate) => candidate.dataset.foldGlide === part.dataset.foldFollows)
    look.set(part, { opacity: head ? Math.min(approach(inForm(part, row).y - inForm(head, full).y), smooth(scrolled / FOLD.dock)) : p >= 1 ? 1 : 0 })
  }
  return { parts: look, full: p >= 1 ? 0 : 1 }
}

/** Draws a look, with the whole card scrolled `scrolled` into the fold. A part at its place takes no transform, since a transform blurs text in Coherent GT. */
export function showLook({ full, row }: FoldParts, look: FoldLook, scrolled: number): void {
  full.style.transform = `translateY(${-scrolled}px)`
  full.style.opacity = String(look.full)
  row.style.opacity = "1"
  look.parts.forEach(({ x, y, opacity, turn }, part) => {
    part.style.opacity = String(opacity)
    if (turn !== undefined) setHeadTurn(part, turn)
    if (x !== undefined && y !== undefined) part.style.transform = x || y ? `translate(${x}px, ${y}px)` : ""
  })
}

/**
 * Between two looks at `q`, from 0 to 1, for a fold the page animates rather than a finger scrubs, as one
 * motion rather than the scrub's sequence played fast: what travels goes straight to its place, every part
 * together; what fades out does so over the first `blendOut` of the way; and what fades in over the last `blendIn`.
 */
export function blendLooks(from: FoldLook, to: FoldLook, q: number): FoldLook {
  const fade = (a: number, b: number) => a + (b - a) * (b < a ? smooth(q / FOLD.blendOut) : b > a ? smooth((q - 1 + FOLD.blendIn) / FOLD.blendIn) : 1)
  const parts = new Map<HTMLElement, Look>()
  from.parts.forEach((a, part) => {
    const b = to.parts.get(part) ?? a
    const glides = a.x !== undefined && a.y !== undefined && b.x !== undefined && b.y !== undefined
    parts.set(part, {
      x: glides ? a.x! + (b.x! - a.x!) * q : undefined,
      y: glides ? a.y! + (b.y! - a.y!) * q : undefined,
      opacity: fade(a.opacity, b.opacity),
      turn: a.turn !== undefined && b.turn !== undefined ? a.turn + (b.turn - a.turn) * q : undefined,
    })
  })
  return { parts, full: fade(from.full, to.full) }
}
