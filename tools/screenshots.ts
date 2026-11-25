// Pictures of every state of the apps' screens, for the README and the docs, taken from made-up sessions so no real
// pilot's data shows: each app's dev page runs on its stand-in core, which names each state it can show as a scene, and
// this opens each scene in Edge and saves a picture of it in docs/screenshots/, beside a README.md that shows them all.
//
//   node tools/screenshots.ts                         every scene of every page
//   node tools/screenshots.ts efb                     every scene of the EFB app
//   node tools/screenshots.ts efb james-flying       one scene, as its page lists it: the EFB app's by its ID
//
// A doc links a picture by its path, such as docs/screenshots/efb/james-flying.png. A run of a whole page deletes its
// pictures whose scene is gone, and names each one, since a doc may still link it.
//
// Beside each picture, a JSON file of the same name says where each labeled element shows in it, so the docs site can
// crop a picture around one element, and its build fails when a label it crops around is gone:
//
//   { "width": 1074, "height": 1518, "scale": 2, "elements": [
//     {"role":"button","label":"Host a session","x":83,"y":353,"width":908,"height":83},
//     ...
//   ] }
//
// `width` and `height` are the picture's size in its own pixels, and `scale` is how many of them make one CSS pixel of
// the page, along each axis. An element is a node of Chrome's accessibility tree with a role and a name, the words a
// pilot sees or a screen reader reads, listed in the tree's order. Its `x` and `y` are its top-left corner in the
// picture's pixels from the picture's top-left corner, and its box is cut to what shows, so an element that's hidden,
// under 5% opaque, or clipped out of the picture is left out.
//
// Each page puts three things on `window.DUALINPUT_DEV`: its scenes, `show`, which switches to one, and `shot`, the
// element to picture. It starts on the scene its address names, as `?scene=preflight`. A scene's picture is named for
// it, so the EFB app's scenes are fixed IDs, such as `james-link-lost`, which the page names for people in `names`, and
// the other pages' are still their names. When you add a scene to a page's stand-in, run this for that page.
//
// Every run also draws the repository's social preview, docs/screenshots/social-preview.png, from the EFB app's picture
// of "Flying together" over a night valley from the sim, tools/screenshots/night-valley.webp. The README opens with
// it, and a person uploads it in the repository's settings on GitHub when it changes.

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { chromium, type Browser, type ElementHandle, type Page } from "playwright-core"
import sharp from "sharp"

import { colors } from "../src/packages/ui/palette/palette.ts"
import { GLYPH, glyphBox, ICON } from "../src/packages/ui/src/glyph.ts"
import { KIT } from "./lib/css.ts"
import { buildOnce } from "./lib/dev-pages.ts"
import { ROOT } from "./lib/repo.ts"
import { Failed, main } from "./lib/run.ts"

const OUT = path.join(ROOT, "docs", "screenshots")
const BUILT = path.join(ROOT, "target", "screenshots")
const PREVIEW = path.join(OUT, "social-preview.png")
const PHOTO = path.join(ROOT, "tools", "screenshots", "night-valley.webp")
/** The EFB app's scene the social preview shows. */
const PREVIEW_SCENE = path.join(OUT, "efb", "flying-together.png")

/** The pages this takes, in the order the README shows them, each with its heading there. */
const PAGES = [
  { name: "efb", heading: "The EFB app" },
  { name: "banner", heading: "The banner" },
  { name: "desktop", heading: "The desktop app's window" },
  { name: "welcome", heading: "The welcome after an install" },
] as const

// A picture of the same screen comes out the same, byte for byte, and the tool writes a file only when its bytes differ,
// so after a run git lists only the pictures whose screen changed. The clock is Playwright's, paused from the page's
// start: every scene runs the same 5s of its own time, in 100ms steps. React renders outside that clock, in tasks it
// posts on a MessageChannel, so after each step the page posts tasks of its own on one, which run after React's, and the
// picture is taken again until two in a row match. The standing figure's idle motion followed the browser's timing even
// so, and the EFB app's dev page holds it still (record/areas/build/log.md, 2026-11-21). The clock's date is any fixed
// one, since a page shows times relative to it.
const CLOCK = new Date("2026-11-21T14:05:00Z")
/** How long a scene runs before its picture, in ms of its own time, unless its page names a time of its own for it. */
const RUN_MS = 5000
const STEP_MS = 100
/** How many tasks the page posts after each step, since React yields every 5ms and posts its next task behind ours. */
const BEHIND_REACT = 3
const MATCHING_TRIES = 10
const SCALE = 2
/** How many scenes run at once, each in a browser context of its own. */
const AT_ONCE = 4
/**
 * CSS animations and transitions run on the browser's own time, not the paused clock, and code reads where they've
 * moved things: the standing figure turns toward Host while the start card still rises in, and its idle pose came out
 * different from run to run. So the pages these pictures are of end every animation and transition at once.
 */
const NO_MOTION = "<style>*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }</style>"

/** A scene's file name: its name in lowercase, with a possessive's `'s` and other apostrophes dropped, and a dash between words. */
export function slug(scene: string): string {
  return scene
    .toLowerCase()
    .replace(/'s\b/g, "")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * The page's handle. Playwright sends each function it runs in the page as text, so each one reads the handle itself
 * rather than through a function of ours. A page whose scenes are IDs, as the EFB app's are, gives each the name a person
 * reads in `names`.
 */
type Dev = { DUALINPUT_DEV?: { scenes: string[]; names?: Record<string, string>; times?: Partial<Record<string, number>>; show: (name: string) => void; shot: HTMLElement } }
type Scenes = { scenes: string[]; names: Record<string, string>; times: Partial<Record<string, number>> }

/** A page's address, starting on `scene` with the standing figure held still. */
const fileHref = (file: string) => pathToFileURL(file).href
const fileUrl = (page: string, scene?: string) => `${fileHref(path.join(BUILT, page, "index.html"))}${scene === undefined ? "" : `?scene=${encodeURIComponent(scene)}&still`}`

async function scenesOf(browser: Browser, page: string): Promise<Scenes> {
  const tab = await browser.newPage()
  await tab.goto(fileUrl(page))
  await tab.waitForFunction(() => (window as unknown as Dev).DUALINPUT_DEV?.scenes !== undefined)
  const found = await tab.evaluate(() => {
    const dev = (window as unknown as Dev).DUALINPUT_DEV!
    return { scenes: dev.scenes, names: dev.names ?? {}, times: dev.times ?? {} }
  })
  await tab.close()
  return found
}

/** A labeled element of a picture, as the JSON beside it lists it. */
type Labeled = { role: string; label: string; x: number; y: number; width: number; height: number }
type Box = { left: number; top: number; right: number; bottom: number }

/** Roles of text alone and of the page itself, which no crop is around. */
const TEXT_ROLES = new Set(["StaticText", "InlineTextBox", "LineBreak", "ListMarker", "RootWebArea", "none", "presentation"])

/**
 * Where an element shows in the page, in its CSS pixels from the viewport's corner: its box cut to each ancestor that
 * clips what overflows it, or null where it or an ancestor isn't drawn or is all but see-through. It runs in the page.
 */
function shownBox(this: Node): Box | null {
  if (!(this instanceof Element)) return null
  const own = this.getBoundingClientRect()
  let box = { left: own.left, top: own.top, right: own.right, bottom: own.bottom }
  let opacity = 1
  for (let at: Element | null = this; at; at = at.parentElement) {
    const style = getComputedStyle(at)
    if (style.display === "none" || style.visibility === "hidden") return null
    opacity *= Number(style.opacity)
    if (at !== this && (style.overflowX !== "visible" || style.overflowY !== "visible")) {
      const clip = at.getBoundingClientRect()
      box = { left: Math.max(box.left, clip.left), top: Math.max(box.top, clip.top), right: Math.min(box.right, clip.right), bottom: Math.min(box.bottom, clip.bottom) }
    }
  }
  return opacity < 0.05 || box.right <= box.left || box.bottom <= box.top ? null : box
}

/** Each labeled element that shows in the picture of `shot`, in the accessibility tree's order, with its box in the picture's pixels. */
async function labeledIn(tab: Page, shot: ElementHandle): Promise<Labeled[]> {
  const frame = (await shot.boundingBox())!
  const cdp = await tab.context().newCDPSession(tab)
  await cdp.send("DOM.getDocument", { depth: 0 })
  const { nodes } = await cdp.send("Accessibility.getFullAXTree")
  const found: Labeled[] = []
  for (const node of nodes) {
    const role = node.role?.value
    const label = node.name?.value
    if (node.ignored || typeof role !== "string" || TEXT_ROLES.has(role) || typeof label !== "string" || !label.trim() || node.backendDOMNodeId === undefined) continue
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node.backendDOMNodeId })
    const { result } = await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId!, functionDeclaration: shownBox.toString(), returnByValue: true })
    const box = result.value as Box | null
    if (!box) continue
    const left = Math.max(box.left, frame.x)
    const top = Math.max(box.top, frame.y)
    const right = Math.min(box.right, frame.x + frame.width)
    const bottom = Math.min(box.bottom, frame.y + frame.height)
    if (right <= left || bottom <= top) continue
    const at = (value: number, from: number) => Math.round((value - from) * SCALE)
    found.push({ role, label, x: at(left, frame.x), y: at(top, frame.y), width: at(right, left), height: at(bottom, top) })
  }
  await cdp.detach()
  return found
}

/**
 * Takes one scene's picture as a PNG of up to 256 colors, which drew the same as a full one on the apps' screens and took
 * half the bytes, and the JSON of where its labeled elements show in it.
 */
async function take(tab: Page, page: string, scene: string, runMs: number): Promise<{ picture: Buffer; layout: string }> {
  // The installed clock runs until it's paused, so it starts a minute early, and the pause takes it to the same moment
  // however long the two calls took.
  await tab.clock.install({ time: CLOCK.getTime() - 60_000 })
  await tab.clock.pauseAt(CLOCK)
  await tab.goto(fileUrl(page, scene))
  // A font loads once text that uses it is drawn, and the standing figure keeps the size it first measures, so every
  // font loads before the page's clock starts.
  await tab.evaluate(() => Promise.all(Array.from(document.fonts).map((face) => face.load())))
  const behindReact = () => tab.evaluate((tasks) => new Promise<void>((done) => {
    const channel = new MessageChannel()
    let left = tasks
    channel.port1.onmessage = () => (--left > 0 ? channel.port2.postMessage(null) : done())
    channel.port2.postMessage(null)
  }), BEHIND_REACT)
  for (let step = 0; step < Math.ceil(runMs / STEP_MS); step++) {
    await tab.clock.runFor(STEP_MS)
    await behindReact()
  }
  const element = (await tab.evaluateHandle(() => (window as unknown as Dev).DUALINPUT_DEV!.shot)).asElement()!
  const shoot = () => element.screenshot({ animations: "disabled", caret: "hide", scale: "device" })
  let picture = await shoot()
  for (let tries = 1; ; tries++) {
    await behindReact()
    const again = await shoot()
    if (again.equals(picture)) break
    if (tries === MATCHING_TRIES) throw new Failed(`${page}'s scene ${scene} still changed after ${MATCHING_TRIES} pictures with its clock stopped`)
    picture = again
  }
  const { width, height } = await sharp(picture).metadata()
  const elements = await labeledIn(tab, element)
  return {
    picture: await sharp(picture).png({ palette: true, effort: 10, compressionLevel: 9 }).toBuffer(),
    // One element to a line, so a diff of the file shows the element that moved.
    layout: `{ "width": ${width}, "height": ${height}, "scale": ${SCALE}, "elements": [\n${elements.map((one) => `  ${JSON.stringify(one)}`).join(",\n")}\n] }\n`,
  }
}


/**
 * The social preview, 1280x640 as GitHub asks: the glyph in sky, the name, and the line on the left, over the night
 * valley darkened most behind them, and the EFB app on the right, in a faint sky glow. The valley is cropped so its
 * river of lights runs between the words and the app.
 */
function previewPage(): string {
  const fonts = path.join(KIT, "fonts")
  const stroke = ICON.stroke
  const { viewBox, aspect } = glyphBox(stroke)
  const glyphWidth = 66
  // Geist SemiBold's D starts 6px into its box at the title's 80px, so the glyph, whose box starts at its ink, moves
  // that far right to line up with it.
  const titleInk = 6
  // The words' ink, from the glyph's top to the line's foot, sits 4px above the middle within their box, so the box
  // moves down that far to center them on the card, level with the app beside them.
  const level = 4
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Geist; src: url("${fileHref(path.join(fonts, "Geist-Regular.ttf"))}"); font-weight: 400; }
  @font-face { font-family: Geist; src: url("${fileHref(path.join(fonts, "Geist-SemiBold.ttf"))}"); font-weight: 600; }
  body { margin: 0; }
  .card { position: relative; width: 1280px; height: 640px; overflow: hidden; background: ${colors.background}; font-family: Geist, sans-serif; color: ${colors.foreground}; }
  .photo { position: absolute; inset: 0; background: url("${fileHref(PHOTO)}") no-repeat; background-size: 1825px auto; background-position: -20px -300px; }
  .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(10, 10, 10, 0.86) 0%, rgba(10, 10, 10, 0.72) 42%, rgba(10, 10, 10, 0.5) 100%); }
  .glow { position: absolute; right: -120px; top: -160px; width: 900px; height: 900px; background: radial-gradient(closest-side, rgba(116, 212, 255, 0.12), rgba(116, 212, 255, 0)); }
  .words { position: absolute; left: 96px; top: 0; bottom: 0; width: 600px; display: flex; flex-direction: column; justify-content: center; transform: translateY(${level}px); }
  .words svg { display: block; margin-left: ${titleInk}px; }
  h1 { font-size: 80px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; margin: 48px 0 0; }
  p { font-size: 36px; line-height: 1.3; color: ${colors["muted-foreground"]}; margin: 18px 0 0; }
  sup { font-size: 0.45em; margin-left: 6px; opacity: 0.55; vertical-align: 0.9em; }
  .app { position: absolute; right: 110px; top: 44px; width: 390px; height: 552px; border-radius: 18px; overflow: hidden; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12), 0 30px 80px rgba(0, 0, 0, 0.6); }
  .app img { display: block; width: 100%; height: 100%; }
</style></head><body><div class="card">
  <div class="photo"></div><div class="shade"></div><div class="glow"></div>
  <div class="words">
    <svg viewBox="${viewBox}" width="${glyphWidth}" height="${glyphWidth * aspect}"><path d="${GLYPH}" fill="none" stroke="${colors.primary}" stroke-width="${stroke}" stroke-linecap="round"/></svg>
    <h1>Dual Input</h1>
    <p>Shared cockpit for MSFS 2024<sup>(only)</sup></p>
  </div>
  <div class="app"><img src="${fileHref(PREVIEW_SCENE)}"></div>
</div></body></html>`
}

/** Draws the social preview from the EFB app's picture as it stands in docs/screenshots/. */
async function drawPreview(browser: Browser): Promise<void> {
  const page = path.join(BUILT, "social-preview.html")
  fs.writeFileSync(page, previewPage())
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 640 } })
  const tab = await context.newPage()
  await tab.goto(fileHref(page))
  await tab.evaluate(() => Promise.all(Array.from(document.fonts).map((face) => face.load())))
  const picture = await (await tab.$(".card"))!.screenshot()
  await context.close()
  if (fs.existsSync(PREVIEW) && fs.readFileSync(PREVIEW).equals(picture)) return
  fs.writeFileSync(PREVIEW, picture)
  console.log(`drew ${path.relative(ROOT, PREVIEW)}; upload it in the repository's settings on GitHub, under Social preview`)
}

/** The folder's README.md: each page's pictures in a grid, each under its scene's name and the path a doc links. */
function readme(scenes: Record<string, string[]>, names: Record<string, Record<string, string>>): string {
  const lines = [
    "# Screenshots",
    "",
    "Every state of Dual Input's screens that the apps' dev pages can show, taken from made-up sessions, so no real pilot's data shows.",
    "`node tools/screenshots.ts` writes this folder and this file, so change the tool or a page's scenes rather than either.",
    "A doc links a picture by its path from here, such as `efb/preflight.png`.",
    "",
  ]
  for (const { name, heading } of PAGES) {
    lines.push(`## ${heading}`, "", "<table>")
    const all = scenes[name] ?? []
    for (let row = 0; row < all.length; row += 3) {
      const cells = all.slice(row, row + 3).map((scene) => {
        const file = `${name}/${slug(scene)}.png`
        const shown = names[name]?.[scene] ?? scene
        return `<td valign="top" width="33%"><img src="${file}" width="260" alt="${shown.replace(/"/g, "&quot;")}"><br>${shown}<br><code>${file}</code></td>`
      })
      lines.push(`<tr>${cells.join("")}</tr>`)
    }
    lines.push("</table>", "")
  }
  return lines.join("\n")
}

main(async () => {
  const [onlyPage, onlyScene] = process.argv.slice(2)
  if (onlyPage !== undefined && !PAGES.some((page) => page.name === onlyPage)) throw new Failed(`no page called ${onlyPage}: ${PAGES.map((page) => page.name).join(", ")}`)

  // Every page builds, even for one scene's picture, since the README names every page's scenes.
  for (const { name } of PAGES) await buildOnce(name, path.join(BUILT, name), NO_MOTION)
  let browser: Browser
  try {
    // Drawn by the GPU, a picture can come out a level apart from run to run, which the palette spreads into a changed
    // file, and drawn in software it doesn't (record/areas/build/log.md, 2026-11-21). Text is smoothed in gray, since
    // ClearType's colored edges suit only the screen that drew them.
    browser = await chromium.launch({ channel: "msedge", args: ["--disable-gpu", "--disable-lcd-text"] })
  } catch (error) {
    throw new Failed(`Edge didn't start for playwright-core, which drives the Edge Windows installs: ${(error as Error).message}`)
  }
  try {
    const scenes: Record<string, string[]> = {}
    const names: Record<string, Record<string, string>> = {}
    const times: Record<string, Partial<Record<string, number>>> = {}
    for (const { name } of PAGES) {
      ;({ scenes: scenes[name], names: names[name], times: times[name] } = await scenesOf(browser, name))
      const files = scenes[name]!.map(slug)
      const twice = files.find((file, at) => files.indexOf(file) !== at)
      if (twice) throw new Failed(`two of ${name}'s scenes are both ${twice}.png; rename one in its stand-in`)
    }
    if (onlyScene !== undefined && !scenes[onlyPage!]!.includes(onlyScene)) throw new Failed(`${onlyPage} has no scene called ${onlyScene}`)

    const shots = PAGES.filter(({ name }) => onlyPage === undefined || name === onlyPage).flatMap(({ name }) => scenes[name]!.filter((scene) => onlyScene === undefined || scene === onlyScene).map((scene) => ({ page: name, scene })))
    let changed = 0
    const left = [...shots]
    await Promise.all(
      Array.from({ length: AT_ONCE }, async () => {
        for (let shot = left.shift(); shot !== undefined; shot = left.shift()) {
          // Playwright's clock is a context's, which every tab in it shares, so each scene gets a context of its own.
          const context = await browser.newContext({ deviceScaleFactor: SCALE, viewport: { width: 1280, height: 1400 } })
          const { picture, layout } = await take(await context.newPage(), shot.page, shot.scene, times[shot.page]![shot.scene] ?? RUN_MS)
          await context.close()
          const name = path.join(OUT, shot.page, slug(shot.scene))
          fs.mkdirSync(path.dirname(name), { recursive: true })
          let wrote = false
          for (const [file, bytes] of [[`${name}.png`, picture], [`${name}.json`, Buffer.from(layout)]] as const) {
            if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) continue
            fs.writeFileSync(file, bytes)
            wrote = true
            console.log(`wrote ${path.relative(ROOT, file)}`)
          }
          if (wrote) changed++
        }
      }),
    )

    // A whole page's run deletes its pictures, and their layouts, of scenes that are gone.
    if (onlyScene === undefined) {
      for (const { name } of PAGES.filter((page) => onlyPage === undefined || page.name === onlyPage)) {
        const kept = new Set(scenes[name]!.map(slug))
        const folder = path.join(OUT, name)
        for (const file of fs.existsSync(folder) ? fs.readdirSync(folder) : []) {
          if (/\.(png|json)$/.test(file) && !kept.has(file.replace(/\.(png|json)$/, ""))) {
            fs.rmSync(path.join(folder, file))
            console.log(`deleted ${path.relative(ROOT, path.join(folder, file))}, whose scene is gone; a doc that links it needs another`)
          }
        }
      }
    }
    fs.writeFileSync(path.join(OUT, "README.md"), readme(scenes, names))
    console.log(`${shots.length} ${shots.length === 1 ? "picture" : "pictures"} taken, ${changed} changed`)
    await drawPreview(browser)
  } finally {
    await browser.close()
  }
})
