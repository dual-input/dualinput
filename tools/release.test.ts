import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { type Commit, nextVersion, parseCommit, releaseNotes, setVersion } from "./lib/changes.ts"
import { ROOT } from "./lib/repo.ts"

const commit = (title: string, notes: string[] = [], body = ""): Commit => parseCommit("0".repeat(40), title, body, notes)

test("a conventional title gives its type, and a non-conventional one none", () => {
  assert.equal(commit("feat(go-to): let the pilot monitoring pick the spot").type, "feat")
  assert.equal(commit("fix: hold a pending write").type, "fix")
  assert.equal(commit("The build log: CI's first run").type, null)
  assert.equal(commit("feat(sync)!: drop level 1").breaking, true)
  assert.equal(commit("refactor(core): split the edge", [], "BREAKING CHANGE: the bench socket moved").breaking, true)
})

test("the next version follows the most a commit since the last release calls for", () => {
  assert.equal(nextVersion("0.1.0", [commit("docs(build): a log entry")]), null)
  assert.equal(nextVersion("0.1.0", [commit("fix(sync): x"), commit("chore: y")]), "0.1.1")
  assert.equal(nextVersion("0.1.3", [commit("fix(sync): x"), commit("feat(go-to): y")]), "0.2.0")
  assert.equal(nextVersion("0.2.1", [commit("feat(core)!: x")]), "0.3.0")
  assert.equal(nextVersion("1.2.3", [commit("feat(core)!: x")]), "2.0.0")
  assert.equal(nextVersion("1.2.3", [commit("perf(core): x")]), "1.2.4")
})

test("the notes group each Release-Note trailer by its commit's type, and say so when there's none", () => {
  const notes = releaseNotes(
    [
      commit("fix(sync): x", ["A switch flipped right after your crewmate's stays put."]),
      commit("feat(go-to): y", ["The pilot monitoring can pick where Go to parks you."]),
      commit("docs: z"),
    ],
    false,
  )
  assert.equal(notes, "## New\n\n- The pilot monitoring can pick where Go to parks you.\n\n## Fixed\n\n- A switch flipped right after your crewmate's stays put.\n")
  assert.equal(releaseNotes([commit("docs: z")], false), "Nothing a pilot will notice changed in this release.\n")
  assert.equal(releaseNotes([], true), "Dual Input's first release.\n")
})

test("a bump writes the version into both Cargo.toml files, our crates in both Cargo.lock files, and stamp.ts", () => {
  const files = ["Cargo.toml", "src/apps/desktop/Cargo.toml", "Cargo.lock", "src/apps/desktop/Cargo.lock", "src/engines/messages/ts/stamp.ts"]
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "dualinput-version-"))
  try {
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true })
      fs.copyFileSync(path.join(ROOT, f), path.join(copy, f))
    }
    const before = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(copy, f), "utf8")]))
    setVersion(/^version = "([^"]+)"/m.exec(before["src/apps/desktop/Cargo.toml"]!)![1]!, "9.8.7", copy)
    const after = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(copy, f), "utf8")]))
    assert.match(after["Cargo.toml"]!, /\[workspace\.package\]\nversion = "9\.8\.7"/)
    assert.match(after["src/apps/desktop/Cargo.toml"]!, /\nversion = "9\.8\.7"/)
    assert.match(after["src/engines/messages/ts/stamp.ts"]!, /VERSION = "9\.8\.7"/)
    // A crate from crates.io keeps its version, whatever it is, and each of ours takes the new one.
    for (const lock of ["Cargo.lock", "src/apps/desktop/Cargo.lock"]) {
      const entries = (text: string) => text.split(/(?=\n\[\[package\]\]\n)/).slice(1)
      const was = entries(before[lock]!)
      const now = entries(after[lock]!)
      assert.equal(now.length, was.length)
      for (const [i, entry] of now.entries()) {
        if (/\nsource = /.test(entry)) assert.equal(entry, was[i])
        else assert.match(entry, /\nversion = "9\.8\.7"\n/)
      }
    }
  } finally {
    fs.rmSync(copy, { recursive: true, force: true })
  }
})
