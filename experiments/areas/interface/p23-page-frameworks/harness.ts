/*
 * What every framework's page runs, in the same order, against the same DOM, so a time differs only by
 * what the framework does. An app gives it an Impl, and each Impl's call changes the DOM before it
 * returns, so a time covers the whole change. The stylesheet is p18's, whose rules apply only inside
 * #dualinput-p18, with the same class names on the same rows.
 *
 * Each burst times its work in JavaScript, then forces layout by reading offsetHeight and times that
 * apart. Paint isn't timed. Bursts run 1s apart inside one loaded page, since repeated loads in the EFB
 * read 3 to 4 times higher than repeated work inside one page ([interface log], p22).
 */

export type Level = "info" | "warning" | "trouble" | "success"
export type RowData = { id: number; name: string; level: Level }

export const LEVELS: Level[] = ["info", "warning", "trouble", "success"]
const CHIP: Record<Level, string> = {
  info: "bg-info/15 text-info",
  warning: "bg-warning/15 text-warning",
  trouble: "bg-destructive/15 text-destructive",
  success: "bg-success/15 text-success",
}
export const chipClass = (level: Level) => "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium " + CHIP[level]
export const ROW_CLASS = "flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm"

// A card about the size of the session card: 12 sections of 14 elements, 168 in all, with a part of 29
// elements that comes and goes, as a refusal or a phase's content does.
export const SECTIONS = Array.from({ length: 12 }, (_, i) => i)
export const SECTION_ROWS = [0, 1, 2]
export const PART_ROWS = [0, 1, 2, 3, 4, 5, 6]

export type Impl = {
  name: string
  mount(root: HTMLElement): void
  create(rows: RowData[]): void
  updateOne(index: number, level: Level): void
  updateAll(levelAt: (index: number) => Level): void
  reverse(): void
  clear(): void
  togglePart(on: boolean): void
  setRoom(open: boolean): void
}

const ROWS = 1000
const BURSTS = 10
const REPEATS = 10
const GAP_MS = 1000
const FEATURES = ["MessageChannel", "queueMicrotask", "setImmediate", "globalThis", "reportError", "WeakRef", "AbortController", "MutationObserver", "ResizeObserver", "PointerEvent"]

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const q = (name: string) => document.querySelector(`[data-p23="${name}"]`) as HTMLElement
const round = (x: number) => Math.round(x * 100) / 100
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// Called as the bundle runs, so the page can tell a bundle that threw, and starts after the bundle's
// run ends, so the time the page reports for parse and first run leaves the mount out.
export function run(impl: Impl) {
  const w = window as any
  w.P23_RAN = true
  setTimeout(() => go(impl), 0)
}

async function go(impl: Impl) {
  const w = window as any
  const errors: string[] = w.P23_ERRORS
  const root = document.getElementById("dualinput-p18") as HTMLElement
  const result: any = {
    framework: impl.name,
    evalMs: w.P23_EVAL_MS,
    userAgent: navigator.userAgent,
    simGlobals: { SimVar: typeof w.SimVar, Coherent: typeof w.Coherent, BaseInstrument: typeof w.BaseInstrument },
    features: {},
    checks: [],
    bursts: [],
    errors,
  }
  for (const f of FEATURES) result.features[f] = typeof w[f] !== "undefined"
  const timed = (work: () => void) => {
    const t0 = performance.now()
    work()
    const t1 = performance.now()
    void root.offsetHeight
    return { js: round(t1 - t0), layout: round(performance.now() - t1) }
  }
  const check = (name: string, ok: boolean, detail?: string) => result.checks.push({ name, ok, detail })
  const data = (): RowData[] => Array.from({ length: ROWS }, (_, id) => ({ id, name: `Row ${id}`, level: LEVELS[id % 4] }))

  try {
    const t0 = performance.now()
    impl.mount(root)
    result.mountMs = round(performance.now() - t0)
    await sleep(50)

    q("press").click()
    q("press").click()
    q("press").click()
    await sleep(50)
    check("a click reaches its handler and updates text", q("pressed").textContent === "Pressed 3 times", q("pressed").textContent ?? "")

    const press = q("press")
    press.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    press.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    press.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await sleep(50)
    check("the EFB's mousedown, mouseup, and click order reaches it too", q("pressed").textContent === "Pressed 4 times", q("pressed").textContent ?? "")

    // A real key changes the field's value natively, so this goes through the prototype's setter when
    // the engine has one, past the copy of the value a controlled field tracks.
    const field = q("field") as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    if (setter) setter.call(field, "DLH4A")
    else field.value = "DLH4A"
    field.dispatchEvent(new Event("input", { bubbles: true }))
    await sleep(50)
    check("typing reaches state, and state the field", q("mirror").textContent === "DLH4A" && field.value === "DLH4A", `mirror ${q("mirror").textContent}, field ${field.value}, prototype setter ${Boolean(setter)}`)

    impl.create(data().slice(0, 4))
    const names = () => Array.prototype.map.call(document.querySelectorAll('[data-p23="row"] > span:first-child'), (e: Element) => e.textContent).join(",")
    const firstRow = document.querySelector('[data-p23="row"]') as HTMLElement
    check("a row lays out with its class", firstRow?.offsetHeight > 0 && getComputedStyle(firstRow).display === "flex", `${firstRow?.offsetHeight}px, ${getComputedStyle(firstRow).display}`)
    impl.reverse()
    check("a keyed reverse keeps the same elements", names() === "Row 3,Row 2,Row 1,Row 0" && document.querySelector('[data-p23="row"]:last-child') === firstRow, names())
    impl.updateOne(0, "trouble")
    check("an update reaches one row's class", /text-destructive/.test((document.querySelector('[data-p23="row"] > span:last-child') as HTMLElement).className))
    impl.clear()
    check("clearing leaves no rows", document.querySelectorAll('[data-p23="row"]').length === 0)

    impl.togglePart(true)
    check("a conditional part mounts", Boolean(q("part")) && q("part").querySelectorAll("*").length === 28, `${q("part")?.querySelectorAll("*").length} elements under it`)
    impl.togglePart(false)
    check("a conditional part goes", !q("part"))

    // A room's height eases to its content's, which the app measures after it renders.
    impl.setRoom(true)
    await sleep(100)
    const during = q("room").offsetHeight
    await sleep(400)
    const after = q("room").offsetHeight
    const inner = q("room-inner").offsetHeight
    check("a room eases open to its measured content", after === inner && inner > 0 && during > 0 && during < inner, `${during}px at 100ms, ${after}px at 500ms, content ${inner}px`)
    impl.setRoom(false)
    await sleep(350)
    check("a room eases shut", q("room").offsetHeight === 0, `${q("room").offsetHeight}px`)

    for (let b = 0; b < BURSTS; b++) {
      await sleep(GAP_MS)
      const burst: any = {}
      const rows = data()
      burst.create = timed(() => impl.create(rows))
      const ones = Array.from({ length: REPEATS }, (_, i) => timed(() => impl.updateOne((i * 97) % ROWS, LEVELS[(i + b) % 4])))
      burst.updateOne = { js: median(ones.map((o) => o.js)), layout: median(ones.map((o) => o.layout)) }
      burst.updateAll = timed(() => impl.updateAll((i) => LEVELS[(i + b + 1) % 4]))
      burst.reverse = timed(() => impl.reverse())
      burst.clear = timed(() => impl.clear())
      const on = Array.from({ length: REPEATS }, () => {
        const shown = timed(() => impl.togglePart(true))
        const hidden = timed(() => impl.togglePart(false))
        return { on: shown, off: hidden }
      })
      burst.partOn = { js: median(on.map((o) => o.on.js)), layout: median(on.map((o) => o.on.layout)) }
      burst.partOff = { js: median(on.map((o) => o.off.js)), layout: median(on.map((o) => o.off.layout)) }
      result.bursts.push(burst)
    }
  } catch (e) {
    errors.push(String((e as Error).stack || e))
  }

  const x = new XMLHttpRequest()
  x.open("POST", w.P23_REPORT_URL || "/result")
  x.setRequestHeader("content-type", "text/plain")
  x.onload = () => {
    const next = JSON.parse(x.responseText).next
    if (next) location.replace(next)
  }
  x.send(JSON.stringify(result))
}
