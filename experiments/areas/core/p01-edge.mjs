/*
 * p01: what the core's edge can count on from Windows, for node 6.1 of the
 * architecture plan, the core's loop and edge.
 *
 * - How late tokio's sleep wakes, at the default timer resolution and after
 *   timeBeginPeriod(1), and how late a high-resolution waitable timer wakes.
 * - Which C runtime functions Rust's f64 math reaches, from a release build's
 *   imports, since Windows' C runtime picks its FMA3 math by CPU.
 *
 * No sim. Run it with the PC otherwise idle:
 *
 *   node experiments/areas/core/p01-edge.mjs
 *
 * Output: results/p01-edge-<time>.txt.
 */

import { spawnSync } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { REPO, repoRelative, resultFile } from "../../tools/results.mjs"

const EDGE = path.join(REPO, "experiments", "areas", "core", "edge")
const RELEASE = path.join(EDGE, "target", "release")
const lines = []
const say = (s) => {
  console.log(s)
  lines.push(s)
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts })
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout)
    throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`)
  }
  return r.stdout
}

say(`p01-edge on ${os.version()} ${os.release()}, ${run("rustc", ["--version"]).trim()}`)

run("cargo", ["build", "--release", "--quiet"], { cwd: EDGE, stdio: ["ignore", "pipe", "inherit"] })

// ---------------------------------------------------------------- math

const vswhere = path.join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft Visual Studio", "Installer", "vswhere.exe")
const dumpbin = existsSync(vswhere)
  ? run(vswhere, ["-latest", "-products", "*", "-find", "VC\\Tools\\MSVC\\**\\bin\\Hostx64\\x64\\dumpbin.exe"]).trim().split(/\r?\n/)[0]
  : ""
if (!dumpbin) {
  say("MATH\tno dumpbin found; install Visual Studio's C++ workload")
} else {
  const exe = path.join(RELEASE, "math.exe")
  say(`MATH\timports of ${repoRelative(exe)}, the DLLs and the math functions only:`)
  // dumpbin's header names the file by its full path, which holds the home
  // folder, so only the DLL lines and the functions under them are kept.
  for (const line of run(dumpbin, ["/imports", exe]).split(/\r?\n/)) {
    const dll = /^\s+(\S+\.dll)\s*$/i.exec(line)
    const fn = /^\s+[0-9A-F]+\s+(sin|cos|tan|exp|log|pow|atan2)\s*$/.exec(line)
    if (dll) say(`MATH\t${dll[1]}`)
    if (fn) say(`MATH\t  ${fn[1]}`)
  }
}

// ---------------------------------------------------------------- timers

for (const bin of ["tokio_timers", "hires_timer"]) {
  for (const line of run(path.join(RELEASE, `${bin}.exe`), []).split(/\r?\n/)) {
    if (line.trim()) say(`TIMER\t${line}`)
  }
}

const file = resultFile("core", "p01-edge")
writeFileSync(file, lines.join("\n") + "\n")
console.log(`\nSaved ${repoRelative(file)}`)
