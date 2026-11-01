// A React page's link to the core, Dual Input's service, on page-client, for the EFB app and the banner. It turns
// page-client's five states into what either page shows for the link
// (record/areas/interface/decisions.md, "Without the service the EFB app shows one of three screens"),
// and hands React the slices of client state.

import { useSyncExternalStore } from "react"

import type { JsonValue } from "../../messages/ts/serde_json/JsonValue.ts"
import { PageClient } from "./page-client.ts"
import type { ConnectionState, Env } from "./page-client.ts"

/** What a page shows for the link: its content, that it's reconnecting, or that the service is gone. */
export type CoreState = "connected" | "reconnecting" | "not-running" | "closed"

/** How long reconnecting lasts before a page says the service isn't running, in milliseconds. */
const RECONNECT_FOR = 10_000

export class CoreLink {
  readonly client: PageClient
  private state: CoreState = "not-running"
  private giveUp = 0
  private readonly listeners = new Set<() => void>()
  private readonly slices = new Map<string, JsonValue>()
  private readonly watched = new Set<string>()

  /** `component` is what the page's `hello` names, as `component::*` in src/engines/messages/src/clients.rs does. */
  constructor(component: "efb-app" | "banner", env: Env) {
    this.client = new PageClient({ component }, env)
    this.client.onState((state) => this.follow(state))
  }

  start(): void {
    this.client.start()
  }

  private follow(connection: ConnectionState): void {
    window.clearTimeout(this.giveUp)
    if (connection === "connected") this.set("connected")
    else if (connection === "quit") this.set("closed")
    else if (connection === "no-core") this.set("not-running")
    else if (this.state === "connected" || this.state === "reconnecting") {
      // A crashed core comes back 2s after it exits, so most losses end under the pill.
      this.set("reconnecting")
      this.giveUp = window.setTimeout(() => this.set("not-running"), RECONNECT_FOR)
    }
  }

  private set(state: CoreState): void {
    if (this.state === state) return
    this.state = state
    this.notify()
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener())
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly coreState = (): CoreState => this.state

  /** The slice's value as the core last sent it, starting to watch it the first time it's asked for. */
  slice(name: string): JsonValue | undefined {
    if (!this.watched.has(name)) {
      this.watched.add(name)
      this.client.watch(name, (value) => {
        this.slices.set(name, value)
        this.notify()
      })
    }
    return this.slices.get(name)
  }
}

/** The link's state, for what a page shows. */
export function useCoreState(link: CoreLink): CoreState {
  return useSyncExternalStore(link.subscribe, link.coreState)
}

/** A slice of client state, typed by the message crate's type its unit registered, or undefined until the core has sent it. */
export function useSlice<T>(link: CoreLink, name: string): T | undefined {
  return useSyncExternalStore(link.subscribe, () => link.slice(name)) as T | undefined
}
