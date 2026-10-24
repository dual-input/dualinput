// Copies a development build's package into the sim's Community folders, as the desktop app
// copies a release's, so a developer can run our code in the sim
// (record/areas/build/01-the-build.md, "Our package").

import fs from "node:fs"
import path from "node:path"

import { PACKAGE_NAME } from "./package.ts"
import { Failed, output } from "./run.ts"

/** The sim's process, by the name the desktop app and the core's edge look for. */
export const SIM_PROCESS = "FlightSimulator2024.exe"

/**
 * Where each edition of the sim keeps its UserCfg.opt: Steam's in `%APPDATA%`, and the
 * Microsoft Store's in `%LOCALAPPDATA%` (record/areas/install/01-installing-and-updating.md,
 * "The packages folders"). `USER_CFGS` in src/platform/sim-service/src/aircraft.rs names the
 * same files, so change both together.
 */
export function userCfgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const files: string[] = []
  if (env.APPDATA) files.push(path.join(env.APPDATA, "Microsoft Flight Simulator 2024", "UserCfg.opt"))
  if (env.LOCALAPPDATA) {
    files.push(path.join(env.LOCALAPPDATA, "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalCache", "UserCfg.opt"))
  }
  return files
}

/**
 * The packages folder each of `cfgs` that exists names, once each, from its line such as
 * `InstalledPackagesPath "D:\MSFS 2024\Packages"`. The line's name must be followed by a
 * space, since a longer name, `InstalledPackagesPathNextBoot`, starts with the same letters
 * (read in flybywiresim/installer v3.7.2, `src/renderer/actions/install-path.utils.tsx`).
 * `packages_folder` in src/platform/sim-service/src/aircraft.rs reads the line the same way,
 * so change both together.
 */
export function packagesFolders(cfgs: string[]): string[] {
  const folders = new Map<string, string>()
  for (const cfg of cfgs.filter((f) => fs.existsSync(f))) {
    const name = "InstalledPackagesPath "
    const line = fs
      .readFileSync(cfg, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith(name))
    if (!line) throw new Failed(`${cfg} has no InstalledPackagesPath line, so it names no packages folder`)
    const folder = line.slice(name.length).trim().replace(/^"(.*)"$/, "$1")
    if (!fs.existsSync(folder)) throw new Failed(`${cfg} names the packages folder ${folder}, which doesn't exist`)
    folders.set(path.resolve(folder).toLowerCase(), folder)
  }
  return [...folders.values()]
}

/** Whether a process named `name` runs, matched without regard to letter case. */
export function simRunning(name = SIM_PROCESS): boolean {
  // tasklist's CSV gives one quoted row per process, and a localized line when none matches.
  const rows = output("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/FO", "CSV", "/NH"])
  return rows.split(/\r?\n/).some((row) => row.toLowerCase().startsWith(`"${name.toLowerCase()}"`))
}

/** Throws `Failed` while the sim, a process named `name`, runs. */
export function refuseWhileSimRuns(name = SIM_PROCESS): void {
  if (simRunning(name)) {
    throw new Failed(`not installed: ${name} is running, and the sim reads packages only as it starts; close it and install again`)
  }
}

/**
 * Copies the package in `pkg` into the Community folder of each packages folder that `cfgs`
 * name, and returns where it put each copy. It refuses while the sim, a process named
 * `simProcess`, runs.
 */
export function install(pkg: string, cfgs: string[], simProcess = SIM_PROCESS): string[] {
  refuseWhileSimRuns(simProcess)
  const folders = packagesFolders(cfgs)
  if (!folders.length) throw new Failed(`no UserCfg.opt names a packages folder; looked for ${cfgs.join(" and ")}`)
  return folders.map((folder) => copyInto(pkg, path.join(folder, "Community")))
}

/**
 * Copies the package beside `community` first, then renames the old copy out and the new
 * one in, and deletes the old one. A copy made inside Community could mount as a second
 * package, since the sim names each folder there by its name, and our FS Copilot
 * exerciser's sync that deleted before it copied "deleted 349 of 355 files" before it
 * reached one in use (record/areas/install/01-installing-and-updating.md, "Our package").
 */
function copyInto(pkg: string, community: string): string {
  fs.mkdirSync(community, { recursive: true })
  // A pilot can make Community a junction to another drive, and a rename can't cross
  // drives, so the copy goes beside the folder the junction leads to. That folder can be
  // anything, such as %APPDATA% or a drive's root, so the copy goes in a folder made for it
  // there, and nothing the install didn't make is deleted.
  const real = fs.realpathSync.native(community)
  const stage = fs.mkdtempSync(path.join(path.dirname(real), "dualinput-install-"))
  const fresh = path.join(stage, PACKAGE_NAME)
  const old = path.join(stage, "old")
  const installed = path.join(real, PACKAGE_NAME)
  fs.cpSync(pkg, fresh, { recursive: true })
  if (exists(installed)) fs.renameSync(installed, old)
  fs.renameSync(fresh, installed)
  remove(old)
  remove(stage)
  return path.join(community, PACKAGE_NAME)
}

/** Whether `file` exists, a junction that leads nowhere included. */
function exists(file: string): boolean {
  try {
    fs.lstatSync(file)
    return true
  } catch {
    return false
  }
}

/**
 * Deletes `dir`, or only the link when it's a junction or a symbolic link, since fsc-editor
 * found two packages in our Community folder that were junctions to folders under Program
 * Files (read in fsc-editor, `src/main/sim/install.ts`, `removeEntry`).
 */
function remove(dir: string): void {
  if (!exists(dir)) return
  if (fs.lstatSync(dir).isSymbolicLink()) fs.unlinkSync(dir)
  else fs.rmSync(dir, { recursive: true, force: true })
}
