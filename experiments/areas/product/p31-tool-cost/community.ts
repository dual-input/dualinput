/*
 * Which shared-cockpit package the sim mounts in each of p31's runs. Dual Input's and FS Copilot's
 * packages each replace VCockpit.js, so a run with one tool must have the other's out of Community,
 * and the run with no tool has both out. A package goes aside by a rename into a folder beside the
 * Community folder, on the same drive, so it's never copied and never deleted, and `restore` moves
 * back whatever that folder holds.
 *
 * The sim reads packages only as it starts, so every move refuses while it runs.
 */

import fs from "node:fs"
import path from "node:path"

import { packagesFolders, simRunning, userCfgs } from "../../../../tools/lib/install.ts"
import { Failed } from "../../../../tools/lib/run.ts"

export const DUAL_INPUT = "dualinput"
export const FS_COPILOT = "fscopilot-bridge"
export const PACKAGES = [DUAL_INPUT, FS_COPILOT] as const
export type Package = (typeof PACKAGES)[number]
export type Place = "in" | "aside" | "missing"

/** The folder beside Community that holds what a run moved aside, named for the probe. */
const ASIDE = "dualinput-p31-aside"

/**
 * Each Community folder the sim reads, as the real folder a junction leads to, since a rename
 * can't cross drives. `DUALINPUT_P31_PACKAGES` names a packages folder in place of the sim's, for a
 * dry run on a copy.
 */
function communities(): string[] {
  const named = process.env.DUALINPUT_P31_PACKAGES
  const folders = named ? [named] : packagesFolders(userCfgs())
  if (!folders.length) throw new Failed("no UserCfg.opt names a packages folder, so there's no Community folder to switch")
  return folders.map((f) => fs.realpathSync.native(path.join(f, "Community")))
}

function asideOf(community: string): string {
  return path.join(path.dirname(community), ASIDE)
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

function refuseWhileSimRuns(): void {
  if (!process.env.DUALINPUT_P31_PACKAGES && simRunning()) throw new Failed("the sim is running, and it reads packages only as it starts; close it, then run this again")
}

/** Where each package is in each Community folder. */
export function where(): { community: string; packages: Record<Package, Place> }[] {
  return communities().map((community) => {
    const packages = {} as Record<Package, Place>
    for (const name of PACKAGES) {
      if (exists(path.join(community, name))) packages[name] = "in"
      else if (exists(path.join(asideOf(community), name))) packages[name] = "aside"
      else packages[name] = "missing"
    }
    return { community, packages }
  })
}

/**
 * Mounts exactly the packages in `wanted` of the two, moving the other aside and bringing a wanted
 * one back from aside. A wanted package that's in neither place stops the run, since the run would
 * measure a tool with no code in the sim.
 */
export function mount(wanted: Package[]): string[] {
  refuseWhileSimRuns()
  const said: string[] = []
  for (const community of communities()) {
    for (const name of PACKAGES) {
      const inside = path.join(community, name)
      const aside = path.join(asideOf(community), name)
      if (wanted.includes(name)) {
        if (exists(inside)) continue
        if (!exists(aside)) throw new Failed(`${name} is in neither ${community} nor ${asideOf(community)}; install it, then run this again`)
        fs.renameSync(aside, inside)
        said.push(`moved ${name} back into Community`)
      } else {
        if (!exists(inside)) continue
        if (exists(aside)) throw new Failed(`${name} is in both ${community} and ${asideOf(community)}; move one away by hand, then run this again`)
        fs.mkdirSync(asideOf(community), { recursive: true })
        fs.renameSync(inside, aside)
        said.push(`moved ${name} aside, to ${asideOf(community)}`)
      }
    }
  }
  return said
}

/** Moves back every package a run moved aside, and removes the aside folder once it's empty. */
export function restore(): string[] {
  refuseWhileSimRuns()
  const said: string[] = []
  for (const community of communities()) {
    const folder = asideOf(community)
    if (!fs.existsSync(folder)) continue
    for (const name of PACKAGES) {
      const aside = path.join(folder, name)
      if (!exists(aside)) continue
      const inside = path.join(community, name)
      if (exists(inside)) throw new Failed(`${name} is in both ${community} and ${folder}; compare the two, keep one, then run this again`)
      fs.renameSync(aside, inside)
      said.push(`moved ${name} back into Community`)
    }
    // The folder holds only what `mount` put there, so it goes once it's empty, and stays otherwise.
    if (fs.readdirSync(folder).length === 0) fs.rmdirSync(folder)
    else said.push(`left ${folder}, which holds something p31 didn't put there`)
  }
  return said
}
