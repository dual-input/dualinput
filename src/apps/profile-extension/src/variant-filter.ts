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
 * The key lines to fold and to unfold, from those folded before and those to fold now. A line folded before and still
 * to fold is left as it is, so an entry an author opened to read stays open until the filter changes.
 */
export function foldChanges(before: number[], after: number[]): { fold: number[]; unfold: number[] } {
  return { fold: after.filter((line) => !before.includes(line)), unfold: before.filter((line) => !after.includes(line)) }
}
