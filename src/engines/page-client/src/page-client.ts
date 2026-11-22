// How a page in the sim reaches the core: it hears the core's announcement over the CommBus,
// opens a WebSocket to the port it names, says hello, sends something every 2s, and connects
// again at the next announcement once its socket closes, so it needs no backoff
// (record/areas/core/02-clients-and-panel-bridge.md, "page-client").
//
// This runs in Coherent GT, so it keeps to ES2017 and to what the engine has
// (record/areas/architecture/coherent-gt.md), and esbuild compiles it to es2017.

import type { Announce } from "../../messages/ts/clients/Announce.ts"
import type { FromClient } from "../../messages/ts/clients/FromClient.ts"
import type { Hello } from "../../messages/ts/clients/Hello.ts"
import type { PanelModule } from "../../messages/ts/clients/PanelModule.ts"
import type { ToClient } from "../../messages/ts/clients/ToClient.ts"
import type { JsonValue } from "../../messages/ts/serde_json/JsonValue.ts"
import { HASH, VERSION } from "../../messages/ts/stamp.ts"

/** The CommBus event the core announces its port on. `ANNOUNCE` in src/engines/messages/src/clients.rs names it too, so change both together. */
export const ANNOUNCE = "DUALINPUT_CORE_ANNOUNCE"

/** Each side sends something at least this often (decision 010). */
const ALIVE_MS = 2000

/** A core silent this long has hung or stopped, though its socket stays open. */
const SILENT_MS = 8000

/**
 * The connection's state, which a page shows as its design has it: no core heard yet, connected,
 * quit after the core's `bye`, silent for 8s with the socket kept, or closed without a `bye`.
 */
export type ConnectionState = "no-core" | "connected" | "quit" | "silent" | "closed"

/** A WebSocket, as the page client uses it. */
export interface Socket {
  onopen: (() => void) | null
  onmessage: ((text: string) => void) | null
  onclose: (() => void) | null
  send(text: string): void
  close(): void
}

/** What the page client reaches outside itself, so a test can stand in for the sim's page. */
export interface Env {
  /** Opens a WebSocket to the core on 127.0.0.1. */
  connect(port: number): Socket
  every(ms: number, f: () => void): void
  now(): number
  /** Calls `hear` with each announcement's text. */
  listen(hear: (text: string) => void): void
  log(message: string): void
}

export interface Options {
  /** The component the page's `hello` names, such as `panel-bridge`. */
  component: string
  /** Whether the page connects only to an announcement that says a session runs, as a cockpit panel does (decision 011). */
  sessionOnly?: boolean
  /** The cockpit panel's name its `hello` names, as the sim names it, such as `VCockpit66`. */
  panel?: () => string | undefined
  /** The instruments' keys a cockpit panel's `hello` names. */
  instruments?: () => string[]
}

/** The panel messages: the modules to load or stop, or nothing for this panel. */
export type PanelMessage = { t: "load"; modules: Array<PanelModule> } | { t: "stop"; modules: Array<string> } | { t: "none" }

export class PageClient {
  private readonly options: Options
  private readonly env: Env
  private socket: Socket | null = null
  private open = false
  private port: number | null = null
  /**
   * The port of the core that told this panel `none`, and the announcement's `panels` count it
   * was told under, after which it stays closed until an announcement brings another port or
   * another count, or says the session ended.
   */
  private toldNone: { port: number; panels: number | undefined } | null = null
  private heard = 0
  /** The last announcement the page heard, and how many it has heard. */
  private lastAnnounce: Announce | null = null
  private announcements = 0
  private connection: ConnectionState = "no-core"
  private nextId = 1
  private readonly answers = new Map<number, (error: string | null) => void>()
  private readonly slices = new Map<string, Array<(value: JsonValue) => void>>()
  /** Each slice's value as the core last sent it on this socket. */
  private readonly values = new Map<string, JsonValue>()
  private readonly units = new Map<string, Array<(body: JsonValue) => void>>()
  private readonly panel: Array<(message: PanelMessage) => void> = []
  private readonly states: Array<(state: ConnectionState) => void> = []

  constructor(options: Options, env: Env) {
    this.options = options
    this.env = env
  }

  /** Starts listening for the core's announcement, and the timers that keep the socket alive. */
  start(): void {
    this.env.listen((text) => this.hear(text))
    this.env.every(ALIVE_MS, () => {
      if (this.open) this.send({ t: "alive" })
    })
    this.env.every(1000, () => this.checkSilence())
  }

  get state(): ConnectionState {
    return this.connection
  }

  /** The last announcement the page heard, and how many it has heard, for a person reading the page. */
  get announced(): { last: Announce | null; count: number } {
    return { last: this.lastAnnounce, count: this.announcements }
  }

  /** The port of the core the page last connected to, or `null` before any. */
  get corePort(): number | null {
    return this.port
  }

  /** Whether the socket is open and the core has its `hello`. */
  get connected(): boolean {
    return this.open
  }

  onState(f: (state: ConnectionState) => void): void {
    this.states.push(f)
  }

  /** Each message the core sends a cockpit panel about its modules. */
  onPanel(f: (message: PanelMessage) => void): void {
    this.panel.push(f)
  }

  /** Each `unit` message from the core to `unit`. Returns what stops `f` hearing them. */
  onUnit(unit: string, f: (body: JsonValue) => void): () => void {
    const list = this.units.get(unit) || []
    list.push(f)
    this.units.set(unit, list)
    return () => remove(this.units.get(unit), f)
  }

  /**
   * Shows a slice of client state: `f` gets its whole value as soon as the core has sent it,
   * and again each time it changes. Returns what stops `f` hearing it.
   */
  watch(slice: string, f: (value: JsonValue) => void): () => void {
    const list = this.slices.get(slice)
    if (list) {
      list.push(f)
      const value = this.values.get(slice)
      if (value !== undefined) guard(this.env, () => f(value))
    } else {
      this.slices.set(slice, [f])
      if (this.open) this.send({ t: "watch", slices: Array.from(this.slices.keys()) })
    }
    return () => remove(this.slices.get(slice), f)
  }

  /** Sends a `unit` message, or drops it while no socket is open. */
  sendUnit(unit: string, body: JsonValue): boolean {
    return this.send({ t: "unit", unit, body })
  }

  /** Sends a command, which resolves once the core takes it and rejects with the core's error. */
  command(name: string, args: JsonValue): Promise<void> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      if (!this.send({ t: "command", id, name, args })) {
        reject(new Error("no core is connected"))
        return
      }
      this.answers.set(id, (error) => (error === null ? resolve() : reject(new Error(error))))
    })
  }

  /** Closes the socket, if one is open, until the next announcement the page connects to. */
  close(): void {
    const socket = this.socket
    if (!socket) return
    this.socket = null
    this.open = false
    socket.close()
    this.failAnswers()
    if (this.connection !== "quit") this.setState("closed")
  }

  /** Closes the socket and opens a new one to the same core, so the core gets a new `hello`. */
  rejoin(): void {
    if (this.port !== null && this.socket) this.connect(this.port)
  }

  /**
   * One announcement. A page that hears one with no socket open, or one naming a port other
   * than its socket's, connects to that port; a core that restarted announces a new one. A
   * panel told `none` connects again only for another port, another `panels` count, which the
   * core raises when a feature wants every panel, or after the session's end, and not for the
   * announcement that repeats every 2s, which would only bring it back to be told `none` again.
   */
  hear(text: string): void {
    let announce: Announce
    try {
      announce = JSON.parse(text)
    } catch (e) {
      this.env.log(`an announcement didn't parse: ${text}`)
      return
    }
    if (typeof announce.port !== "number") return
    this.lastAnnounce = announce
    this.announcements++
    const told = this.toldNone
    if (told && (!announce.session || announce.port !== told.port || announce.panels !== told.panels)) this.toldNone = null
    if (this.options.sessionOnly && !announce.session) {
      // A cockpit panel connects only in a session, so one that ends closes its socket
      // (decision 011).
      this.close()
      return
    }
    if (this.toldNone !== null) return
    if (this.socket && this.port === announce.port) return
    this.connect(announce.port)
  }

  private connect(port: number): void {
    const old = this.socket
    this.socket = null
    this.open = false
    if (old) old.close()
    this.failAnswers()
    this.values.clear()
    this.port = port
    const socket = this.env.connect(port)
    this.socket = socket
    socket.onopen = () => {
      if (this.socket !== socket) return
      this.open = true
      this.heard = this.env.now()
      const hello: { t: "hello" } & Hello = { t: "hello", component: this.options.component, version: VERSION, hash: HASH }
      const panel = this.options.panel && this.options.panel()
      if (panel) hello.panel = panel
      if (this.options.instruments) hello.instruments = this.options.instruments()
      this.send(hello)
      if (this.slices.size) this.send({ t: "watch", slices: Array.from(this.slices.keys()) })
      this.setState("connected")
    }
    socket.onmessage = (text) => {
      if (this.socket === socket) this.receive(text)
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.open = false
      this.failAnswers()
      if (this.connection !== "quit") this.setState("closed")
    }
  }

  // A press played into a cockpit already caught up would undo the catch-up, so nothing waits
  // for a socket: a send with none open is dropped (decision 041).
  private send(message: FromClient): boolean {
    if (!this.socket || !this.open) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  private receive(text: string): void {
    this.heard = this.env.now()
    if (this.connection === "silent") this.setState("connected")
    let message: ToClient
    try {
      message = JSON.parse(text)
    } catch (e) {
      this.env.log(`a message from the core didn't parse: ${text.slice(0, 200)}`)
      return
    }
    switch (message.t) {
      case "alive":
        break
      case "state":
        this.values.set(message.slice, message.value)
        for (const f of (this.slices.get(message.slice) || []).slice()) guard(this.env, () => f(message.value))
        break
      case "unit":
        for (const f of (this.units.get(message.unit) || []).slice()) guard(this.env, () => f(message.body))
        break
      case "answer": {
        const answer = this.answers.get(message.id)
        this.answers.delete(message.id)
        if (answer) answer(message.error === undefined || message.error === null ? null : message.error)
        break
      }
      case "load":
      case "stop":
      case "none":
        for (const f of this.panel) guard(this.env, () => f(message))
        if (message.t === "none") {
          this.toldNone = this.port === null ? null : { port: this.port, panels: this.lastAnnounce ? this.lastAnnounce.panels : undefined }
          this.close()
        }
        break
      case "bye":
        this.setState("quit")
        break
    }
  }

  private checkSilence(): void {
    if (this.open && this.connection === "connected" && this.env.now() - this.heard >= SILENT_MS) this.setState("silent")
  }

  private failAnswers(): void {
    const answers = Array.from(this.answers.values())
    this.answers.clear()
    for (const answer of answers) answer("the socket closed before the core answered")
  }

  private setState(state: ConnectionState): void {
    if (this.connection === state) return
    this.connection = state
    for (const f of this.states) guard(this.env, () => f(state))
  }
}

function remove<T>(list: T[] | undefined, item: T): void {
  const at = list ? list.indexOf(item) : -1
  if (list && at >= 0) list.splice(at, 1)
}

/** Runs `f`, so one handler that throws stops no other. */
function guard(env: Env, f: () => void): void {
  try {
    f()
  } catch (e) {
    env.log(`a handler threw: ${e instanceof Error ? e.message : String(e)}`)
  }
}
