import assert from "node:assert/strict"
import { test } from "node:test"

import { HASH, VERSION } from "../../messages/ts/stamp.ts"
import { type Env, PageClient, type Socket } from "../src/page-client.ts"

/** A page in the sim, as the page client sees it: sockets that open when told, a clock, and the CommBus. */
class FakePage implements Env {
  sockets: FakeSocket[] = []
  timers: { ms: number; f: () => void; next: number }[] = []
  clock = 0
  hear: (text: string) => void = () => {}
  logs: string[] = []

  connect(port: number): Socket {
    const socket = new FakeSocket(port)
    this.sockets.push(socket)
    return socket
  }
  every(ms: number, f: () => void): void {
    this.timers.push({ ms, f, next: this.clock + ms })
  }
  now(): number {
    return this.clock
  }
  listen(hear: (text: string) => void): void {
    this.hear = hear
  }
  log(message: string): void {
    this.logs.push(message)
  }

  announce(port: number, session: boolean): void {
    this.hear(JSON.stringify({ port, session }))
  }
  advance(ms: number): void {
    const to = this.clock + ms
    for (;;) {
      const due = this.timers.filter((t) => t.next <= to).sort((a, b) => a.next - b.next)[0]
      if (!due) break
      this.clock = due.next
      due.next += due.ms
      due.f()
    }
    this.clock = to
  }
  get last(): FakeSocket {
    const socket = this.sockets[this.sockets.length - 1]
    assert.ok(socket, "the page should have opened a socket")
    return socket
  }
}

class FakeSocket implements Socket {
  onopen: (() => void) | null = null
  onmessage: ((text: string) => void) | null = null
  onclose: (() => void) | null = null
  sent: unknown[] = []
  closed = false
  readonly port: number

  constructor(port: number) {
    this.port = port
  }
  send(text: string): void {
    this.sent.push(JSON.parse(text))
  }
  close(): void {
    this.closed = true
  }
  /** The core takes the socket. */
  accept(): void {
    if (this.onopen) this.onopen()
  }
  /** The core sends a message. */
  say(message: unknown): void {
    if (this.onmessage) this.onmessage(JSON.stringify(message))
  }
  /** The socket closes from the core's side. */
  drop(): void {
    this.closed = true
    if (this.onclose) this.onclose()
  }
}

function started(options: { sessionOnly?: boolean; panel?: string; instruments?: string[] } = {}): { page: FakePage; client: PageClient } {
  const page = new FakePage()
  const client = new PageClient(
    {
      component: options.sessionOnly ? "panel-bridge" : "efb",
      sessionOnly: options.sessionOnly,
      panel: options.panel === undefined ? undefined : () => options.panel,
      instruments: options.instruments && (() => options.instruments!),
    },
    page,
  )
  client.start()
  return { page, client }
}

test("a page connects to the port it hears and says hello with its version, hash, panel, and instruments", () => {
  const { page, client } = started({ sessionOnly: true, panel: "VCockpit01", instruments: ["PFD|side=1"] })
  page.announce(51234, false)
  assert.equal(page.sockets.length, 0, "a cockpit panel connects only once a session runs")
  page.announce(51234, true)
  page.last.accept()
  assert.deepEqual(page.last.sent[0], { t: "hello", component: "panel-bridge", version: VERSION, hash: HASH, panel: "VCockpit01", instruments: ["PFD|side=1"] })
  assert.equal(client.state, "connected")
  page.announce(51234, true)
  assert.equal(page.sockets.length, 1, "the same port again opens nothing")
})

test("a page whose socket closed, or whose core restarted on another port, connects at the next announcement", () => {
  const { page, client } = started()
  page.announce(1000, false)
  page.last.accept()
  page.last.drop()
  assert.equal(client.state, "closed")
  page.announce(1000, false)
  assert.equal(page.sockets.length, 2)
  page.last.accept()
  page.announce(2000, false)
  assert.equal(page.sockets.length, 3)
  assert.equal(page.sockets[1]!.closed, true, "the old core's socket closes")
  assert.equal(page.last.port, 2000)
})

test("a panel told none stays closed until an announcement brings another port or ends the session", () => {
  const { page } = started({ sessionOnly: true, instruments: ["CLOCK"] })
  page.announce(1000, true)
  page.last.accept()
  page.last.say({ t: "none" })
  assert.equal(page.last.closed, true)
  page.announce(1000, true)
  assert.equal(page.sockets.length, 1)
  page.announce(1000, false)
  page.announce(1000, true)
  assert.equal(page.sockets.length, 2, "a new session connects it again")
})

test("each side's alive goes every 2s, and a core quiet for 8s reads as silent with the socket kept", () => {
  const { page, client } = started()
  page.announce(1000, false)
  page.last.accept()
  page.advance(6000)
  assert.equal(page.last.sent.filter((m) => (m as { t: string }).t === "alive").length, 3)
  page.advance(2000)
  assert.equal(client.state, "silent")
  assert.equal(page.last.closed, false)
  page.last.say({ t: "alive" })
  assert.equal(client.state, "connected")
})

test("a send with no socket open is dropped, and a command answers taken or the core's error", async () => {
  const { page, client } = started()
  assert.equal(client.sendUnit("x", 1), false)
  await assert.rejects(client.command("a", null), /no core is connected/)
  page.announce(1000, false)
  page.last.accept()
  const taken = client.command("a", { b: 1 })
  const refused = client.command("c", null)
  page.last.say({ t: "answer", id: 2 })
  page.last.say({ t: "answer", id: 3, error: "unknown" })
  await taken
  await assert.rejects(refused, /unknown/)
})

test("a watched slice is asked for on each socket, and each watcher gets its value", () => {
  const { page, client } = started()
  const seen: unknown[] = []
  client.watch("sim", (v) => seen.push(v))
  page.announce(1000, false)
  page.last.accept()
  assert.deepEqual(page.last.sent[1], { t: "watch", slices: ["sim"] })
  page.last.say({ t: "state", slice: "sim", value: { stage: "menu" } })
  const late: unknown[] = []
  client.watch("sim", (v) => late.push(v))
  assert.deepEqual(seen, [{ stage: "menu" }])
  assert.deepEqual(late, [{ stage: "menu" }], "a later watcher gets the value the core already sent")
})

test("a cockpit panel closes its socket when an announcement says the session ended", () => {
  const { page, client } = started({ sessionOnly: true, panel: "VCockpit01", instruments: ["CLOCK"] })
  page.announce(1000, true)
  page.last.accept()
  page.announce(1000, false)
  assert.equal(page.last.closed, true)
  assert.equal(client.state, "closed")
})

test("a bye reads as quit, which the socket's close doesn't change", () => {
  const { page, client } = started()
  page.announce(1000, false)
  page.last.accept()
  page.last.say({ t: "bye" })
  page.last.drop()
  assert.equal(client.state, "quit")
})
