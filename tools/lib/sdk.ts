import fs from "node:fs"
import path from "node:path"

import { ROOT } from "./repo.ts"
import { Failed } from "./run.ts"

/** The SDK version every build uses, from the root's `msfs-sdk.txt`. */
export function wantedSdk(): string {
  return fs.readFileSync(path.join(ROOT, "msfs-sdk.txt"), "utf8").trim()
}

/**
 * The folder cargo-msfs reads the 2024 SDK from, `%APPDATA%\cargo-msfs\data\msfs2024`.
 * `sdk_folder` in tools/msfs-sdk/src/main.rs names the same folder, so change both together.
 */
export function sdkFolder(): string {
  const appdata = process.env.APPDATA
  if (!appdata) throw new Failed("APPDATA isn't set, so the SDK's folder can't be found")
  return path.join(appdata, "cargo-msfs", "data", "msfs2024")
}

/**
 * The installed SDK's version, or null when none is installed. Only the first line of
 * `version.txt` counts: tools/msfs-sdk writes the version alone, but a version.txt that
 * cargo-msfs installed adds a build number on a second line, such as `1.8.1\r\n2603316`.
 */
export function installedSdk(): string | null {
  try {
    return fs.readFileSync(path.join(sdkFolder(), "version.txt"), "utf8").split(/\r?\n/)[0]!.trim()
  } catch {
    return null
  }
}

/** Throws `Failed`, naming `node tools/setup.ts`, unless the installed SDK is the wanted one. */
export function requireSdk(): void {
  const wanted = wantedSdk()
  const installed = installedSdk()
  if (installed !== wanted) {
    const has = installed ? `SDK ${installed} is installed` : "no SDK is installed"
    throw new Failed(`msfs-sdk.txt names SDK ${wanted}, but ${has} in ${sdkFolder()}; run node tools/setup.ts`)
  }
}
