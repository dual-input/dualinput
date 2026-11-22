// The boxes at the end of `watch:` lines, which show each watched name's value during a session's flight, in our sky on
// a faint tint of it, as fsc-editor's box had blue text on a 7% blue tint with 3px corners
// (record/areas/profiles/04-the-extension-in-the-sim.md, "The box"). `serve` sends each open file's boxes, and this
// gives each kind its look in each palette. It imports nothing of VS Code's, so Node's test runner tests it alone.

import type { Palette } from "./palette.ts"

/** What a box holds: a variable's value, an event's firings, as `×3`, or the words of the error that named it wrongly. */
export type BoxKind = "value" | "firing" | "error"

/** One box, after line `line`, counted from 0 as LSP counts lines. */
export type Box = { line: number; text: string; kind: BoxKind }

/** The server's `dualInput/values` notification: every box of one open file, which replace the file's last. */
export type Values = { uri: string; boxes: Box[] }

export const KINDS: BoxKind[] = ["value", "firing", "error"]

/**
 * The kit's `primary`, our sky, and its `warning`, in each palette. `colors` and `lightColors` in
 * src/packages/ui/palette/palette.ts hold the same colors, so change both together; the extension can't import them,
 * since that file brings in Tailwind.
 */
const COLORS: Record<Palette, { sky: string; warning: string }> = {
  dark: { sky: "#74d4ff", warning: "#f1be4d" },
  light: { sky: "#0369a1", warning: "#b45309" },
}

/** How strong the tint behind a box's text is, as the panel's `bg-primary/10` draws its live value, so the two read as one thing. */
const TINT = 0.1

/** A box's look, as the `after` of VS Code's `DecorationRenderOptions`. */
export type BoxStyle = { after: { color: string; backgroundColor: string; margin: string; textDecoration: string } }

/**
 * The look of a box of `kind` in `palette`. A value and a firing share the sky, and an error takes the warning color, so
 * a name the sim refused stands out from a value that reads 0.
 *
 * VS Code's API passes on only some of an `after`'s fields, and drops a corner's radius and padding; it writes
 * `textDecoration` into the box's CSS as it's given, as `text-decoration:{0};`, so the corners and the padding go in
 * after its value (read in VS Code 1.147.0, out/vs/workbench/api/node/extensionHostProcess.js and
 * workbench.desktop.main.js, the decoration's CSS). A VS Code that checked the value would drop that one declaration,
 * and the box would keep its colors with square corners.
 */
export function boxStyle(kind: BoxKind, palette: Palette): BoxStyle {
  const { sky, warning } = COLORS[palette]
  const color = kind === "error" ? warning : sky
  return { after: { color, backgroundColor: tinted(color), margin: "0 0 0 0.75ch", textDecoration: "none; border-radius: 3px; padding: 0 0.4ch" } }
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
