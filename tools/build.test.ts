// Tests that tools/build.ts stops before building anything when the installed SDK isn't
// the one msfs-sdk.txt names, and names the command that fixes it. Each case points
// APPDATA at a temporary folder, so the real SDK is never touched.
//
//   node --test tools/build.test.ts

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "./lib/repo.ts"
import { wantedSdk } from "./lib/sdk.ts"

/**
 * Runs tools/build.ts with APPDATA at a temporary folder. The folder holds an SDK whose
 * version.txt reads `version`, or no SDK when `version` is null.
 */
function build(version: string | null) {
  const appdata = fs.mkdtempSync(path.join(os.tmpdir(), "dualinput-sdk-"))
  try {
    if (version !== null) {
      const sdk = path.join(appdata, "cargo-msfs", "data", "msfs2024")
      fs.mkdirSync(sdk, { recursive: true })
      fs.writeFileSync(path.join(sdk, "version.txt"), version)
    }
    return spawnSync(process.execPath, [path.join("tools", "build.ts")], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, APPDATA: appdata },
    })
  } finally {
    fs.rmSync(appdata, { recursive: true, force: true })
  }
}

test("with no SDK installed, the build stops and names node tools/setup.ts", () => {
  const result = build(null)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /no SDK is installed.*run node tools\/setup\.ts/)
  assert.doesNotMatch(result.stdout, /> cargo/)
})

test("with another SDK installed, the build stops and names both versions", () => {
  // A version.txt that cargo-msfs installed holds the version, then a build number on a
  // second line.
  const result = build("1.7.3\r\n2512345")
  assert.equal(result.status, 1)
  assert.match(result.stderr, new RegExp(`names SDK ${wantedSdk()}, but SDK 1\\.7\\.3 is installed`))
  assert.doesNotMatch(result.stdout, /> cargo/)
})
