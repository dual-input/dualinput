// The bench's fake pages, which stand in for the sim's pages from the socket outward: each
// hears the stand-in's announcement, as a page hears the core's on the CommBus, and runs our
// own page-client over the core's real WebSocket, sending the sim's Origin, so the core
// can't tell a fake page from a real one (record/areas/build/02-testing.md, "The sim's pages").

import type { Played } from "../../src/engines/messages/ts/bench/Played.ts"
import type { EfbAppOrder } from "../../src/engines/messages/ts/clients/EfbAppOrder.ts"
import type { FromClient } from "../../src/engines/messages/ts/clients/FromClient.ts"
import type { Notification } from "../../src/engines/messages/ts/clients/Notification.ts"
import type { NotificationClicked } from "../../src/engines/messages/ts/clients/NotificationClicked.ts"
import type { ToClient } from "../../src/engines/messages/ts/clients/ToClient.ts"
import type { JsonValue } from "../../src/engines/messages/ts/serde_json/JsonValue.ts"
import type { SetPause } from "../../src/engines/messages/ts/rate-and-pause/SetPause.ts"
import type { MenuPage } from "../../src/engines/messages/ts/sim/MenuPage.ts"
import type { WorldMapAnswer } from "../../src/engines/messages/ts/sim/WorldMapAnswer.ts"
import type { WorldMapCall } from "../../src/engines/messages/ts/sim/WorldMapCall.ts"
import type { WorldMapOutcome } from "../../src/engines/messages/ts/sim/WorldMapOutcome.ts"
import type { WorldMapRequest } from "../../src/engines/messages/ts/sim/WorldMapRequest.ts"
import { HASH, VERSION } from "../../src/engines/messages/ts/stamp.ts"
import { type Env, PageClient, type Socket } from "../../src/engines/page-client/src/page-client.ts"
import type { Core } from "./cores.ts"
import { type Aircraft, RTC_END, RTC_START } from "./flights.ts"

/** What every page in the sim sends as its Origin, which the core takes (decision 013). */
export const SIM_ORIGIN = "coui://html_ui"

/** A message's budget (record/areas/core/02-clients-and-panel-bridge.md, "Budgets"). */
const MESSAGE_BUDGET = 64 * 1024

export type FakePageOptions = { component: string; sessionOnly?: boolean; panel?: string; instruments?: string[] }

/** One message from the core, with when it came, in ms since the page started. */
export type Received = { at: number; socket: number; message: ToClient; bytes: number }

export class FakePage {
  readonly client: PageClient
  readonly received: Received[] = []
  /** When each socket opened, in ms since the page started, oldest first. */
  readonly opened: number[] = []
  private readonly started = performance.now()
  private readonly timers: ReturnType<typeof setInterval>[] = []
  private readonly sockets: WebSocket[] = []
  private hear: (text: string) => void = () => {}
  private unlisten: () => void = () => {}

  constructor(core: Core, options: FakePageOptions) {
    const page = this
    const env: Env = {
      connect(port: number): Socket {
        const n = page.sockets.length
        // Node's WebSocket takes headers through a second argument the web's doesn't.
        const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: SIM_ORIGIN } } as unknown as string[])
        page.sockets.push(ws)
        const socket: Socket = { onopen: null, onmessage: null, onclose: null, send: (t) => ws.send(t), close: () => ws.close() }
        ws.onopen = () => {
          page.opened.push(page.now())
          socket.onopen?.()
        }
        ws.onmessage = (event) => {
          const text = String(event.data)
          page.received.push({ at: page.now(), socket: n, message: JSON.parse(text) as ToClient, bytes: Buffer.byteLength(text) })
          socket.onmessage?.(text)
        }
        ws.onerror = () => {}
        ws.onclose = () => socket.onclose?.()
        return socket
      },
      every(ms, f) {
        page.timers.push(setInterval(f, ms))
      },
      now: () => Date.now(),
      listen(hear) {
        page.hear = hear
      },
      log() {},
    }
    this.client = new PageClient(
      {
        component: options.component,
        sessionOnly: options.sessionOnly,
        panel: options.panel === undefined ? undefined : () => options.panel,
        instruments: options.instruments && (() => options.instruments!),
      },
      env,
    )
    this.client.start()
    this.listenTo(core)
  }

  /** Hears `core`'s announcements from now on, in place of the core it heard before, as a page hears a restarted core. */
  listenTo(core: Core): void {
    this.unlisten()
    this.unlisten = core.onCommBus((name, data) => {
      if (name === "DUALINPUT_CORE_ANNOUNCE") this.hear(data)
    })
  }

  now(): number {
    return performance.now() - this.started
  }

  /** The messages the core sent of type `t`, oldest first. */
  messages<T extends ToClient["t"]>(t: T): Extract<ToClient, { t: T }>[] {
    return this.received.filter((r) => r.message.t === t).map((r) => r.message as Extract<ToClient, { t: T }>)
  }

  /** Each message over its 64 KiB budget. */
  overBudget(): Received[] {
    return this.received.filter((r) => r.bytes > MESSAGE_BUDGET)
  }

  /** The newest value of a slice the page watches, as the core last sent it. */
  slice(name: string): JsonValue | undefined {
    const states = this.messages("state").filter((m) => m.slice === name)
    return states.at(-1)?.value
  }

  /** Waits until `ok` holds, checking every 20ms, for at most `ms`. */
  async until(ok: () => boolean, what: string, ms = 10_000): Promise<void> {
    const started = performance.now()
    while (!ok()) {
      if (performance.now() - started > ms) throw new Error(`${what} didn't happen within ${ms}ms`)
      await new Promise((r) => setTimeout(r, 20))
    }
  }

  /** Stops the page: its timers, its socket, and its listening. */
  close(): void {
    this.unlisten()
    for (const timer of this.timers) clearInterval(timer)
    for (const ws of this.sockets) ws.close()
  }
}

/**
 * The menu script, as the bench fakes it: a page that joins as `menu-script` and answers the
 * sim service's ask with the master page the scenario gives, `main` for the main menu's and
 * `in-game` for a flight's, and each world map request as `answer` says, by default as done
 * (record/areas/session/02-units.md, "The menu script"). Its aircraft list holds `aircraft`, and
 * the flight it starts loads the one selected, as the sim's load signals it on the core's stand-in.
 */
export class FakeMenuScript extends FakePage {
  /** Each world map request, oldest first. */
  readonly requests: WorldMapRequest[] = []
  /** Answers each request; a scenario replaces it to make a step fail or find no match. */
  answer: (request: WorldMapRequest) => WorldMapOutcome | undefined = () => undefined
  /** How long each kind of request's answer waits after the world map has acted, in ms, as the launch's answer can come after the load it started. */
  late: Partial<Record<WorldMapRequest["do"], number>> = {}
  /** The aircraft list, which a scenario changes as a pilot installs or removes an aircraft. */
  aircraft: Aircraft[]
  private readonly core: Core
  private master: MenuPage
  private selected: Aircraft | undefined

  constructor(core: Core, master: MenuPage, aircraft: Aircraft[] = []) {
    super(core, { component: "menu-script" })
    this.core = core
    this.master = master
    this.aircraft = aircraft
    this.client.onUnit("sim-service", (body) => {
      const asked = body as Partial<WorldMapCall>
      if (typeof asked.call !== "number" || !asked.request) {
        this.client.sendUnit("sim-service", { master: this.master })
        return
      }
      this.requests.push(asked.request)
      const outcome = this.answer(asked.request) ?? this.carryOut(asked.request)
      const answer: WorldMapAnswer = { call: asked.call, outcome }
      const late = this.late[asked.request.do] ?? 0
      if (late > 0) setTimeout(() => this.client.sendUnit("sim-service", answer), late)
      else this.client.sendUnit("sim-service", answer)
    })
  }

  /** Reports another master page, as the script reports a change of page. */
  show(master: MenuPage): void {
    this.master = master
    this.client.sendUnit("sim-service", { master })
  }

  /** What the world map does with a request no scenario answers itself. */
  private carryOut(request: WorldMapRequest): WorldMapOutcome {
    const listed = (folder: string) => this.aircraft.find((a) => a.path.split("/")[0]!.toLowerCase() === folder.toLowerCase())
    switch (request.do) {
      case "find-aircraft":
        return listed(request.folder) ? { as: "done" } : { as: "no-match" }
      case "aircraft":
        this.selected = listed(request.folder)
        return this.selected ? { as: "done" } : { as: "no-match" }
      case "launch-flight": {
        // The load as the sim sends it, up to the Ready to fly screen.
        const cfg = (this.selected ?? this.aircraft[0])?.cfg ?? ""
        const signals: Played[] = [
          { after_ms: 20, signal: { signal: "flight-loaded", path: "x.FLT" } },
          { after_ms: 20, signal: { signal: "aircraft-loaded", path: cfg } },
          { after_ms: 20, signal: { signal: "flow", event: RTC_START } },
        ]
        this.core.act({ act: "play", signals })
        return { as: "done" }
      }
      case "ready-to-fly":
        this.core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "flow", event: RTC_END } }] })
        return { as: "done" }
      default:
        return { as: "done" }
    }
  }
}

export function fakeMenuScript(core: Core, master: MenuPage): FakeMenuScript {
  return new FakeMenuScript(core, master)
}

/**
 * The EFB app, as the bench fakes it: a page that joins as `efb-app`, watches whether a
 * banner page's socket is open, as its code does to open the banner, and keeps each order the
 * clients crate sends it (record/areas/interface/01-apps.md). `component::EFB_APP` in
 * src/engines/messages/src/clients.rs names its component too.
 */
export class FakeEfbApp extends FakePage {
  /** Each order from the clients crate, oldest first. */
  readonly orders: EfbAppOrder[] = []

  constructor(core: Core) {
    super(core, { component: "efb-app" })
    this.client.onUnit("clients", (body) => this.orders.push(body as EfbAppOrder))
    this.client.watch("banner", () => {})
  }

  /** Whether a banner page's socket is open, as the core last said. */
  bannerOpen(): boolean {
    return this.slice("banner") === true
  }

  /** Each active pause rate and pause's part was asked for, oldest first. */
  readonly pauses: boolean[] = []
  /** How long the toolbar's call takes to bring its flag back, in ms. */
  toolbarLateMs = 0

  /**
   * Makes rate and pause's part's toolbar call, as the EFB app's part does, by playing
   * `Pause_EX1` with active pause's flag, 4, on `core`'s stand-in, which the sim sends when the
   * call turns it on or off (record/areas/session/02-units.md, "Rate and pause").
   */
  makesToolbarCall(core: Core): void {
    this.client.onUnit("rate-and-pause", (body) => {
      const { on } = body as SetPause
      this.pauses.push(on)
      core.act({ act: "play", signals: [{ after_ms: this.toolbarLateMs, signal: { signal: "pause", flags: on ? 4 : 0 } }] })
    })
  }
}

/**
 * The banner, as the bench fakes it: a page that joins as `banner`, watches the
 * notifications, and sends the command for a click on one outside its action.
 * `component::BANNER` in src/engines/messages/src/clients.rs names its component too.
 */
export class FakeBanner extends FakePage {
  constructor(core: Core) {
    super(core, { component: "banner" })
    this.client.watch("notifications", () => {})
  }

  /** The notifications up, as the core last sent them. */
  notifications(): Notification[] {
    return (this.slice("notifications") ?? []) as Notification[]
  }

  /** Clicks a notification outside its action. */
  click({ id, landing }: Notification): Promise<void> {
    const args: NotificationClicked = { id, landing }
    return this.client.command("clients.notification-clicked", args)
  }
}

/**
 * The desktop app, as the bench fakes it: a client that finds the core through its port file
 * and sends no Origin, as the desktop app's Rust side does (decision 013), says `alive` every
 * 2s, and sends commands, such as the session crate's Host and Join.
 */
export class FakeApp {
  private readonly socket: RawSocket
  private readonly timer: ReturnType<typeof setInterval>
  private next = 1

  private constructor(socket: RawSocket) {
    this.socket = socket
    // A scenario ends its cores, which closes the socket, so the timer never holds the bench
    // open after it.
    this.timer = setInterval(() => this.send({ t: "alive" }), 2_000).unref()
  }

  /** Connects to `core`, says hello as `component`, and watches `slices`. */
  static async open(core: Core, slices: string[], component = "desktop"): Promise<FakeApp> {
    const socket = new RawSocket(core.port(), null)
    await socket.open()
    const app = new FakeApp(socket)
    app.send({ t: "hello", component, version: VERSION, hash: HASH })
    app.send({ t: "watch", slices })
    return app
  }

  private send(message: FromClient): void {
    this.socket.send(JSON.stringify(message))
  }

  /** Sends a command, and returns the core's answer: `null` when it was taken, or its error. */
  async command(name: string, args: JsonValue = null): Promise<string | null> {
    const id = this.next++
    this.send({ t: "command", id, name, args })
    let answer: Extract<ToClient, { t: "answer" }> | undefined
    await this.socket.until(() => {
      answer = this.socket.received.find((m): m is Extract<ToClient, { t: "answer" }> => m.t === "answer" && m.id === id)
      return answer !== undefined
    }, `an answer to ${name}`)
    return answer!.error ?? null
  }

  /** Sends a command, and fails unless the core took it. */
  async ok(name: string, args: JsonValue = null): Promise<void> {
    const error = await this.command(name, args)
    if (error !== null) throw new Error(`the core refused ${name}: ${error}`)
  }

  /** The newest value of a slice the app watches, as the core last sent it. */
  slice<T = JsonValue>(name: string): T | undefined {
    const states = this.socket.received.filter((m) => m.t === "state" && m.slice === name) as Extract<ToClient, { t: "state" }>[]
    return states.at(-1)?.value as T | undefined
  }

  /** The notifications up, as the core last sent them. */
  notifications(): Notification[] {
    return this.slice<Notification[]>("notifications") ?? []
  }

  /** Waits until `ok` holds, checking every 20ms, for at most `ms`. */
  until(ok: () => boolean, what: string, ms = 10_000): Promise<void> {
    return this.socket.until(ok, what, ms)
  }

  get closed(): { code: number } | null {
    return this.socket.closed
  }

  received(): ToClient[] {
    return this.socket.received
  }

  close(): void {
    clearInterval(this.timer)
    this.socket.close()
  }
}

/**
 * A raw WebSocket to the core, for the protocol's cases a well-behaved page never makes: a
 * browser page's Origin, a message that doesn't parse, a client of another version.
 */
export class RawSocket {
  readonly received: ToClient[] = []
  readonly ws: WebSocket
  closed: { code: number } | null = null
  private readonly opened: Promise<void>

  constructor(port: number, origin: string | null = SIM_ORIGIN) {
    const headers = origin === null ? {} : { origin }
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers } as unknown as string[])
    this.opened = new Promise((resolve) => (this.ws.onopen = () => resolve()))
    this.ws.onmessage = (event) => this.received.push(JSON.parse(String(event.data)) as ToClient)
    this.ws.onerror = () => {}
    this.ws.onclose = (event) => (this.closed = { code: event.code })
  }

  async open(): Promise<void> {
    await this.opened
  }

  send(text: string): void {
    this.ws.send(text)
  }

  async until(ok: () => boolean, what: string, ms = 5_000): Promise<void> {
    const started = performance.now()
    while (!ok()) {
      if (performance.now() - started > ms) throw new Error(`${what} didn't happen within ${ms}ms`)
      await new Promise((r) => setTimeout(r, 20))
    }
  }

  close(): void {
    this.ws.close()
  }
}
