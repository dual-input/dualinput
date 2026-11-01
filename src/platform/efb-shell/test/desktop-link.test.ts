import assert from "node:assert/strict"
import { test } from "node:test"

import type { Socket } from "../../../engines/page-client/src/page-client.ts"
import { DESKTOP_PORT, DesktopLink } from "../src/desktop-link.ts"

const READY = { update: { state: "ready", next: "1.0.3" }, firewall: "allows", start_with_windows: true } as const

function bench() {
  const sockets: Socket[] = []
  const sent: string[] = []
  const ports: number[] = []
  let retry = () => {}
  const link = new DesktopLink({
    connect: (port) => {
      ports.push(port)
      const socket: Socket = { onopen: null, onmessage: null, onclose: null, send: (text) => void sent.push(text), close: () => {} }
      sockets.push(socket)
      return socket
    },
    every: (_ms, then) => {
      retry = then
    },
  })
  link.start()
  return { link, sockets, sent, ports, retry: () => retry() }
}

test("it connects to the fixed port and holds what it hears", () => {
  const { link, sockets, ports } = bench()
  assert.deepEqual(ports, [DESKTOP_PORT])
  assert.equal(link.current(), null)
  sockets[0]!.onmessage?.(JSON.stringify(READY))
  assert.deepEqual(link.current(), READY)
})

test("a closed socket clears the state, and it tries again only with none open", () => {
  const { link, sockets, retry } = bench()
  retry()
  assert.equal(sockets.length, 1, "a socket is open")
  sockets[0]!.onmessage?.(JSON.stringify(READY))
  sockets[0]!.onclose?.()
  assert.equal(link.current(), null)
  retry()
  assert.equal(sockets.length, 2)
})

test("what another program on the port says changes nothing", () => {
  const { link, sockets } = bench()
  const error = console.error
  console.error = () => {}
  sockets[0]!.onmessage?.("HTTP/1.1 400 Bad Request")
  console.error = error
  assert.equal(link.current(), null)
})

test("it sends what the app asks", () => {
  const { link, sent } = bench()
  link.ask({ t: "set-start-with-windows", on: false })
  assert.deepEqual(sent.map((text) => JSON.parse(text)), [{ t: "set-start-with-windows", on: false }])
})
