// The bench's fake `serve`, the profile extension's language server, as one more client of a
// bench core, which speaks authoring's protocol from the message crate's types: it finds the
// core through `port.json`, says hello as `profile-extension` with no Origin, watches the slice
// `authoring`, sends `authoring.open`, `authoring.panel`, and `authoring.run`, and on each new
// socket sends its last `open`, its bundle included, and its last `panel` again
// (record/areas/profiles/04-the-extension-in-the-sim.md, "The connection").

import fs from "node:fs"
import path from "node:path"

import type { AuthoringSlice } from "../../src/engines/messages/ts/authoring/AuthoringSlice.ts"
import type { Given } from "../../src/engines/messages/ts/authoring/Given.ts"
import type { Open } from "../../src/engines/messages/ts/authoring/Open.ts"
import type { OpenBundle } from "../../src/engines/messages/ts/authoring/OpenBundle.ts"
import type { OpenName } from "../../src/engines/messages/ts/authoring/OpenName.ts"
import type { Panel } from "../../src/engines/messages/ts/authoring/Panel.ts"
import type { Run } from "../../src/engines/messages/ts/authoring/Run.ts"
import type { FromClient } from "../../src/engines/messages/ts/clients/FromClient.ts"
import type { PortFile } from "../../src/engines/messages/ts/clients/PortFile.ts"
import type { ToClient } from "../../src/engines/messages/ts/clients/ToClient.ts"
import type { JsonValue } from "../../src/engines/messages/ts/serde_json/JsonValue.ts"
import { HASH, VERSION } from "../../src/engines/messages/ts/stamp.ts"

/** How often `serve` reads `port.json` again while it has no socket. */
const PORT_EVERY_MS = 2_000

/** A message's budget (record/areas/core/02-clients-and-panel-bridge.md, "Budgets"). */
export const MESSAGE_BUDGET = 64 * 1024

type Answer = Extract<ToClient, { t: "answer" }>

export class FakeServe {
  /** Each slice `authoring` the core sent, with its size in bytes, oldest first, across sockets. */
  readonly slices: { value: AuthoringSlice; bytes: number }[] = []
  /** How many sockets it has opened. */
  sockets = 0
  private readonly data: string
  private readonly version: string
  private readonly window: string
  private ws: WebSocket | null = null
  private answers = new Map<number, Answer>()
  private next = 1
  private names: OpenName[] = []
  private bundle: OpenBundle | undefined
  private lastPanel: Panel = { t: "nothing" }
  private closed = false
  private readonly timer: ReturnType<typeof setInterval>

  /**
   * A `serve` for the core whose data folder is `data`, as `window`, the ID a window's `serve`
   * picks, with `version` in its hello, the tree's own unless a case gives another release's.
   */
  constructor(data: string, { window = "bench-window", version = VERSION } = {}) {
    this.data = data
    this.window = window
    this.version = version
    this.timer = setInterval(() => {
      if (this.ws) this.send({ t: "alive" })
      else this.connect()
    }, PORT_EVERY_MS)
    this.timer.unref()
    this.connect()
  }

  /** Whether it holds a socket to the core. */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /** Waits until it holds a socket and the core has sent it the slice. */
  async ready(ms = 10_000): Promise<void> {
    await this.until(() => this.connected && this.slices.length > 0, "a socket and the slice", ms)
  }

  private connect(): void {
    if (this.closed || this.ws) return
    let port: number
    try {
      port = (JSON.parse(fs.readFileSync(path.join(this.data, "port.json"), "utf8")) as PortFile).port
    } catch {
      return
    }
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    this.ws = ws
    ws.onopen = () => {
      this.sockets++
      this.answers = new Map()
      this.send({ t: "hello", component: "profile-extension", version: this.version, hash: HASH })
      this.send({ t: "watch", slices: ["authoring"] })
      void this.command("authoring.open", { window: this.window, names: this.names, ...(this.bundle ? { bundle: this.bundle } : {}) } satisfies Open)
      void this.command("authoring.panel", this.lastPanel)
    }
    ws.onmessage = (event) => {
      const text = String(event.data)
      const message = JSON.parse(text) as ToClient
      if (message.t === "answer") this.answers.set(message.id, message)
      else if (message.t === "state" && message.slice === "authoring") this.slices.push({ value: message.value as AuthoringSlice, bytes: Buffer.byteLength(text) })
    }
    ws.onerror = () => {}
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
    }
  }

  private send(message: FromClient): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  /** Sends a command, and returns the core's answer: `null` when it was taken, or its error. */
  async command(name: string, args: unknown): Promise<string | null> {
    const id = this.next++
    this.send({ t: "command", id, name, args: args as JsonValue })
    await this.until(() => this.answers.has(id), `an answer to ${name}`)
    return this.answers.get(id)!.error ?? null
  }

  /** The open files' names, and the open text's bundle when it changed, as typing pauses. */
  async open(names: OpenName[], bundle?: OpenBundle): Promise<string | null> {
    this.names = names
    if (bundle) this.bundle = bundle
    return this.command("authoring.open", { window: this.window, names, ...(bundle ? { bundle } : {}) } satisfies Open)
  }

  async panel(panel: Panel): Promise<string | null> {
    this.lastPanel = panel
    return this.command("authoring.panel", panel)
  }

  async run(entry: string, given: Given): Promise<string | null> {
    return this.command("authoring.run", { entry, given } satisfies Run)
  }

  /** The newest slice, as the core last sent it. */
  slice(): AuthoringSlice | undefined {
    return this.slices.at(-1)?.value
  }

  /** Waits until the newest slice holds what `ok` asks, and returns it. */
  async state(ok: (s: AuthoringSlice) => boolean, what: string, ms = 10_000): Promise<AuthoringSlice> {
    await this.until(() => {
      const s = this.slice()
      return s !== undefined && ok(s)
    }, what, ms)
    return this.slice()!
  }

  /** Waits until `ok` holds, checking every 20ms, for at most `ms`. */
  async until(ok: () => boolean, what: string, ms = 10_000): Promise<void> {
    const started = performance.now()
    while (!ok()) {
      if (performance.now() - started > ms) throw new Error(`serve: ${what} didn't happen within ${ms}ms; the last slice was ${JSON.stringify(this.slice())}`)
      await new Promise((r) => setTimeout(r, 20))
    }
  }

  close(): void {
    this.closed = true
    clearInterval(this.timer)
    this.ws?.close()
    this.ws = null
  }
}

/** A name on a `watch:` line, read as a value or as occurrences. */
export const value = (name: string): OpenName => ({ name, reads: "value" })
export const occurrences = (name: string): OpenName => ({ name, reads: "occurrences" })

/** A number as Run takes it. */
export const number = (n: number): Given => ({ t: "value", value: { as: "number", value: n } })
