// Tests the bridge between the Dual Input panel's webview and the language server: the server's `dualInput/panel` reaches
// the webview with the extension's palette, and each of the panel's calls becomes the server's command, but a reveal,
// which stays in the extension (record/areas/profiles/04-the-extension-in-the-sim.md, "The connection").
//
//   node --test src/apps/profile-extension/src/bridge.test.ts

import assert from "node:assert/strict"
import { test } from "node:test"

import type { FromPanel, ToPanel } from "../panel/src/messages.ts"
import { type Command, commandFor, NOT_RUNNING, PanelBridge, placeOf, type ServerView } from "./bridge.ts"

const FLYING: ServerView = { status: { kind: "in-flight", aircraft: "Black Square Baron 58P Professional", runs: true, crew: false }, unpinned: false, body: { kind: "nothing" } }

/** A bridge in the dark palette with a webview attached, and what it posted, sent, and revealed. */
function bridged() {
  const posted: ToPanel[] = []
  const sent: Command[] = []
  const revealed: string[] = []
  const bridge = new PanelBridge("dark", { execute: (command) => sent.push(command), reveal: (where) => revealed.push(where) })
  const detach = bridge.attach((message) => posted.push(message))
  return { bridge, detach, posted, sent, revealed }
}

test("until the server sends a view, the panel shows that Dual Input isn't running", () => {
  const { bridge, posted } = bridged()
  bridge.heard({ kind: "ready" })
  assert.deepEqual(posted, [{ kind: "view", view: { ...NOT_RUNNING, palette: "dark" } }])
  assert.deepEqual(NOT_RUNNING.status, { kind: "not-running" })
})

test("the server's view reaches the webview whole, with the extension's palette in place of any it carries", () => {
  const { bridge, posted } = bridged()
  bridge.show(FLYING)
  bridge.show({ ...FLYING, palette: "light" } as ServerView)
  assert.deepEqual(posted, [
    { kind: "view", view: { ...FLYING, palette: "dark" } },
    { kind: "view", view: { ...FLYING, palette: "dark" } },
  ])
})

test("a webview that loads again after the server's view asks for it and gets it", () => {
  const { bridge, detach, posted } = bridged()
  detach()
  bridge.show(FLYING)
  assert.deepEqual(posted, [])
  const again: ToPanel[] = []
  bridge.attach((message) => again.push(message))
  bridge.heard({ kind: "ready" })
  assert.deepEqual(again, [{ kind: "view", view: { ...FLYING, palette: "dark" } }])
})

test("detaching an older webview leaves the newer one attached", () => {
  const { bridge, detach } = bridged()
  const newer: ToPanel[] = []
  bridge.attach((message) => newer.push(message))
  detach()
  bridge.show(FLYING)
  assert.equal(newer.length, 1)
})

test("another palette posts the view again in it, and the same palette posts nothing", () => {
  const { bridge, posted } = bridged()
  bridge.show(FLYING)
  bridge.repaint("dark")
  bridge.repaint("light")
  assert.deepEqual(posted, [
    { kind: "view", view: { ...FLYING, palette: "dark" } },
    { kind: "view", view: { ...FLYING, palette: "light" } },
  ])
})

test("a stopped server puts the panel back to Dual Input not running", () => {
  const { bridge, posted } = bridged()
  bridge.show(FLYING)
  bridge.reset()
  assert.deepEqual(posted.at(-1), { kind: "view", view: { ...NOT_RUNNING, palette: "dark" } })
})

test("each of the panel's calls goes to the server as its command, with its value", () => {
  const { bridge, sent, posted, revealed } = bridged()
  const calls: [FromPanel, Command][] = [
    [{ kind: "typed", text: "0.5" }, { command: "dualInput.panel.typed", arguments: ["0.5"] }],
    [{ kind: "run", text: "" }, { command: "dualInput.panel.run", arguments: [""] }],
    [{ kind: "move", row: "KX155B|Index=1" }, { command: "dualInput.panel.move", arguments: ["KX155B|Index=1"] }],
    [{ kind: "tick", row: "KX155B" }, { command: "dualInput.panel.tick", arguments: ["KX155B"] }],
    [{ kind: "write" }, { command: "dualInput.panel.write", arguments: [] }],
    [{ kind: "leave" }, { command: "dualInput.panel.leave", arguments: [] }],
  ]
  for (const [call, command] of calls) {
    assert.deepEqual(commandFor(call), command)
    bridge.heard(call)
  }
  assert.deepEqual(sent, calls.map(([, command]) => command))
  assert.deepEqual(posted, [])
  assert.deepEqual(revealed, [])
})

test("a reveal stays in the extension, and ready asks for the view, so neither reaches the server", () => {
  const { bridge, sent, revealed } = bridged()
  bridge.heard({ kind: "reveal", where: "bksq-baronpro.yaml:270:45" })
  bridge.heard({ kind: "ready" })
  assert.equal(commandFor({ kind: "reveal", where: "bksq-baronpro.yaml:270:45" }), null)
  assert.equal(commandFor({ kind: "ready" }), null)
  assert.deepEqual(revealed, ["bksq-baronpro.yaml:270:45"])
  assert.deepEqual(sent, [])
})

test("a build error's place reads as its file, and its line and column counted from 0", () => {
  assert.deepEqual(placeOf("bksq-baronpro.yaml:270:45"), { file: "bksq-baronpro.yaml", line: 269, character: 44 })
  assert.deepEqual(placeOf("gns-430.yaml:12"), { file: "gns-430.yaml", line: 11, character: 0 })
  assert.deepEqual(placeOf("C:\\profiles\\aircraft\\bksq-baronpro.yaml:3:1"), { file: "C:\\profiles\\aircraft\\bksq-baronpro.yaml", line: 2, character: 0 })
  assert.equal(placeOf("bksq-baronpro.yaml"), null)
  assert.equal(placeOf("bksq-baronpro.yaml:0:4"), null)
  assert.equal(placeOf(""), null)
})
