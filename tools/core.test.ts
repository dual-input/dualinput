// Tests that the core refuses to build without the static C runtime, which keeps its math
// the same in a run and its replay. Any RUSTFLAGS, even an empty one, replaces the line in
// .cargo/config.toml that links it, and the core's crate then stops the build with a
// compile_error!. The check builds in a target folder of its own, so it never throws away
// the main folder's compiled crates, and it runs here rather than in `cargo test`, since a
// Cargo inside a running `cargo test` could wait on its locks.
//
//   node --test tools/core.test.ts

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "./lib/repo.ts"

test("a build with RUSTFLAGS set, even empty, stops at the core's guard", () => {
  const result = spawnSync("cargo", ["check", "-p", "dualinput-core", "--target-dir", path.join("target", "rustflags-guard")], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, RUSTFLAGS: "" },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /dualinput-core must link the C runtime statically/)
})
