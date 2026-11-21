// Dual Input's icons, from the glyph and the palette: the app's icon, the sky glyph on the apps' background, which
// Windows shows for the desktop app, in its taskbar, and in its tray, and our GitHub organization and Discord server
// show; and the glyph alone in white, as the sim draws every other icon in its toolbar and its EFB, for the banner's
// toolbar button and our app's button in the EFB.
//
//   node tools/icons.ts    writes the files below
//
// GitHub and Discord round an avatar themselves, into a rounded square and a circle, so the avatar is the icon as a
// plain square, which a person uploads in each site's settings.

import fs from "node:fs"
import path from "node:path"

import sharp from "sharp"

import { colors } from "../src/packages/ui/palette/palette.ts"
import { ALONE, GLYPH, glyphBox, ICON, placeGlyph } from "../src/packages/ui/src/glyph.ts"
import { ROOT } from "./lib/repo.ts"
import { main } from "./lib/run.ts"

const ICO = path.join(ROOT, "src", "apps", "desktop", "icons", "icon.ico")
const EFB = path.join(ROOT, "src", "sim-package", "pages", "efb-icon.svg")
const TOOLBAR = path.join(ROOT, "src", "sim-package", "pages", "banner-icon.svg")
const AVATAR = path.join(ROOT, "target", "icons", "avatar.png")

/**
 * The sizes Windows picks from for the program's file, in Explorer, the Start menu, and shortcuts, 16 to 32 at 100% to
 * 200% scaling. The window and the tray take only the 256px one, the ICO's largest, which tauri-codegen embeds (read in
 * tauri-codegen 2.7.4, src/image.rs, `largest_ico_entry`), and Windows shrinks it for them.
 */
const SIZES = [16, 20, 24, 32, 40, 48, 64, 256]
const AVATAR_SIZE = 1024

/**
 * The toolbar's icon on a 64-unit square, as the toolbar icons of other packages are, such as FSLTL's (read in
 * fsltl-traffic-injector 2.0.0, html_ui/icons/toolbar/FSLTL_ICON_TOOLBAR.svg), where the glyph takes a larger share than
 * in the app's icon, to stand as large as their shapes beside it.
 */
const TOOLBAR_SIDE = 64
const TOOLBAR_SHARE = 0.7

type Point = readonly [number, number]
/** A line, or a cubic Bézier curve when it has controls. */
type Segment = { from: Point; to: Point; controls?: readonly [Point, Point] }

/** The glyph's path as segments, for the absolute commands it uses. A command it doesn't use yet stops the tool, rather than drawing it wrong. */
function segments(d: string): Segment[] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? []
  const out: Segment[] = []
  let at: Point = [0, 0]
  let index = 0
  const number = () => Number(tokens[index++])
  while (index < tokens.length) {
    const command = tokens[index++]
    if (command === "M") {
      at = [number(), number()]
    } else if (command === "L" || command === "H") {
      const to: Point = command === "L" ? [number(), number()] : [number(), at[1]]
      out.push({ from: at, to })
      at = to
    } else if (command === "C") {
      const controls: [Point, Point] = [
        [number(), number()],
        [number(), number()],
      ]
      const to: Point = [number(), number()]
      out.push({ from: at, to, controls })
      at = to
    } else {
      throw new Error(`tools/icons.ts draws the glyph's M, L, H, and C commands, and the glyph uses ${command}`)
    }
  }
  return out
}

const round = (value: number) => String(Math.round(value * 100) / 100)
const moved = ([x, y]: Point, scale: number, offset: number): string => `${round(offset + x * scale)} ${round(offset + y * scale)}`

/** The glyph's path with its scale and move worked into its numbers, so no SVG renderer has to apply a transform. */
function placedPath(scale: number, offset: number): string {
  let at: Point | null = null
  const parts: string[] = []
  for (const segment of segments(GLYPH)) {
    if (at === null || at[0] !== segment.from[0] || at[1] !== segment.from[1]) parts.push(`M${moved(segment.from, scale, offset)}`)
    parts.push(segment.controls ? `C${segment.controls.map((point) => moved(point, scale, offset)).join(" ")} ${moved(segment.to, scale, offset)}` : `L${moved(segment.to, scale, offset)}`)
    at = segment.to
  }
  return parts.join("")
}

/** The app's icon as SVG: `rounded` for the program's own, square for an avatar a site rounds itself. */
function appIcon(rounded: boolean): string {
  const { scale, offset } = placeGlyph(ICON.side, ICON.share)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON.side} ${ICON.side}">
  <rect width="${ICON.side}" height="${ICON.side}" rx="${rounded ? ICON.radius : 0}" fill="${colors.background}"/>
  <path d="${placedPath(scale, offset)}" fill="none" stroke="${colors.primary}" stroke-width="${round(ICON.stroke * scale)}" stroke-linecap="round"/>
</svg>
`
}

/** A point on a segment at `t`, from 0 at its start to 1 at its end, and the direction it runs there, as a unit vector. */
function along(segment: Segment, t: number): { point: Point; direction: Point } {
  const { from, to, controls } = segment
  if (!controls) {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    return { point: [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t], direction: [(to[0] - from[0]) / length, (to[1] - from[1]) / length] }
  }
  const [a, b] = controls
  const u = 1 - t
  const point: Point = [0, 1].map((axis) => u * u * u * from[axis]! + 3 * u * u * t * a[axis]! + 3 * u * t * t * b[axis]! + t * t * t * to[axis]!) as unknown as Point
  const slope = [0, 1].map((axis) => 3 * u * u * (a[axis]! - from[axis]!) + 6 * u * t * (b[axis]! - a[axis]!) + 3 * t * t * (to[axis]! - b[axis]!))
  const length = Math.hypot(slope[0]!, slope[1]!)
  return { point, direction: [slope[0]! / length, slope[1]! / length] }
}

/**
 * A segment's stroke as a filled shape with round ends: its two edges, half the stroke out from it on either side, joined
 * by a half circle at each end. The toolbar icons of other packages are filled shapes with no fill of their own, which
 * the toolbar colors, so a stroke of ours could draw as a filled curve there, where its outline can't.
 */
function outline(segment: Segment, half: number, scale: number, offset: number): string {
  const steps = segment.controls ? 32 : 1
  const left: Point[] = []
  const right: Point[] = []
  for (let step = 0; step <= steps; step++) {
    const { point, direction } = along(segment, step / steps)
    const normal: Point = [-direction[1], direction[0]]
    left.push([point[0] + normal[0] * half, point[1] + normal[1] * half])
    right.push([point[0] - normal[0] * half, point[1] - normal[1] * half])
  }
  /** The half circle around an end, from one edge to the other, bulging out along `outward`. */
  const end = (center: Point, side: Point, outward: Point): Point[] =>
    Array.from({ length: 11 }, (_, at) => {
      const angle = ((at + 1) * Math.PI) / 12
      return [center[0] + half * (Math.cos(angle) * side[0] + Math.sin(angle) * outward[0]), center[1] + half * (Math.cos(angle) * side[1] + Math.sin(angle) * outward[1])] as Point
    })
  const last = along(segment, 1)
  const first = along(segment, 0)
  const points = [
    ...left,
    ...end(last.point, [-last.direction[1], last.direction[0]], last.direction),
    ...right.reverse(),
    ...end(first.point, [first.direction[1], -first.direction[0]], [-first.direction[0], -first.direction[1]]),
  ]
  return `M${points.map((point) => moved(point, scale, offset)).join("L")}Z`
}

/**
 * The glyph alone, in white, as one filled shape for each of its segments, on `viewBox`, at `size` if it's given. The
 * EFB's stylesheet fills an app's SVG with its own color, which wins over the white on our root. We haven't read how the
 * toolbar colors an icon, so the white stands in wherever it sets none, and reads on the toolbar's dark buttons.
 */
function alone(scale: number, offset: number, viewBox: string, size = ""): string {
  const shapes = segments(GLYPH).map((segment) => `  <path d="${outline(segment, ALONE.stroke / 2, scale, offset)}"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="${viewBox}" fill="#ffffff">
${shapes.join("\n")}
</svg>
`
}

/** The toolbar's icon: the glyph alone, centered on the toolbar's 64-unit square. */
function toolbarIcon(): string {
  const { scale, offset } = placeGlyph(TOOLBAR_SIDE, TOOLBAR_SHARE)
  return alone(scale, offset, `0 0 ${TOOLBAR_SIDE} ${TOOLBAR_SIDE}`)
}

/**
 * Our app's icon in the EFB: the glyph alone, on a viewBox as tight as its stroke, and as wide as the sim's own apps'
 * icons. The EFB draws each app's tile itself, a 64px square with a gradient, and fills the app's SVG with its content
 * color (read in fs-base-efb 0.1.10, html_ui/efb_ui/efb_os/efb_os.css, `.app-button > .icon-button.icon`), so an icon
 * of our own tile would stand as a square inside its.
 */
function efbIcon(): string {
  const { viewBox, aspect } = glyphBox(ALONE.stroke)
  return alone(1, 0, viewBox, ` width="${ALONE.efbWidth}" height="${round(ALONE.efbWidth * aspect)}"`)
}

/** The app's icon drawn at `size` pixels square, from the SVG rendered at that size rather than shrunk from a large one. */
function draw(rounded: boolean, size: number): Promise<Buffer> {
  return sharp(Buffer.from(appIcon(rounded)), { density: (72 * size) / ICON.side })
    .resize(size, size)
    .png()
    .toBuffer()
}

/** An ICO file of PNG images, which Windows has read since Vista: a 6-byte header, a 16-byte entry per image, then the images. */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  for (const [at, { size, png }] of images.entries()) {
    const entry = 6 + 16 * at
    // A width or height of 256 doesn't fit a byte, and the format writes it as 0.
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  }
  return Buffer.concat([header, ...images.map((image) => image.png)])
}

main(async () => {
  const images = await Promise.all(SIZES.map(async (size) => ({ size, png: await draw(true, size) })))
  fs.writeFileSync(ICO, ico(images))
  fs.writeFileSync(EFB, efbIcon())
  fs.writeFileSync(TOOLBAR, toolbarIcon())
  fs.mkdirSync(path.dirname(AVATAR), { recursive: true })
  fs.writeFileSync(AVATAR, await draw(false, AVATAR_SIZE))
  for (const file of [ICO, EFB, TOOLBAR, AVATAR]) console.log(`wrote ${path.relative(ROOT, file)}`)
})
