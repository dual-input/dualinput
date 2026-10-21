// A bench build and a release build of one commit carry one message crate's hash, and the
// release build reaches no stand-in sim (record/areas/build/02-testing.md, "Cases for the
// bench"). A release turns on no feature, so `cargo tree` of the core with none is the
// release build's graph, whichever profile builds it. The bench's cores also check the
// hash in their first line against the bench's own types.

import assert from "node:assert/strict"
import { test } from "node:test"

import { output } from "../../lib/run.ts"

/** Each crate the core reaches through normal dependencies, as a line naming it and the features it's built with. */
function tree(...features: string[]): string[] {
  const args = ["tree", "-p", "dualinput-core", "--edges", "normal", "--prefix", "none", "--format", "{p} [{f}]", ...features]
  return output("cargo", args).split(/\r?\n/)
}

test("the bench build and the release build carry one message crate, and the release build reaches no stand-in sim", () => {
  const release = tree()
  const bench = tree("--features", "stand-in")
  const messages = (lines: string[]) => lines.find((line) => line.startsWith("messages "))
  assert.ok(messages(release), "the release build should carry the message crate")
  assert.equal(messages(bench), messages(release), "both builds should build the message crate alike")
  assert.ok(!release.some((line) => line.startsWith("stand-in-sim ")), "the release build reaches the stand-in sim")
})
