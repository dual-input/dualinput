// A cockpit panel as the bridge's tests and a panel module's fake it: the fake document, a
// socket the test speaks for the core on, and the page client's clock, which a test moves on.

import type { Env, Socket } from "../../../engines/page-client/src/page-client.ts"
import { PageClient } from "../../../engines/page-client/src/page-client.ts"
import { Bridge, type BridgeEnv } from "../src/bridge.ts"
import { asDocument, FakeDocument } from "./fake-document.ts"

export class FakePanel implements Env, BridgeEnv {
  readonly doc = new FakeDocument()
  readonly document = asDocument(this.doc)
  socket: { s: Socket; sent: { t: string; [k: string]: unknown }[]; closed: boolean } | null = null
  scripts: { src: string; failed: () => void }[] = []
  hear: (text: string) => void = () => {}
  logs: string[] = []
  /** The page client's clock, in ms. */
  time = 0
  private readonly intervals: { ms: number; next: number; f: () => void }[] = []

  connect(): Socket {
    const sent: { t: string }[] = []
    const socket = { s: null as unknown as Socket, sent, closed: false }
    socket.s = { onopen: null, onmessage: null, onclose: null, send: (t) => sent.push(JSON.parse(t)), close: () => (socket.closed = true) }
    this.socket = socket
    return socket.s
  }
  every(ms: number, f: () => void): void {
    this.intervals.push({ ms, next: this.time + ms, f })
  }
  now(): number {
    return this.time
  }
  listen(hear: (text: string) => void): void {
    this.hear = hear
  }
  log(message: string): void {
    this.logs.push(message)
  }
  addScript(src: string, failed: () => void): void {
    this.scripts.push({ src, failed })
  }
  mouseEvent(type: string, init: MouseEventInit): Event {
    return this.doc.mouseEvent(type, init) as unknown as Event
  }

  /** The core announces a session and takes the panel's socket. */
  join(): void {
    this.hear(JSON.stringify({ port: 1000, session: true }))
    this.socket!.s.onopen!()
  }
  /** The core sends the panel `message`. */
  say(message: unknown): void {
    this.socket!.s.onmessage!(JSON.stringify(message))
  }
  /** What the panel sent the core of type `t`, oldest first. */
  sent(t: string): { t: string; [k: string]: unknown }[] {
    return this.socket ? this.socket.sent.filter((m) => m.t === t) : []
  }

  /** Moves the page client's clock on by `ms`, running each of its timers as it falls due. */
  advance(ms: number): void {
    const until = this.time + ms
    for (;;) {
      const due = this.intervals.filter((i) => i.next <= until).sort((a, b) => a.next - b.next)[0]
      if (!due) break
      this.time = due.next
      due.next += due.ms
      due.f()
    }
    this.time = until
  }
}

/** A panel with the bridge started in it, its page client listening. */
export function started(): { panel: FakePanel; bridge: Bridge } {
  const panel = new FakePanel()
  const keys = (): string[] => bridge.keys()
  const client = new PageClient({ component: "panel-bridge", sessionOnly: true, instruments: keys }, panel)
  const bridge = new Bridge(panel, client)
  client.start()
  return { panel, bridge }
}
