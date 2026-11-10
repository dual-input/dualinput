// A WebSocket to a real core, as the desktop app's Rust side holds one, for a script that drives
// a session on the sim's PC: no Origin, and `alive` every 2s.

import fs from "node:fs"
import path from "node:path"

import { HASH, VERSION } from "../../src/engines/messages/ts/stamp.ts"
import { Failed } from "../lib/run.ts"

export type Desktop = {
  command(name: string, args: unknown): Promise<void>
  slice<T>(name: string): T | undefined
}

/** Connects to the core whose data folder is `data`, watching `slices`. */
export async function desktop(data: string, slices: string[]): Promise<Desktop> {
  const port = (JSON.parse(fs.readFileSync(path.join(data, "port.json"), "utf8")) as { port: number }).port
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Failed(`the core's WebSocket on ${port} didn't open`))
  })
  const values = new Map<string, unknown>()
  const answers = new Map<number, (error: string | null) => void>()
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as { t: string; slice?: string; value?: unknown; id?: number; error?: string }
    if (message.t === "state" && message.slice) values.set(message.slice, message.value)
    if (message.t === "answer") answers.get(message.id!)?.(message.error ?? null)
  }
  ws.send(JSON.stringify({ t: "hello", component: "desktop", version: VERSION, hash: HASH }))
  ws.send(JSON.stringify({ t: "watch", slices }))
  setInterval(() => ws.send(JSON.stringify({ t: "alive" })), 2_000).unref()
  let next = 1
  return {
    command(name, args) {
      const id = next++
      return new Promise((resolve, reject) => {
        answers.set(id, (error) => (error === null ? resolve() : reject(new Failed(`the core refused ${name}: ${error}`))))
        ws.send(JSON.stringify({ t: "command", id, name, args }))
      })
    },
    slice: <T>(name: string) => values.get(name) as T | undefined,
  }
}
