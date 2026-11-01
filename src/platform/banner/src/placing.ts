// Which cards fit in the banner's box. Cards stack down from its top, newest first, and when they don't fit, the
// oldest one-time cards leave early; held ones keep their places by trouble, then warnings, then information, newest
// first in each; and the rest wait behind a line at the box's foot (record/areas/interface/decisions.md, "The banner
// is a box of opaque cards at the screen's top right").

import { LEVEL_RANK } from "./note.ts"
import type { Note } from "./note.ts"

/** The space between cards, and the height of the line that counts the cards waiting, in the box's pixels. */
export const GAP = 8
export const MORE_LINE = 36

const total = (notes: Note[], height: (id: string) => number) => notes.reduce((sum, note) => sum + height(note.id), 0) + GAP * Math.max(0, notes.length - 1)

/** `notes` comes newest first, and `room` is the box's height left under the summary. */
export function place(notes: Note[], height: (id: string) => number, room: number): { shown: Note[]; waiting: Note[] } {
  let shown = notes
  while (total(shown, height) > room) {
    const oldest = [...shown].reverse().find((note) => note.once)
    if (!oldest) break
    shown = shown.filter((note) => note !== oldest)
  }
  if (total(shown, height) <= room) return { shown, waiting: [] }
  const byRank = [...shown].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || notes.indexOf(a) - notes.indexOf(b))
  const kept: Note[] = []
  for (const note of byRank) {
    if (total([...kept, note], height) <= room - MORE_LINE - GAP) kept.push(note)
  }
  return { shown: notes.filter((note) => kept.includes(note)), waiting: shown.filter((note) => !kept.includes(note)) }
}

/**
 * The order to show `placed` in, given the order last shown: a new card arrives at the top, a card that was waiting
 * behind the line comes out at the foot, where the line said it was, and the cards a pilot has read stay where they
 * were.
 */
export function ordered(placed: Note[], before: string[], wasWaiting: Set<string>): Note[] {
  const kept = before.map((id) => placed.find((note) => note.id === id)).filter((note): note is Note => !!note)
  const added = placed.filter((note) => !kept.includes(note))
  return [...added.filter((note) => !wasWaiting.has(note.id)), ...kept, ...added.filter((note) => wasWaiting.has(note.id))]
}

/** One row of the stack, and how it's moving. */
export type Item = { id: string; fresh?: boolean; leaving?: boolean; away?: boolean }

/**
 * The rows wanted, merged into those shown: a row that's gone stays where it was, leaving, and one that's new goes in
 * after the row it follows. `away` says a row has already slid off by its × or a drag, so its room shuts at once.
 */
export function merge(shown: Item[], wanted: string[], away: (id: string) => boolean): Item[] {
  const out = shown.map((item): Item => (wanted.includes(item.id) ? { id: item.id, fresh: item.fresh } : item.leaving ? item : { ...item, leaving: true, away: away(item.id) }))
  wanted.forEach((id, at) => {
    if (out.some((item) => item.id === id)) return
    const before = wanted
      .slice(0, at)
      .reverse()
      .find((earlier) => out.some((item) => item.id === earlier))
    out.splice(before === undefined ? 0 : out.findIndex((item) => item.id === before) + 1, 0, { id, fresh: true })
  })
  return out
}
