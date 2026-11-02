import assert from "node:assert/strict"
import { test } from "node:test"

import { CoreLink } from "../src/core-link.ts"
import type { Env, Socket } from "../src/page-client.ts"

/** A page in the sim, as the link sees it: a clock moved by hand, and the last socket it opened. */
function bench() {
  const sockets: Socket[] = []
  const timers: { ms: number; f: () => void; next: number }[] = []
  let clock = 0
  let hear: (text: string) => void = () => {}
  const env: Env = {
    connect() {
      const socket: Socket = { onopen: null, onmessage: null, onclose: null, send: () => {}, close: () => {} }
      sockets.push(socket)
      return socket
    },
    every: (ms, f) => void timers.push({ ms, f, next: clock + ms }),
    now: () => clock,
    listen: (then) => {
      hear = then
    },
    log: () => {},
  }
  const link = new CoreLink("efb-app", env)
  link.start()
  const connect = () => {
    hear(JSON.stringify({ port: 1, session: false }))
    sockets[sockets.length - 1]!.onopen?.()
  }
  const wait = (ms: number) => {
    const to = clock + ms
    for (;;) {
      const due = timers.filter((timer) => timer.next <= to).sort((a, b) => a.next - b.next)[0]
      if (!due) break
      clock = due.next
      due.next += due.ms
      due.f()
    }
    clock = to
  }
  return { link, connect, wait, socket: () => sockets[sockets.length - 1]! }
}

test("a page with no core heard says the service isn't running, and connected once it connects", () => {
  const { link, connect } = bench()
  assert.equal(link.coreState(), "not-running")
  connect()
  assert.equal(link.coreState(), "connected")
})

test("a lost socket reconnects for 10s before the page says the service isn't running", () => {
  const { link, connect, wait, socket } = bench()
  connect()
  socket().onclose?.()
  assert.equal(link.coreState(), "reconnecting")
  wait(9_000)
  assert.equal(link.coreState(), "reconnecting")
  wait(2_000)
  assert.equal(link.coreState(), "not-running")
})

test("a core back within the 10s ends the wait", () => {
  const { link, connect, wait, socket } = bench()
  connect()
  socket().onclose?.()
  wait(3_000)
  connect()
  assert.equal(link.coreState(), "connected")
  // Past the first loss's 10s, and short of the 8s that would count this core as silent.
  wait(7_500)
  assert.equal(link.coreState(), "connected")
})

test("the core's bye says closed, with no wait", () => {
  const { link, connect, socket } = bench()
  connect()
  socket().onmessage?.(JSON.stringify({ t: "bye" }))
  assert.equal(link.coreState(), "closed")
})
