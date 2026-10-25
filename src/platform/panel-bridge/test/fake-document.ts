// A cockpit panel's document, faked for Node: elements with fixed rects, events that run their
// capture and bubble phases, `elementFromPoint`, and a pilot who presses, drags, and releases.
// The bridge's tests, a panel module's, and the bench's fake cockpit panel run the bridge and
// its modules over it, since Node has no DOM, and a DOM without layout couldn't hit-test.
//
// It fakes only what the bridge and the panel modules use, as they use it.

export type Rect = { left: number; top: number; width: number; height: number }

type Listener = { f: (e: FakeEvent) => void; capture: boolean }

/** An event as a listener sees it. */
export class FakeEvent {
  readonly type: string
  readonly bubbles: boolean
  readonly isTrusted: boolean
  readonly clientX: number
  readonly clientY: number
  readonly button: number
  readonly buttons: number
  target: FakeNode | null = null
  currentTarget: FakeNode | null = null
  stopped = false;
  /** The properties a page sets on an event, such as the bridge's mark on the events it fires. */
  [key: string]: unknown

  constructor(type: string, init: MouseEventInit, trusted: boolean) {
    this.type = type
    this.bubbles = init.bubbles === true
    this.isTrusted = trusted
    this.clientX = init.clientX ?? 0
    this.clientY = init.clientY ?? 0
    this.button = init.button ?? 0
    this.buttons = init.buttons ?? 0
  }

  stopPropagation(): void {
    this.stopped = true
  }
}

/** What a node of the fake document heard as the event's target: its type, its point, whether it was trusted, and when, in ms on `performance.now()`. */
export type Heard = { type: string; x: number; y: number; trusted: boolean; at: number }

export class FakeNode {
  readonly tagName: string
  /** 1 for an element, 9 for the document, as the DOM numbers them. */
  readonly nodeType: number
  parentNode: FakeNode | null = null
  readonly children: FakeNode[] = []
  readonly heard: Heard[] = []
  private readonly listeners = new Map<string, Listener[]>()

  constructor(tagName: string, nodeType: number) {
    this.tagName = tagName.toUpperCase()
    this.nodeType = nodeType
  }

  addEventListener(type: string, f: (e: FakeEvent) => void, capture?: boolean | AddEventListenerOptions): void {
    const list = this.listeners.get(type) ?? []
    list.push({ f, capture: isCapture(capture) })
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, f: (e: FakeEvent) => void, capture?: boolean | EventListenerOptions): void {
    const list = this.listeners.get(type) ?? []
    const at = list.findIndex((l) => l.f === f && l.capture === isCapture(capture))
    if (at >= 0) list.splice(at, 1)
  }

  /** Runs the event's capture phase from the document down, then its bubble phase back up, as the DOM does. */
  dispatchEvent(event: FakeEvent): boolean {
    event.target = this
    const above: FakeNode[] = []
    for (let at = this.parentNode; at; at = at.parentNode) above.unshift(at)
    for (const node of above) node.run(event, true)
    this.heard.push({ type: event.type, x: event.clientX, y: event.clientY, trusted: event.isTrusted, at: performance.now() })
    this.run(event, true)
    this.run(event, false)
    if (event.bubbles) for (const node of above.reverse()) node.run(event, false)
    return true
  }

  /** How many listeners it has for `type`. */
  listening(type: string): number {
    return (this.listeners.get(type) ?? []).length
  }

  detach(child: FakeNode): void {
    const at = this.children.indexOf(child)
    if (at >= 0) this.children.splice(at, 1)
    child.parentNode = null
  }

  private run(event: FakeEvent, capture: boolean): void {
    if (event.stopped) return
    event.currentTarget = this
    for (const l of (this.listeners.get(event.type) ?? []).slice()) if (l.capture === capture) l.f(event)
  }
}

function isCapture(capture: boolean | EventListenerOptions | undefined): boolean {
  return capture === true || (typeof capture === "object" && capture.capture === true)
}

export class FakeElement extends FakeNode {
  readonly doc: FakeDocument
  readonly attributes = new Map<string, string>()
  readonly style = new FakeStyle()
  /** For an instrument, as the sim's instruments have it, which the bridge's key reads. */
  instrumentIdentifier?: string
  private rect: Rect | null
  private text = ""

  /** Its own text, then its children's, as the DOM reads an element's. */
  get textContent(): string {
    return this.text + this.children.map((c) => (c instanceof FakeElement ? c.textContent : "")).join("")
  }

  set textContent(text: string) {
    this.text = text
  }

  constructor(tagName: string, doc: FakeDocument, rect: Rect | null = null) {
    super(tagName, 1)
    this.doc = doc
    this.rect = rect
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  appendChild<T extends FakeNode>(child: T): T {
    if (child.parentNode) child.parentNode.detach(child)
    this.children.push(child)
    child.parentNode = this
    return child
  }

  removeChild<T extends FakeNode>(child: T): T {
    this.detach(child)
    return child
  }

  contains(other: unknown): boolean {
    for (let at = other as FakeNode | null; at; at = at.parentNode) if (at === this) return true
    return false
  }

  /** Its own rect, or for an element its style places, such as a lock, the rect it's placed at. */
  getBoundingClientRect(): Rect {
    return this.rect ?? this.style.rect(this.doc.viewport) ?? { left: 0, top: 0, width: 0, height: 0 }
  }

  /** Adds a child with a rect of its own, such as a display's button. */
  add(tag: string, rect: Rect): FakeElement {
    return this.appendChild(new FakeElement(tag, this.doc, rect))
  }
}

/** An element's inline style, as the bridge's locks write it: `cssText`, and `pointerEvents`. */
export class FakeStyle {
  private props = new Map<string, string>()

  get cssText(): string {
    return Array.from(this.props, ([k, v]) => `${k}:${v};`).join("")
  }

  set cssText(text: string) {
    this.props = new Map()
    for (const part of text.split(";")) {
      const at = part.indexOf(":")
      if (at > 0) this.props.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
    }
  }

  get pointerEvents(): string {
    return this.props.get("pointer-events") ?? ""
  }

  set pointerEvents(value: string) {
    if (value) this.props.set("pointer-events", value)
    else this.props.delete("pointer-events")
  }

  get(prop: string): string | undefined {
    return this.props.get(prop)
  }

  /** The rect `left`, `top`, `width`, and `height` place a fixed element at, in px or as a share of the viewport. */
  rect(viewport: { width: number; height: number }): Rect | null {
    if (this.props.get("position") !== "fixed") return null
    const px = (prop: string, whole: number): number => {
      const v = this.props.get(prop) ?? "0"
      return v.endsWith("%") ? (whole * parseFloat(v)) / 100 : parseFloat(v)
    }
    return {
      left: px("left", viewport.width),
      top: px("top", viewport.height),
      width: px("width", viewport.width),
      height: px("height", viewport.height),
    }
  }
}

export class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement
  readonly head: FakeElement
  readonly body: FakeElement
  readonly viewport = { width: 1024, height: 768 }

  constructor() {
    super("#document", 9)
    this.documentElement = new FakeElement("html", this)
    this.documentElement.parentNode = this
    this.head = this.documentElement.appendChild(new FakeElement("head", this))
    this.body = this.documentElement.appendChild(new FakeElement("body", this))
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this)
  }

  /** An instrument in the panel, such as a display, with its identifier and its rect. */
  instrument(identifier: string, rect: Rect, url?: string): FakeElement {
    const el = this.body.add(identifier.toLowerCase(), rect)
    el.instrumentIdentifier = identifier
    if (url) el.setAttribute("url", url)
    return el
  }

  /** The topmost element at a point that takes the pointer: the deepest, and of siblings the last. */
  elementFromPoint(x: number, y: number): FakeElement | null {
    let found: FakeElement | null = null
    const visit = (node: FakeNode): void => {
      for (const child of node.children) {
        if (!(child instanceof FakeElement) || child.style.pointerEvents === "none") continue
        const r = child.getBoundingClientRect()
        if (x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height) found = child
        visit(child)
      }
    }
    visit(this.body)
    return found
  }

  querySelectorAll(selector: string): FakeElement[] {
    const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1]
    if (!attribute) throw new Error(`the fake document takes only [attribute] selectors, not ${selector}`)
    const found: FakeElement[] = []
    const visit = (node: FakeNode): void => {
      for (const child of node.children) {
        if (child instanceof FakeElement && child.hasAttribute(attribute)) found.push(child)
        visit(child)
      }
    }
    visit(this.documentElement)
    return found
  }

  /** A synthetic `MouseEvent`, as `new MouseEvent` makes one, which is never trusted. */
  mouseEvent(type: string, init: MouseEventInit): FakeEvent {
    return new FakeEvent(type, init, false)
  }

  // The pilot, whose input is trusted, as the sim's real cockpit input is (measured on MSFS
  // 2024, 2026-08-30, FS Copilot fork, record/pointer-forwarding/docs/build/log.md, "Q03
  // PASSES: a synthetic mouse click drives a React/SVG display").

  press(x: number, y: number, button = 0): void {
    this.pilot("mousedown", x, y, button, bit(button))
  }

  move(x: number, y: number, button = 0): void {
    this.pilot("mousemove", x, y, button, bit(button))
  }

  release(x: number, y: number, button = 0): void {
    this.pilot("mouseup", x, y, button, 0)
  }

  private pilot(type: string, x: number, y: number, button: number, buttons: number): void {
    const target: FakeNode = this.elementFromPoint(x, y) ?? this
    target.dispatchEvent(new FakeEvent(type, { bubbles: true, clientX: x, clientY: y, button, buttons }, true))
  }
}

/** A button's bit in `buttons`: 1 for the left, 4 the middle, 2 the right. */
function bit(button: number): number {
  return button === 0 ? 1 : button === 1 ? 4 : 2
}

/** The fake document, as the DOM types it, for the bridge. */
export function asDocument(doc: FakeDocument): Document {
  return doc as unknown as Document
}

/** A fake element, as the DOM types it. */
export function asElement(el: FakeElement): Element {
  return el as unknown as Element
}
