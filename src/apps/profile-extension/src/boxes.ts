// The boxes at the end of `watch:` lines, which show each watched name's value during a session's flight, in the kit's
// lime for a live value on a 10% tint of it, in the shape of fsc-editor's box, with 3px corners
// (record/areas/profiles/04-the-extension-in-the-sim.md, "The box"), and after the first box of each entry, its latest
// step in the Sync log, the hint (06-the-sync-log.md, "The hint at the end of a line"). `serve` sends each open file's
// boxes, and this gives each kind its look in each palette. It imports nothing of VS Code's, so Node's test runner tests
// it alone.

import type { Palette } from "./palette.ts"
import { said, textOf, type Word, WORDS } from "./words.ts"

/** What a box holds: a variable's value, an event's firings, as `×3`, or the words of the error that named it wrongly. */
export type BoxKind = "value" | "firing" | "error"

/** An entry's latest step in the Sync log: its row's verdict, as `landed`, and what it carries, as `84ms`. */
export type Hint = { word: Word; detail: string | null; also?: Word }

/** One box, after line `line`, counted from 0 as LSP counts lines, and on the first of an entry's lines, its hint. */
export type Box = { line: number; text: string; kind: BoxKind; hint?: Hint }

/** The server's `dualInput/values` notification: every box of one open file, which replace the file's last. */
export type Values = { uri: string; boxes: Box[] }

export const KINDS: BoxKind[] = ["value", "firing", "error"]

/**
 * The kit's `live`, its `warning`, and its `muted-foreground`, in each palette. `colors` and `lightColors` in
 * src/packages/ui/palette/palette.ts hold the same colors, so change both together; the extension can't import them,
 * since that file brings in Tailwind.
 */
const COLORS: Record<Palette, { live: string; warning: string; muted: string }> = {
  dark: { live: "#c5ee85", warning: "#f1be4d", muted: "#a1a1a1" },
  light: { live: "#4d7c0f", warning: "#b45309", muted: "#737373" },
}

/** How strong the tint behind a box's text is, as the panel's `bg-live/10` draws its live value, so the two read as one thing. */
const TINT = 0.1

/** A box's look, as the `after` of VS Code's `DecorationRenderOptions`. */
export type BoxStyle = { after: { color: string; backgroundColor: string; margin: string; textDecoration: string } }

/**
 * The look of a box of `kind` in `palette`. A value and a firing share the live color, and an error the warning color, so
 * a name the sim refused stands out from a value that reads 0.
 *
 * VS Code's API passes on only some of an `after`'s fields, and drops a corner's radius and padding; it writes
 * `textDecoration` into the box's CSS as it's given, as `text-decoration:{0};`, so the corners and the padding go in
 * after its value (read in VS Code 1.147.0, out/vs/workbench/api/node/extensionHostProcess.js and
 * workbench.desktop.main.js, the decoration's CSS). A VS Code that checked the value would drop that one declaration,
 * and the box would keep its colors with square corners.
 */
export function boxStyle(kind: BoxKind, palette: Palette): BoxStyle {
  const { live, warning } = COLORS[palette]
  const color = kind === "error" ? warning : live
  return { after: { color, backgroundColor: tinted(color), margin: "0 0 0 0.75ch", textDecoration: "none; border-radius: 3px; padding: 0 0.4ch" } }
}

/**
 * A hint's text in two pieces: its word's label, which carries the dotted underline every engine word has, and the rest,
 * as `landed` and ` 84ms`. Each is a decoration of its own, since a decoration's text takes one look.
 */
export function hintText(hint: Hint): { word: string; rest: string } {
  const [, ...rest] = said(hint.word, hint.detail, hint.also ?? null)
  return { word: WORDS[hint.word].label, rest: textOf(rest) }
}

/** A hint piece's look, as the `after` of VS Code's `DecorationRenderOptions`. */
export type HintStyle = { after: { color: string; margin?: string; textDecoration?: string } }

/** The hint's two pieces in `palette`: muted text a space after the box, its word with the dotted underline the Sync log gives a word. */
export function hintStyles(palette: Palette): { word: HintStyle; rest: HintStyle } {
  const color = COLORS[palette].muted
  return {
    word: { after: { color, margin: "0 0 0 1ch", textDecoration: "underline dotted" } },
    rest: { after: { color } },
  }
}

/** A file's boxes by kind, since VS Code draws a kind's boxes with one decoration type and each box gives only its text. */
export function byKind(boxes: Box[]): Record<BoxKind, Box[]> {
  const kinds: Record<BoxKind, Box[]> = { value: [], firing: [], error: [] }
  for (const box of boxes) kinds[box.kind]?.push(box)
  return kinds
}

/** A hex color at the tint's strength, as `rgba(116, 212, 255, 0.1)`. */
function tinted(hex: string): string {
  const [red, green, blue] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
  return `rgba(${red}, ${green}, ${blue}, ${TINT})`
}
