// Dual Input's glyph, two lines merging into one, two pilots' inputs flying one aircraft: the path of its stroke on a
// 32-unit square, and how the app's icon places it. The kit's mark and the welcome's picture of the icon draw from these,
// and so does tools/icons.ts, which reads this file in Node, so it stays plain TypeScript with no JSX.

export const GLYPH = "M4 8.5C12 8.5 13.5 16 20.5 16M4 23.5C12 23.5 13.5 16 20.5 16H28"

/** Where the glyph's stroke runs on its square, from (4, 8.5) to (28, 23.5), as its path above has it, so change both together. */
export const GLYPH_BOUNDS = { x: 4, y: 8.5, width: 24, height: 15 } as const

/** The glyph's box as an SVG viewBox that ends at the edges of a stroke `stroke` units wide, and its height over its width. */
export function glyphBox(stroke: number): { viewBox: string; aspect: number } {
  const width = GLYPH_BOUNDS.width + stroke
  const height = GLYPH_BOUNDS.height + stroke
  return { viewBox: `${GLYPH_BOUNDS.x - stroke / 2} ${GLYPH_BOUNDS.y - stroke / 2} ${width} ${height}`, aspect: height / width }
}

/** The glyph drawn alone, as the sim draws an icon in its toolbar and its EFB: a heavier stroke than the app's icon, to stand as heavy as the solid shapes beside it. */
export const ALONE = { stroke: 5 } as const

/**
 * A square SVG viewBox centered on the glyph, as wide as the glyph drawn with a stroke `stroke` units wide. The EFB draws each app's icon 35px
 * tall, as wide as its viewBox's shape, and the sim's own apps' icons are about square, so each fills a 35px square (read
 * in fs-base-efb 0.1.10, html_ui/efb_ui/efb_os/efb_os.css, `.icon-element`). The glyph's own box, 29 by 20, drew it
 * about 50px wide there, so our icon takes this square.
 */
export function glyphSquare(stroke: number): string {
  const side = GLYPH_BOUNDS.width + stroke
  const x = GLYPH_BOUNDS.x - stroke / 2
  const y = GLYPH_BOUNDS.y + GLYPH_BOUNDS.height / 2 - side / 2
  return `${x} ${y} ${side} ${side}`
}

/**
 * The app's icon on a 256-unit square, the sky glyph on the apps' background: its corners' radius, the share of its side
 * the glyph's 32-unit square takes, and the glyph's stroke in its own units.
 */
export const ICON = { side: 256, radius: 48, share: 0.63, stroke: 4.2 } as const

/** How far to scale the glyph's 32-unit square, and how far to move it, to center it at `share` of a square `side` wide. */
export function placeGlyph(side: number, share: number): { scale: number; offset: number } {
  const scale = (side * share) / 32
  return { scale, offset: (side - 32 * scale) / 2 }
}
