/*
 * p01: what the core's edge can count on from Windows, for node 6.1 of the
 * architecture plan, the core's loop and edge.
 *
 * - How late tokio's sleep wakes, at the default timer resolution and after
 *   timeBeginPeriod(1), and how late a high-resolution waitable timer wakes.
 * - Which C runtime functions Rust's f64 math reaches, from a release build's
 *   imports, since Windows' C runtime picks its FMA3 math by CPU.
 * - Whether _set_FMA3_enable(0) changes what Rust's f64 math and QuickJS-ng's
 *   Math compute, and whether the two compute the same bits, with the C
 *   runtime's DLL and with the C runtime linked into the program.
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

for (const line of run(path.join(RELEASE, "fma3.exe"), []).split(/\r?\n/)) {
  if (line.trim()) say(`FMA3\tthe C runtime's DLL\t${line}`)
}

// The same check with the C runtime linked into the program, which the Windows
// SDK's static library gives, where the DLL comes with Windows. RUSTFLAGS is set
// for this build alone, in a target folder of its own.
const STATIC = path.join(EDGE, "target", "crt-static")
run("cargo", ["build", "--release", "--quiet", "--bin", "fma3", "--target-dir", STATIC], {
  cwd: EDGE,
  env: { ...process.env, RUSTFLAGS: "-C target-feature=+crt-static" },
  stdio: ["ignore", "pipe", "inherit"],
})
const staticExe = path.join(STATIC, "release", "fma3.exe")
for (const line of run(staticExe, []).split(/\r?\n/)) {
  if (line.trim()) say(`FMA3\tstatic C runtime\t${line}`)
}
if (dumpbin) {
  const dlls = run(dumpbin, ["/imports", staticExe])
    .split(/\r?\n/)
    .map((l) => /^\s+(\S+\.dll)\s*$/i.exec(l)?.[1])
    .filter(Boolean)
  say(`FMA3\tstatic C runtime\tits imports: ${dlls.join(", ")}`)
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
