// The EFB app's link to the desktop app, over its fixed local port, for what the core can't carry: the update's state and
// the firewall rule's (record/areas/interface/decisions.md, "The desktop app tells the EFB app about updates and the
// firewall over a fixed local port"). With no desktop app, or another program on the port, the state stays null, and the
// app shows no update and no firewall row.

import { useSyncExternalStore } from "react"

import type { DesktopState } from "../../../engines/messages/ts/desktop/DesktopState.ts"
import type { ToDesktop } from "../../../engines/messages/ts/desktop/ToDesktop.ts"
import type { Socket } from "../../../engines/page-client/src/page-client.ts"

/** `DESKTOP_PORT` in src/engines/messages/src/desktop.rs names the same port, so change both together. */
export const DESKTOP_PORT = 47914

/** How often it tries again with no socket open, in milliseconds. */
const RETRY_MS = 3000

export type DesktopEnv = {
  connect(port: number): Socket
  every(ms: number, then: () => void): void
}

export class DesktopLink {
  private readonly env: DesktopEnv
  private readonly listeners = new Set<() => void>()
  private socket: Socket | null = null
  private state: DesktopState | null = null

  constructor(env: DesktopEnv) {
    this.env = env
  }

  start(): void {
    this.connect()
    this.env.every(RETRY_MS, () => {
      if (!this.socket) this.connect()
    })
  }

  private connect(): void {
    const socket = this.env.connect(DESKTOP_PORT)
    this.socket = socket
    socket.onmessage = (text) => {
      if (this.socket !== socket) return
      // What doesn't read comes from another program on the port, which says nothing to us.
      try {
        this.set(JSON.parse(text) as DesktopState)
      } catch {
        console.error(`Dual Input: the desktop app's port said something that isn't JSON: ${text}`)
      }
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.set(null)
    }
  }

  private set(state: DesktopState | null): void {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }

  ask(what: ToDesktop): void {
    this.socket?.send(JSON.stringify(what))
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly current = (): DesktopState | null => this.state
}

/** The desktop app's state, or null with no desktop app to say it. */
export function useDesktopState(link: DesktopLink): DesktopState | null {
  return useSyncExternalStore(link.subscribe, link.current)
}
