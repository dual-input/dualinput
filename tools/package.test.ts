// Tests that tools/build.ts lays out our package as the sim mounts one: the module in
// modules/, a layout.json that lists every file, and a manifest.json that names Dual Input
// at the workspace's version. Each case lays the package out in a temporary folder.
//
//   node --test tools/package.test.ts

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test, type TestContext } from "node:test"

import { layOutPackage, PACKAGE, PACKAGE_NAME, workspaceVersion } from "./lib/package.ts"

/** Lays out a package from a stand-in module of `size` bytes, and returns its folder. */
function laidOut(t: TestContext, size: number, version: string): string {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dualinput-package-"))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const wasm = path.join(temp, "module.wasm")
  fs.writeFileSync(wasm, Buffer.alloc(size, 7))
  const dir = path.join(temp, PACKAGE_NAME)
  layOutPackage(wasm, dir, version)
  return dir
}

test("the package's folder is dualinput, and it holds the module and its two files", (t) => {
  assert.equal(path.basename(PACKAGE), "dualinput")
  const dir = laidOut(t, 1234, "1.2.3")
  const files = fs.readdirSync(dir, { recursive: true }).map((f) => String(f).split(path.sep).join("/")).sort()
  assert.deepEqual(files, ["layout.json", "manifest.json", "modules", "modules/dualinput.wasm"])
  assert.equal(fs.statSync(path.join(dir, "modules", "dualinput.wasm")).size, 1234)
})

test("layout.json lists the module with its size and its last write as a FILETIME", (t) => {
  const dir = laidOut(t, 1234, "1.2.3")
  const text = fs.readFileSync(path.join(dir, "layout.json"), "utf8")
  // A FILETIME is past what a JavaScript number holds exactly, so the date is read from the text.
  const date = /"date": (\d+)/.exec(text)?.[1]
  assert.ok(date, "layout.json should give the module a date")
  const written = fs.statSync(path.join(dir, "modules", "dualinput.wasm")).mtimeMs
  const ms = Number(BigInt(date) / 10_000n - 11_644_473_600_000n)
  assert.ok(Math.abs(ms - written) < 1, `the date should be the module's last write, ${ms} against ${written}`)
  const layout = JSON.parse(text) as { content: { path: string; size: number }[] }
  assert.deepEqual(
    layout.content.map(({ path, size }) => ({ path, size })),
    [{ path: "modules/dualinput.wasm", size: 1234 }],
  )
})

test("manifest.json names Dual Input at the version, with the order hint PANEL_PATCH", (t) => {
  const dir = laidOut(t, 1234, "1.2.3")
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as Record<string, unknown>
  assert.equal(manifest.title, "Dual Input")
  assert.equal(manifest.creator, "Dual Input")
  assert.equal(manifest.package_version, "1.2.3")
  assert.equal(manifest.package_order_hint, "PANEL_PATCH")
  assert.equal(manifest.content_type, "MISC")
  assert.equal(manifest.builder, "Microsoft Flight Simulator 2024")
  assert.equal(manifest.total_package_size, "1234")
})

test("a second layout replaces the first's files", (t) => {
  const dir = laidOut(t, 1234, "1.2.3")
  fs.writeFileSync(path.join(dir, "left-over.txt"), "from an earlier build")
  layOutPackage(path.join(path.dirname(dir), "module.wasm"), dir, "1.2.4")
  assert.equal(fs.existsSync(path.join(dir, "left-over.txt")), false)
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "layout.json"), "utf8"), /left-over/)
})

test("the version is the root Cargo.toml's [workspace.package] version", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dualinput-version-"))
  try {
    fs.writeFileSync(
      path.join(root, "Cargo.toml"),
      '[workspace]\nmembers = ["a"]\n\n[workspace.package]\nedition = "2024"\nversion = "4.5.6"\n\n[profile.release]\nversion = "no"\n',
    )
    assert.equal(workspaceVersion(root), "4.5.6")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
  assert.match(workspaceVersion(), /^\d+\.\d+\.\d+/)
})
