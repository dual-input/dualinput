// Tests that `node tools/build.ts install` writes our package into the Community folder of
// each packages folder the sim's UserCfg.opt files name, and refuses while the sim runs.
// Each case lays out UserCfg.opt files and packages folders of its own in a temporary
// folder, so the real Community folders are never touched, and a copy of Windows' PING.EXE
// under a name of its own stands in for the sim. The name isn't FlightSimulator2024.exe, which
// a core holding no sim would find (record/areas/build/02-testing.md, "The sim's process").
//
//   node --test tools/install.test.ts

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test, type TestContext } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { install, simRunning } from "./lib/install.ts"
import { layOutPackage, PACKAGE_NAME } from "./lib/package.ts"
import { Failed } from "./lib/run.ts"

type Layout = { temp: string; cfgs: string[]; folders: string[]; pkg: string }

/**
 * Two editions' UserCfg.opt files, each naming a packages folder with a Community folder,
 * a third UserCfg.opt that doesn't exist, as on a PC with one edition, and a package to
 * install. The Steam edition's Community already holds an older copy of our package and
 * another package.
 */
function layout(t: TestContext): Layout {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dualinput-install-"))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const folders = [path.join(temp, "steam packages"), path.join(temp, "store packages")]
  for (const folder of folders) fs.mkdirSync(path.join(folder, "Community"), { recursive: true })
  const steam = path.join(folders[0]!, "Community")
  fs.mkdirSync(path.join(steam, PACKAGE_NAME), { recursive: true })
  fs.writeFileSync(path.join(steam, PACKAGE_NAME, "old.txt"), "from the copy before")
  fs.mkdirSync(path.join(steam, "another-package"))
  fs.writeFileSync(path.join(steam, "another-package", "keep.txt"), "not ours")

  const cfgs = [path.join(temp, "steam", "UserCfg.opt"), path.join(temp, "store", "UserCfg.opt"), path.join(temp, "none", "UserCfg.opt")]
  fs.mkdirSync(path.dirname(cfgs[0]!))
  fs.mkdirSync(path.dirname(cfgs[1]!))
  // A longer name that starts with the same letters comes first, which install must pass over.
  fs.writeFileSync(
    cfgs[0]!,
    `Version 82\r\nInstalledPackagesPathNextBoot "${path.join(temp, "elsewhere")}"\r\nInstalledPackagesPath "${folders[0]}"\r\n`,
  )
  fs.writeFileSync(cfgs[1]!, `InstalledPackagesPath "${folders[1]}"\n`)

  const wasm = path.join(temp, "module.wasm")
  fs.writeFileSync(wasm, Buffer.alloc(100, 7))
  const pkg = path.join(temp, "built", PACKAGE_NAME)
  layOutPackage(wasm, [], pkg, "1.2.3")
  return { temp, cfgs, folders, pkg }
}

test("install writes the package into each packages folder's Community", (t) => {
  const { temp, cfgs, folders, pkg } = layout(t)
  // The sim's process here is one no process has, so the case runs while a developer's sim
  // is open.
  const copies = install(pkg, cfgs, "dualinput-test-no-such-sim.exe")
  assert.deepEqual(
    copies,
    folders.map((f) => path.join(f, "Community", PACKAGE_NAME)),
  )
  for (const folder of folders) {
    const copy = path.join(folder, "Community", PACKAGE_NAME)
    for (const file of ["layout.json", "manifest.json", "modules/dualinput.wasm"]) {
      assert.deepEqual(fs.readFileSync(path.join(copy, file)), fs.readFileSync(path.join(pkg, file)), `${file} in ${copy}`)
    }
    assert.equal(fs.existsSync(path.join(copy, "old.txt")), false, "the copy before should be gone")
    const left = fs.readdirSync(folder).filter((name) => name.startsWith("dualinput-install-"))
    assert.deepEqual(left, [], "the folder the copy is made in should be gone")
  }
  assert.equal(fs.readFileSync(path.join(folders[0]!, "Community", "another-package", "keep.txt"), "utf8"), "not ours")
  assert.equal(fs.existsSync(path.join(temp, "elsewhere")), false)
})

test("install deletes nothing beside the folder a Community junction leads to", (t) => {
  const { temp, cfgs, folders, pkg } = layout(t)
  // A Community that's a junction to a folder whose parent holds a folder of the same name
  // as ours, as %APPDATA%\Community would beside our data folder, %APPDATA%\DualInput.
  const parent = path.join(temp, "appdata")
  fs.mkdirSync(path.join(parent, "DualInput"), { recursive: true })
  fs.writeFileSync(path.join(parent, "DualInput", "settings.json"), "a pilot's settings")
  fs.mkdirSync(path.join(parent, "Community"))
  const steam = path.join(folders[0]!, "Community")
  fs.rmSync(steam, { recursive: true })
  fs.symlinkSync(path.join(parent, "Community"), steam, "junction")
  install(pkg, cfgs, "dualinput-test-no-such-sim.exe")
  assert.ok(fs.existsSync(path.join(parent, "Community", PACKAGE_NAME, "manifest.json")), "the package went in through the junction")
  assert.equal(fs.readFileSync(path.join(parent, "DualInput", "settings.json"), "utf8"), "a pilot's settings")
})

test("install refuses while the sim's process runs", async (t) => {
  const { temp, cfgs, folders, pkg } = layout(t)
  const systemRoot = process.env.SystemRoot
  assert.ok(systemRoot, "Windows should set SystemRoot")
  const name = `dualinput-test-sim-${process.pid}.exe`
  const exe = path.join(temp, name)
  fs.copyFileSync(path.join(systemRoot, "System32", "PING.EXE"), exe)
  const sim = spawn(exe, ["-n", "30", "127.0.0.1"], { stdio: "ignore" })
  const exited = once(sim, "exit")
  try {
    for (let tries = 0; !simRunning(name); tries++) {
      assert.ok(tries < 50, `tasklist should list ${name} within 5s of its start`)
      await sleep(100)
    }
    assert.throws(
      () => install(pkg, cfgs, name),
      (e: unknown) => e instanceof Failed && e.message.includes(`${name} is running`),
    )
    for (const folder of folders) {
      assert.equal(fs.existsSync(path.join(folder, "Community", PACKAGE_NAME, "manifest.json")), false)
    }
  } finally {
    sim.kill()
    await exited
  }
})
