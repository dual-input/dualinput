// The status bar's text for the profile or module in the active editor, from the builds the
// language server reports. The bundle's short hash is what an author matches against the EFB
// app's session card, so the text shows the hash of the bundle the crew flies, and the errors
// of the save that failed to replace it (record/areas/profiles/03-the-extension.md, "Building
// on save"). It imports nothing of VS Code's, so Node's test runner tests it alone.

/**
 * One profile's build, as the server's `dualInput/build` notification gives it. The server
 * sends one at its start for each profile whose bundle the local folder holds, with `trigger`
 * the profile itself and `builtAt` the bundle's last-modified time.
 */
export type Build = {
  /** The profile's file, as a URI. */
  profile: string
  /** The saved file that set the build off, as a URI: the profile, or a module it imports. */
  trigger: string
  /** The full hex hash of the profile's bundle in the local folder, or null when it holds none. */
  hash: string | null
  /** The build's count of errors. */
  errors: number
  /** When the bundle in the local folder was built, as an ISO time. */
  builtAt: string | null
  /** The bundle's path. */
  bundle: string | null
}

export type Status = { text: string; tooltip: string }

export type Kind = "profile" | "module"

/**
 * The files the extension acts on, as the globs its file watchers take. The manifest names the
 * same folders in `contributes.languages`' `filenamePatterns`, and the aircraft one in
 * `activationEvents`, and `kindOf` below reads a path by them, so change all of them together.
 */
export const PATTERNS = ["**/profiles/aircraft/*.yaml", "**/profiles/modules/*.yaml"]

/** A profile or a module, by the folder its path puts it in, as `PATTERNS` names them, or null for any other file. */
export function kindOf(path: string): Kind | null {
  const folder = /\/profiles\/(aircraft|modules)\/[^/]+\.yaml$/i.exec(path.replaceAll("\\", "/"))?.[1]?.toLowerCase()
  return folder === "aircraft" ? "profile" : folder === "modules" ? "module" : null
}

/** A profile's name, its file's name without `.yaml`, from its URI. */
export function profileName(uri: string): string {
  return decodeURIComponent(uri.slice(uri.lastIndexOf("/") + 1)).replace(/\.yaml$/i, "")
}

/** The builds the server reported since the extension started, by URI. */
export class Builds {
  /** Each profile's latest build. */
  private readonly latest = new Map<string, Build>()
  /** The profiles each module's saves built. */
  private readonly importers = new Map<string, Set<string>>()

  record(build: Build): void {
    this.latest.set(build.profile, build)
    if (build.trigger === build.profile) return
    const importers = this.importers.get(build.trigger) ?? new Set()
    this.importers.set(build.trigger, importers.add(build.profile))
  }

  /**
   * The latest build of each of `profiles` that has a bundle in the local folder, such as the
   * profiles importing a module, which the server's `dualInput.importers` names.
   */
  bundled(profiles: string[]): Build[] {
    return profiles.flatMap((profile) => {
      const build = this.latest.get(profile)
      return build?.hash ? [build] : []
    })
  }

  /** The status bar's text for a profile or a module, or null when it shows nothing. */
  status(uri: string, kind: Kind): Status | null {
    if (kind === "profile") {
      const build = this.latest.get(uri)
      const shown = build && show(build)
      return shown ? { text: shown.hash ? `Dual Input ${shown.text}` : `Dual Input: ${shown.text}`, tooltip: shown.tooltip } : null
    }
    const shown = this.builtBy(uri).flatMap((build) => {
      const one = show(build)
      return one ? [{ name: profileName(build.profile), ...one }] : []
    })
    if (!shown.length) return null
    return {
      text: `Dual Input ${shown.map((one) => `${one.name} ${one.text}`).join(", ")}`,
      tooltip: shown.map((one) => `${one.name}: ${one.tooltip}`).join("\n"),
    }
  }

  /** The latest build of each profile a module's saves built, by name. */
  private builtBy(module: string): Build[] {
    const builds = [...(this.importers.get(module) ?? [])].map((profile) => this.latest.get(profile)!)
    return builds.sort((a, b) => profileName(a.profile).localeCompare(profileName(b.profile)))
  }
}

/** One profile's part of the status: its short hash or "not built", with its errors, or null when it has neither a bundle nor errors. */
function show(build: Build): { hash: boolean; text: string; tooltip: string } | null {
  const errors = build.errors === 1 ? "1 error" : `${build.errors} errors`
  if (build.hash) {
    const built = build.builtAt ? `the bundle built ${localTime(build.builtAt)}` : "its bundle"
    return build.errors
      ? { hash: true, text: `${build.hash.slice(0, 7)} · ${errors}`, tooltip: `The last build had ${errors}, so the local folder keeps ${built}` }
      : { hash: true, text: build.hash.slice(0, 7), tooltip: build.builtAt ? `Built ${localTime(build.builtAt)}` : "Built into the local folder" }
  }
  if (!build.errors) return null
  return { hash: false, text: `not built · ${errors}`, tooltip: `The last build had ${errors}, and the local folder holds no bundle of this profile` }
}

/** An ISO time as the author's local date and time, such as `2026-11-22 14:32:05`. */
function localTime(iso: string): string {
  const time = new Date(iso)
  const two = (n: number) => String(n).padStart(2, "0")
  return `${time.getFullYear()}-${two(time.getMonth() + 1)}-${two(time.getDate())} ${two(time.getHours())}:${two(time.getMinutes())}:${two(time.getSeconds())}`
}
