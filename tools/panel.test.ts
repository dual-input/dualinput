import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { panelCompileProblem, panelSourceHash, SPB } from "./lib/panel.ts"

/** A panel's source and its compile, as a temporary tree, with `compile` as what compiling it recorded. */
function panel(t: { after(f: () => void): void }, words: string, compile: (source: string) => Record<string, string> | null, spb = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dualinput-panel-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const source = path.join(dir, "panel.xml")
  const compiled = path.join(dir, "compiled")
  fs.mkdirSync(compiled)
  fs.writeFileSync(source, words)
  const recorded = compile(source)
  if (recorded) fs.writeFileSync(path.join(compiled, "source.json"), JSON.stringify(recorded))
  if (spb) fs.writeFileSync(path.join(compiled, SPB), "compiled")
  return { source, compiled }
}

test("a compile of this source passes", (t) => {
  const { source, compiled } = panel(t, "<panel/>", (at) => ({ "panel.xml": panelSourceHash(at) }))
  assert.equal(panelCompileProblem(source, compiled), null)
})

test("a source changed since its compile fails", (t) => {
  const { source, compiled } = panel(t, "<panel/>", (at) => ({ "panel.xml": panelSourceHash(at) }))
  fs.writeFileSync(source, "<panel changed/>")
  assert.match(panelCompileProblem(source, compiled) ?? "", /changed since it was compiled/)
})

test("a tree with no compiled file fails", (t) => {
  const { source, compiled } = panel(t, "<panel/>", (at) => ({ "panel.xml": panelSourceHash(at) }), false)
  assert.match(panelCompileProblem(source, compiled) ?? "", /no compiled file/)
})

test("the panel committed in this tree matches its source", () => {
  assert.equal(panelCompileProblem(), null)
})
