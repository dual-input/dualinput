// A release: the folder Setup.exe installs as `current\`, laid out from release builds, and
// packed with Velopack's `vpk` into a Setup.exe, a full package, and a delta from the release
// before when that one is in the output folder (record/areas/build/01-the-build.md, "What a
// release holds" and "A release").

import fs from "node:fs"
import path from "node:path"

import { colors } from "../../src/packages/ui/palette/palette.ts"
import { ROOT } from "./repo.ts"
import { Failed, output, run } from "./run.ts"

/** The folder a release is laid out in, which becomes `current\`. */
export const RELEASE_FOLDER = path.join(ROOT, "target", "release-folder")
/** Where `vpk pack` writes each release, and finds the one before for its delta. */
export const RELEASES = path.join(ROOT, "target", "releases")
/** Where `vpk` is installed, inside the build's own folder, so nothing goes on the PATH. */
const VPK_FOLDER = path.join(ROOT, "target", "vpk")
/**
 * Setup.exe's folder takes this name, `%LOCALAPPDATA%\DualInput\`, so it never changes
 * (record/areas/install/01-installing-and-updating.md, "On disk").
 */
const PACK_ID = "DualInput"
/** The C runtime's DLLs `SimConnect.dll` imports, which the core loads beside it (record/areas/build/01-the-build.md, "The C runtime"). */
const RUNTIME_DLLS = ["VCRUNTIME140.dll", "VCRUNTIME140_1.dll", "MSVCP140.dll"]

/**
 * The `velopack` crate's version in the desktop app's Cargo.lock. `vpk` packs its own
 * Update.exe, which that crate drives, and doesn't check that the two match for a Rust
 * program, so `vpk` runs at this version (record/areas/build/01-the-build.md, "A release").
 */
export function velopackVersion(lock = fs.readFileSync(path.join(ROOT, "src", "apps", "desktop", "Cargo.lock"), "utf8")): string {
  const found = /\[\[package\]\]\r?\nname = "velopack"\r?\nversion = "([^"]+)"/.exec(lock)
  if (!found) throw new Failed("src/apps/desktop/Cargo.lock holds no velopack")
  return found[1]!
}

/** `vpk` at the version the desktop app's lock gives Velopack, installed with `dotnet tool` if it isn't. */
export function vpk(): string {
  const wanted = velopackVersion()
  const program = path.join(VPK_FOLDER, "vpk.exe")
  const installed = fs.existsSync(program) ? output("dotnet", ["tool", "list", "--tool-path", VPK_FOLDER]) : ""
  // `dotnet tool list` prints a row such as "vpk  1.2.161  vpk".
  if (!new RegExp(`^vpk\\s+${wanted.replaceAll(".", "\\.")}\\s`, "m").test(installed)) {
    if (fs.existsSync(program)) run("dotnet", ["tool", "uninstall", "vpk", "--tool-path", VPK_FOLDER])
    run("dotnet", ["tool", "install", "vpk", "--version", wanted, "--tool-path", VPK_FOLDER])
  }
  return program
}

/**
 * The MSVC tools' folder of the C runtime's DLLs that a program may carry beside it,
 * Microsoft's "local deployment", from the newest Visual Studio with the C++ tools.
 */
export function runtimeFolder(): string {
  const vswhere = path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe")
  const studio = output(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"]).trim()
  const redist = path.join(studio, "VC", "Redist", "MSVC")
  const versions = fs.existsSync(redist) ? fs.readdirSync(redist).filter((v) => /^\d+\.\d+\.\d+$/.test(v)) : []
  const newest = versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1)
  const crt = newest && fs.readdirSync(path.join(redist, newest, "x64")).find((d) => /^Microsoft\.VC\d+\.CRT$/.test(d))
  if (!newest || !crt) throw new Failed(`no C runtime to redistribute in ${redist}; install Visual Studio's C++ tools`)
  return path.join(redist, newest, "x64", crt)
}

export type ReleasePrograms = { desktop: string; core: string; helper: string; simConnect: string }

/** Lays out `folder` afresh: the programs, `SimConnect.dll` and its runtime, and our package. */
export function layOutRelease(programs: ReleasePrograms, pkg: string, folder = RELEASE_FOLDER, runtime = runtimeFolder()): void {
  fs.rmSync(folder, { recursive: true, force: true })
  fs.mkdirSync(folder, { recursive: true })
  fs.copyFileSync(programs.desktop, path.join(folder, "dualinput-desktop.exe"))
  fs.copyFileSync(programs.core, path.join(folder, "dualinput-core.exe"))
  fs.copyFileSync(programs.helper, path.join(folder, "dualinput-core-helper.exe"))
  fs.copyFileSync(programs.simConnect, path.join(folder, "SimConnect.dll"))
  for (const dll of RUNTIME_DLLS) fs.copyFileSync(path.join(runtime, dll), path.join(folder, dll))
  fs.cpSync(pkg, path.join(folder, path.basename(pkg)), { recursive: true })
}

/**
 * Packs `folder` as version `version` with the desktop app as Velopack's main program, a
 * Start-menu shortcut, and WebView2 as a prerequisite, and no portable copy, which no design
 * covers (record/areas/build/01-the-build.md, "A release").
 */
export function pack(version: string, folder = RELEASE_FOLDER, releases = RELEASES): void {
  const icons = path.join(ROOT, "src", "apps", "desktop", "icons")
  run(vpk(), [
    "pack",
    "--packId", PACK_ID,
    "--packVersion", version,
    "--packDir", folder,
    "--packTitle", "Dual Input",
    "--packAuthors", "Dual Input",
    "--mainExe", "dualinput-desktop.exe",
    // Every program in the folder is x86_64, and with no runtime named, `vpk` takes x86.
    "--runtime", "win-x64",
    "--icon", path.join(icons, "icon.ico"),
    // Setup.exe plays the GIF, which `node tools/splash.ts` draws, over a bar in the kit's sky.
    "--splashImage", path.join(icons, "splash.gif"),
    "--splashProgressColor", colors.primary,
    "--framework", "webview2",
    "--shortcuts", "StartMenuRoot",
    "--noPortable",
    "--outputDir", releases,
  ])
}
