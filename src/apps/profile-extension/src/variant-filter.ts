// Filtering a profile's entries by variant: the picker's items, and which entries to fold and unfold as `serve`'s
// `dualInput/folds` changes (record/areas/build/plan.md, "22k Filtering a profile by variant"). It imports nothing of
// VS Code's, so Node's test runner tests it alone.

/** One entry a filter folds: its key's line and its last, each from 0, as LSP counts lines. */
export type Fold = { line: number; last: number }

/** The server's `dualInput/folds`: every entry one profile's filter folds, which replace the profile's last. */
export type Folds = { uri: string; folds: Fold[] }

/** One variant in the picker, ticked while the filter shows it. */
export type Item = { label: string; description?: string; picked: boolean }

/**
 * The picker's variants, in the profile's order, those the filter shows ticked, and the loaded aircraft's marked, since
 * it's usually the one an author tests.
 */
export function pickItems(ids: string[], shown: string[], loaded: string | null): Item[] {
  return ids.map((id) => ({ label: id, ...(id === loaded ? { description: "loaded" } : {}), picked: shown.includes(id) }))
}

/**
 * The key lines to fold and to unfold, from those folded before and those to fold now, both lines of the same text. A
 * line folded before and still to fold is left as it is, so an entry an author opened to read stays open until the
 * filter changes.
 */
export function foldChanges(before: number[], after: number[]): { fold: number[]; unfold: number[] } {
  return { fold: after.filter((line) => !before.includes(line)), unfold: before.filter((line) => !after.includes(line)) }
}

/** One edit, as VS Code reports it: the lines it replaced, from `start` to `end`, and how many line breaks it wrote. */
export type Edit = { start: number; end: number; breaks: number }

/**
 * Folded key lines after an edit, so they stay lines of the text the next folds come for: a line below the edit moves
 * by the lines it added less those it took, and a line inside what it replaced is gone. Without this, an edit above a
 * folded entry would leave its old line, and unfolding that line opens whatever region holds it now, as an author's own
 * fold.
 */
export function shifted(lines: number[], { start, end, breaks }: Edit): number[] {
  const by = breaks - (end - start)
  return lines.flatMap((line) => (line <= start ? [line] : line <= end ? [] : [line + by]))
}
