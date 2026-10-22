// The panel bridge, which our VCockpit.js loads into every cockpit panel: it records each
// instrument the sim creates, joins the core once a session runs, and loads the panel modules
// the core names for this panel's instruments, each from a file of its own, calling each
// module's start and stop in a try, so one that throws stops only itself
// (record/areas/core/02-clients-and-panel-bridge.md, "The panel bridge";
// record/areas/architecture/02-code-map.md, "Modules in the panel bridge").
//
// This runs in Coherent GT, so it keeps to ES2017 and to what the engine has
// (record/areas/architecture/coherent-gt.md), and esbuild compiles it to es2017.

import type { PanelModule } from "../../../engines/messages/ts/clients/PanelModule.ts"
import type { JsonValue } from "../../../engines/messages/ts/serde_json/JsonValue.ts"
import type { PageClient } from "../../../engines/page-client/src/page-client.ts"

/** What a panel module's start gets. */
export interface PanelCtx {
  /** The instruments `load` named for this module, in this panel. */
  readonly instruments: Element[]
  /** Sends a `unit` message to the module's feature, tagged with the module's name. */
  send(body: JsonValue): void
  /** Each `unit` message the module's feature sends it. */
  on(f: (body: JsonValue) => void): void
  /** A slice of client state, now and each time it changes. */
  watch(slice: string, f: (value: JsonValue) => void): void
}

/** A panel module, as its file defines it through `DUALINPUT_BRIDGE_API.define`. */
export interface PanelModuleDef {
  start(ctx: PanelCtx): void
  /** Removes everything the module added, such as its listeners. */
  stop?(): void
}

/** What the bridge reaches outside itself, so a test can stand in for the panel's document. */
export interface BridgeEnv {
  /** Adds a script element of our own for `src`, calling `failed` if it doesn't load. */
  addScript(src: string, failed: () => void): void
  log(message: string): void
}

export type BridgeStatus = {
  connection: string
  /** The last announcement the bridge heard, and how many it has heard. */
  announced: { last: { port: number; session: boolean } | null; count: number }
  /** The port of the core the bridge last connected to, or `null` before any. */
  core: number | null
  instruments: string[]
  modules: string[]
}

/** Where our package keeps each panel module, as `pointer-sync.js`. */
const MODULES = "/DualInput/modules/"

type Running = {
  def: PanelModuleDef
  handlers: Array<(body: JsonValue) => void>
  /** What stops the module hearing the page client, once it stops. */
  unsubscribe: Array<() => void>
  stopped: boolean
}

export class Bridge {
  private readonly env: BridgeEnv
  private readonly client: PageClient
  /** Each instrument by its key, in the order the sim created them. */
  private readonly instruments = new Map<string, Element>()
  /** Each module the core named whose file hasn't defined it yet, with its instruments. */
  private readonly loading = new Map<string, string[]>()
  private readonly running = new Map<string, Running>()

  constructor(env: BridgeEnv, client: PageClient) {
    this.env = env
    this.client = client
    client.onPanel((message) => {
      if (message.t === "load") this.load(message.modules)
      else if (message.t === "stop") {
        this.stop(message.modules)
        // A panel left with no module closes its socket, as when the profile unloads
        // (record/areas/architecture/02-code-map.md, "How work in the sim ends").
        if (!this.running.size && !this.loading.size) client.close()
      }
    })
    // With the core's socket closed, every panel module stops at once, as when the core
    // exits (record/areas/architecture/02-code-map.md, "How work in the sim ends").
    client.onState((state) => {
      if (state === "closed" || state === "quit") this.stopAll()
    })
  }

  /** The keys of the panel's instruments, which the bridge's `hello` names. */
  keys(): string[] {
    return Array.from(this.instruments.keys())
  }

  /** What the bridge is doing, for a person or a script reading it through the inspector. */
  status(): BridgeStatus {
    return {
      connection: this.client.state,
      announced: this.client.announced,
      core: this.client.corePort,
      instruments: this.keys(),
      modules: Array.from(this.running.keys()),
    }
  }

  /**
   * An instrument the sim created. One created after the bridge's `hello` went out joins the
   * core again, so the core gets a `hello` naming every instrument, and its new socket
   * replaces the old.
   */
  add(instrument: Element): void {
    const key = keyFor(instrument)
    if (this.instruments.has(key)) return
    this.instruments.set(key, instrument)
    if (this.client.connected) this.client.rejoin()
  }

  /** A panel module's file defines it as it loads. */
  define(name: string, def: PanelModuleDef): void {
    const instruments = this.loading.get(name)
    if (!instruments) {
      this.env.log(`panel module ${name} defined itself, but the core named no such module`)
      return
    }
    this.loading.delete(name)
    this.start(name, def, instruments)
  }

  /**
   * `window.DUALINPUT_BRIDGE_UNLOCK()`: stops every panel module in this document, from the
   * inspector or any console, whatever else has gone wrong.
   */
  unlock(): void {
    this.loading.clear()
    this.stopAll()
  }

  private load(modules: PanelModule[]): void {
    for (const module of modules) {
      // A module already running carries on, as when the core comes back from a suspension
      // that kept the socket.
      if (this.running.has(module.name) || this.loading.has(module.name)) continue
      this.loading.set(module.name, module.instruments)
      this.env.addScript(`${MODULES}${module.name}.js`, () => {
        this.loading.delete(module.name)
        this.env.log(`panel module ${module.name} didn't load`)
      })
    }
  }

  private start(name: string, def: PanelModuleDef, keys: string[]): void {
    const running: Running = { def, handlers: [], unsubscribe: [], stopped: false }
    this.running.set(name, running)
    running.unsubscribe.push(
      this.client.onUnit(name, (body) => {
        for (const f of running.handlers) guard(this.env, name, () => f(body))
      }),
    )
    const ctx: PanelCtx = {
      instruments: keys.map((k) => this.instruments.get(k)).filter((i): i is Element => i !== undefined),
      send: (body) => {
        if (!running.stopped) this.client.sendUnit(name, body)
      },
      on: (f) => {
        running.handlers.push(f)
      },
      watch: (slice, f) => {
        if (!running.stopped) running.unsubscribe.push(this.client.watch(slice, (value) => guard(this.env, name, () => f(value))))
      },
    }
    guard(this.env, name, () => def.start(ctx))
  }

  private stop(names: string[]): void {
    for (const name of names) {
      this.loading.delete(name)
      const running = this.running.get(name)
      if (!running) continue
      this.running.delete(name)
      running.stopped = true
      for (const unsubscribe of running.unsubscribe) unsubscribe()
      const def = running.def
      if (def.stop) guard(this.env, name, () => def.stop && def.stop())
    }
  }

  private stopAll(): void {
    this.stop(Array.from(this.running.keys()))
  }
}

/**
 * An instrument's key: its identifier, or its tag's name if it has none, then `|` and its url
 * attribute's query where it has one, since the A220 reports `CTP` for both its CTPs and only
 * the query tells them apart (read in the FS Copilot fork,
 * FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/channel.js, `Channel.keyFor`).
 */
export function keyFor(instrument: Element): string {
  const identifier = (instrument as Element & { instrumentIdentifier?: string }).instrumentIdentifier
  const id = identifier || instrument.tagName.toLowerCase()
  const url = instrument.getAttribute("url") || instrument.getAttribute("Url") || ""
  const query = url.indexOf("?")
  return query >= 0 ? `${id}|${url.substring(query + 1)}` : id
}

function guard(env: BridgeEnv, module: string, f: () => void): void {
  try {
    f()
  } catch (e) {
    env.log(`panel module ${module} threw: ${e instanceof Error ? e.message : String(e)}`)
  }
}
