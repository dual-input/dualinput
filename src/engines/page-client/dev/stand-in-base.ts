// A stand-in for the core inside a page, so a page runs with no core and no sim: it speaks page-client's protocol
// over sockets of its own, holds the slices a scene sets, and answers commands. The real core's behavior is the
// bench's to test; this only puts a page's screens in each state a person needs to look at.

import type { FromClient } from "../../messages/ts/clients/FromClient.ts"
import type { JsonValue } from "../../messages/ts/serde_json/JsonValue.ts"
import type { Env, Socket } from "../src/page-client.ts"

const PORT = 1

export type Slices = Record<string, unknown>
export type LostService = "reconnecting" | "closed" | "not-running" | "back"

export abstract class StandInBase {
  private readonly sockets = new Map<Socket, Set<string>>()
  private readonly hearers: ((text: string) => void)[] = []
  protected slices: Slices = {}

  /** A page said hello: it's the first moment the stand-in knows anyone is listening. */
  protected abstract greeted(): void
  protected abstract command(name: string, args: JsonValue): void

  env(): Env {
    return {
      connect: () => {
        const socket: Socket = {
          onopen: null,
          onmessage: null,
          onclose: null,
          send: (text) => this.receive(socket, text),
          close: () => void this.sockets.delete(socket),
        }
        this.sockets.set(socket, new Set())
        window.setTimeout(() => socket.onopen?.(), 0)
        return socket
      },
      every: (ms, then) => void window.setInterval(then, ms),
      now: () => Date.now(),
      listen: (hear) => {
        this.hearers.push(hear)
        this.announce()
      },
      log: (message) => console.log(`stand-in: ${message}`),
    }
  }

  private announce(): void {
    this.hearers.forEach((hear) => hear(JSON.stringify({ port: PORT, session: false })))
  }

  protected set(changes: Slices): void {
    this.slices = { ...this.slices, ...changes }
    this.sockets.forEach((watched, socket) => {
      Object.keys(changes).forEach((name) => {
        if (watched.has(name) && this.slices[name] !== undefined) socket.onmessage?.(JSON.stringify({ t: "state", slice: name, value: this.slices[name] }))
      })
    })
  }

  /** The socket closing without a `bye`, or with one, or the core coming back. */
  connection(state: LostService): void {
    if (state === "back") {
      this.announce()
      return
    }
    const sockets = Array.from(this.sockets.keys())
    this.sockets.clear()
    sockets.forEach((socket) => {
      if (state === "closed") socket.onmessage?.(JSON.stringify({ t: "bye" }))
      else socket.onclose?.()
    })
  }

  private receive(socket: Socket, text: string): void {
    const message = JSON.parse(text) as FromClient
    const reply = (body: unknown) => socket.onmessage?.(JSON.stringify(body))
    if (message.t === "alive") {
      // Each side sends something every 2s, and the page counts 8s of silence as a core that hung.
      reply({ t: "alive" })
    } else if (message.t === "watch") {
      const watched = this.sockets.get(socket)
      message.slices.forEach((name) => {
        watched?.add(name)
        if (this.slices[name] !== undefined) reply({ t: "state", slice: name, value: this.slices[name] })
      })
    } else if (message.t === "hello") {
      this.greeted()
    } else if (message.t === "command") {
      this.command(message.name, message.args)
      reply({ t: "answer", id: message.id })
    }
  }
}
