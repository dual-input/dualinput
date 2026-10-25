/*
 * p18's page: a small app on the MSFS Avionics Framework's FSComponent, from
 * @microsoft/msfs-sdk 2.3.3, styled with Tailwind 3 in the look
 * record/areas/interface/decisions.md records. It renders, runs its own checks of
 * what a component kit of ours would lean on, and posts what it found to the server
 * that served it, so the same page answers in Edge, the browser pane, or the sim.
 *
 * FSComponent sets every JSX prop on an element with setAttribute, so it has no
 * onClick: a component listens through a ref, after it renders (read in
 * msfssdk.js, FSComponent.buildComponent).
 */

import {
  ArraySubject,
  DisplayComponent,
  FSComponent,
  MappedSubject,
  Subject,
  SubscribableArrayEventType,
  type NodeReference,
  type Subscribable,
  type VNode,
} from "@microsoft/msfs-sdk"

type Level = "info" | "warning" | "trouble" | "success"

const CHIP: Record<Level, string> = {
  info: "bg-info/15 text-info",
  warning: "bg-warning/15 text-warning",
  trouble: "bg-destructive/15 text-destructive",
  success: "bg-success/15 text-success",
}

const chipClass = (level: Level) =>
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium " + CHIP[level]

class Chip extends DisplayComponent<{ level: Subscribable<Level>; label: Subscribable<string>; ref?: NodeReference<any> }> {
  render(): VNode {
    return <span data-p18="chip" class={this.props.level.map(chipClass)}>{this.props.label}</span>
  }
}

class Button extends DisplayComponent<{ onPress: () => void; variant?: "primary" | "outline"; id?: string; children?: any }> {
  private readonly el = FSComponent.createRef<HTMLButtonElement>()

  onAfterRender(): void {
    this.el.instance.addEventListener("click", () => this.props.onPress())
  }

  render(): VNode {
    const look =
      this.props.variant === "outline"
        ? "border border-input bg-transparent text-foreground hover:bg-muted"
        : "bg-primary text-primary-foreground hover:bg-primary/90"
    return (
      <button
        ref={this.el}
        id={this.props.id ?? ""}
        class={"inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors " + look}
      >
        {this.props.children}
      </button>
    )
  }
}

class TextField extends DisplayComponent<{ value: Subject<string>; placeholder: string; id: string }> {
  private readonly el = FSComponent.createRef<HTMLInputElement>()

  onAfterRender(): void {
    const input = this.el.instance
    input.addEventListener("input", () => this.props.value.set(input.value))
    this.props.value.sub((v) => { if (input.value !== v) input.value = v }, true)
  }

  render(): VNode {
    return (
      <input
        ref={this.el}
        id={this.props.id}
        placeholder={this.props.placeholder}
        class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
    )
  }
}

type Pilot = { name: string; level: Level }

class PilotRow extends DisplayComponent<{ pilot: Pilot }> {
  render(): VNode {
    return (
      <li data-p18="pilot" class="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
        <span>{this.props.pilot.name}</span>
        <Chip level={Subject.create(this.props.pilot.level)} label={Subject.create(this.props.pilot.level)} />
      </li>
    )
  }
}

// The framework has no list bound to an ArraySubject, so this is the kit's own:
// it renders a row per item and destroys a row's component when its item goes.
class PilotList extends DisplayComponent<{ pilots: ArraySubject<Pilot> }> {
  private readonly el = FSComponent.createRef<HTMLUListElement>()
  private readonly rows: { node: VNode; el: HTMLElement }[] = []

  onAfterRender(): void {
    this.props.pilots.sub((index, type, item) => {
      if (type === SubscribableArrayEventType.Added) {
        const items = Array.isArray(item) ? item : [item as Pilot]
        items.forEach((pilot, i) => this.insert(index + i, pilot))
      } else if (type === SubscribableArrayEventType.Removed) {
        const count = Array.isArray(item) ? item.length : 1
        for (let i = 0; i < count; i++) this.removeAt(index)
      } else {
        while (this.rows.length) this.removeAt(0)
      }
    }, true)
  }

  private insert(index: number, pilot: Pilot) {
    const node = <PilotRow pilot={pilot} />
    const before = this.rows[index]
    if (before) FSComponent.renderBefore(node, before.el)
    else FSComponent.render(node, this.el.instance)
    const el = before ? (before.el.previousElementSibling as HTMLElement) : (this.el.instance.lastElementChild as HTMLElement)
    this.rows.splice(index, 0, { node, el })
  }

  private removeAt(index: number) {
    const [row] = this.rows.splice(index, 1)
    FSComponent.remove(row.el)
    FSComponent.shallowDestroy(row.node)
  }

  render(): VNode {
    return <ul ref={this.el} class="space-y-2" />
  }
}

const presses = Subject.create(0)
const status = Subject.create<Level>("info")
const callsign = Subject.create("")
const pilots = ArraySubject.create<Pilot>([])
const pressedLabel = MappedSubject.create(([n]) => `Pressed ${n} ${n === 1 ? "time" : "times"}`, presses)
const statusLabel = status.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
const selected = Subject.create(false)
const width = Subject.create("40%")

const LEVELS: Level[] = ["info", "warning", "trouble", "success"]

const app = (
  <div class="mx-auto max-w-md space-y-4 p-4 font-sans text-foreground">
    <div class="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
      <span data-p18="title" class="text-sm font-semibold">Dual Input</span>
      <Chip level={status} label={statusLabel} />
    </div>
    <div class="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div class="text-sm text-muted-foreground">p18: the MSFS Avionics Framework outside the sim</div>
      <div class="flex items-center space-x-2">
        <Button id="press" onPress={() => presses.set(presses.get() + 1)}>Press</Button>
        <Button id="status" variant="outline" onPress={() => status.set(LEVELS[(LEVELS.indexOf(status.get()) + 1) % LEVELS.length])}>
          Next status
        </Button>
        <span data-p18="pressed" class="text-sm text-muted-foreground">{pressedLabel}</span>
      </div>
      <TextField id="callsign" value={callsign} placeholder="Callsign" />
      <div class="text-sm">Typed: <span data-p18="mirror" class="font-mono">{callsign}</span></div>
      <div data-p18="toggled" class={{ "rounded-md": true, "h-2": true, "bg-primary": true, "ring-2": selected, "ring-ring": selected }} style={{ width }} />
    </div>
    <div class="space-y-3 rounded-lg border border-border bg-card p-4">
      <div class="flex items-center space-x-2">
        <Button id="add" variant="outline" onPress={() => pilots.insert({ name: `Pilot ${pilots.length + 1}`, level: LEVELS[pilots.length % 4] })}>Add pilot</Button>
        <Button id="remove" variant="outline" onPress={() => { if (pilots.length) pilots.removeAt(0) }}>Remove first</Button>
      </div>
      <PilotList pilots={pilots} />
    </div>
    <pre data-p18="report" class="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground" />
  </div>
)

// ---------------------------------------------------------------- the checks

type Check = { name: string; ok: boolean; detail?: string }

const q = (name: string) => document.querySelector(`[data-p18="${name}"]`) as HTMLElement
const press = (id: string, times = 1) => { for (let i = 0; i < times; i++) (document.getElementById(id) as HTMLElement).click() }

function runChecks(): Check[] {
  const out: Check[] = []
  const check = (name: string, ok: boolean, detail?: string) => out.push({ name, ok, detail })

  check("renders the tree", q("title").textContent === "Dual Input")

  press("press", 3)
  check("a click updates text bound to a MappedSubject", q("pressed").textContent === "Pressed 3 times", q("pressed").textContent ?? "")

  press("status")
  const chip = q("chip")
  check("a class bound to a subject follows it", /text-warning/.test(chip.className) && chip.textContent === "Warning", chip.className)

  selected.set(true)
  width.set("75%")
  const toggled = q("toggled")
  check("a class record toggles a class", toggled.classList.contains("ring-2"), toggled.className)
  check("a style record binds a style", toggled.style.width === "75%", toggled.style.width)

  press("add", 3)
  press("remove")
  const names = Array.prototype.map.call(document.querySelectorAll('[data-p18="pilot"] > span:first-child'), (e: Element) => e.textContent).join(",")
  check("an ArraySubject list adds and removes rows in order", names === "Pilot 2,Pilot 3", names)

  const input = document.getElementById("callsign") as HTMLInputElement
  input.value = "DLH4A"
  input.dispatchEvent(new Event("input"))
  check("typing reaches a subject", q("mirror").textContent === "DLH4A", q("mirror").textContent ?? "")
  callsign.set("BAW12")
  check("a subject reaches the field", input.value === "BAW12", input.value)

  // FSComponent keeps no handle on the subscriptions a prop binding makes, so a
  // removed element stays subscribed to a subject that outlives it.
  const longLived = Subject.create("before")
  const host = document.createElement("div")
  FSComponent.render(<span data-p18="orphan">{longLived}</span>, host)
  const orphan = host.firstElementChild as HTMLElement
  FSComponent.remove(orphan)
  longLived.set("after")
  check("a binding outlives its removed element (a leak the kit must own)", orphan.textContent === "after", orphan.textContent ?? "")

  const big = ArraySubject.create<Pilot>([])
  const stage = document.createElement("div")
  document.body.appendChild(stage)
  FSComponent.render(<PilotList pilots={big} />, stage)
  const t0 = performance.now()
  const many: Pilot[] = []
  for (let i = 0; i < 1000; i++) many.push({ name: `Row ${i}`, level: LEVELS[i % 4] })
  big.set(many)
  const ms = performance.now() - t0
  const rows = stage.querySelectorAll("li").length
  big.clear()
  const left = stage.querySelectorAll("li").length
  stage.parentNode && stage.parentNode.removeChild(stage)
  check("1,000 rows render and clear", rows === 1000 && left === 0, `${ms.toFixed(1)}ms for ${rows} rows, ${left} left after clear`)

  return out
}

// ---------------------------------------------------------------- the report

const errors: string[] = []
window.addEventListener("error", (e) => errors.push(String(e.message)))

function report(checks: Check[]) {
  const result = {
    page: location.pathname,
    userAgent: navigator.userAgent,
    simGlobals: { SimVar: typeof w.SimVar, Coherent: typeof w.Coherent, BaseInstrument: typeof w.BaseInstrument },
    checks,
    errors,
  }
  w.DUALINPUT_P18_RESULT = result
  q("report").textContent = checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`).join("\n")
  const x = new XMLHttpRequest()
  x.open("POST", w.DUALINPUT_P18_REPORT_URL || "/result")
  // text/plain keeps a post from the EFB's coui:// page to 127.0.0.1 a simple
  // request, with no preflight, as p09's EFB app posts.
  x.setRequestHeader("content-type", "text/plain")
  x.send(JSON.stringify(result))
}

// The page's styles apply only inside #dualinput-p18, so p19's EFB app can host
// it without restyling the EFB. That app sets DUALINPUT_P18_MANUAL before this
// bundle runs and calls DUALINPUT_P18_START once it has a place for the page.
function start(root: HTMLElement | null) {
  try {
    FSComponent.render(app, root)
    report(runChecks())
  } catch (e) {
    errors.push(String((e as Error).stack || e))
    report([])
  }
}

const w = window as any
w.DUALINPUT_P18_START = start
if (!w.DUALINPUT_P18_MANUAL) start(document.getElementById("dualinput-p18"))
