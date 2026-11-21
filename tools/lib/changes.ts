// What changed since the last release, read from the commits' conventional titles and their
// `Release-Note:` trailers (.claude/rules/writing.md, "Commit messages"): the next version, the
// release's notes, and the version written into every file that holds it
// (record/areas/build/01-the-build.md, "A release").

import fs from "node:fs"
import path from "node:path"

import { ROOT } from "./repo.ts"
import { Failed, output } from "./run.ts"

export type Commit = {
  sha: string
  title: string
  /** The title's type, such as `feat`, or null when the title isn't a conventional commit. */
  type: string | null
  breaking: boolean
  /** Each `Release-Note:` trailer, for pilots. */
  notes: string[]
}

/** `type(scope)!: summary`, as in `feat(go-to): let the pilot monitoring pick the spot`. */
const TITLE = /^([a-z]+)(?:\([a-z0-9-]+\))?(!)?: \S/

/** A release's version, which is also its tag. */
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/

export function parseCommit(sha: string, title: string, body: string, notes: string[]): Commit {
  const found = TITLE.exec(title)
  return {
    sha,
    title,
    type: found?.[1] ?? null,
    breaking: Boolean(found?.[2]) || /^BREAKING[ -]CHANGE: /m.test(body),
    notes,
  }
}

/** The newest release's version, from the tags that name a version, or null before the first. */
export function lastRelease(): string | null {
  const tags = output("git", ["tag", "--list"]).split("\n").map((t) => t.trim()).filter((t) => VERSION.test(t))
  return tags.sort(compareVersions).at(-1) ?? null
}

export function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => VERSION.exec(v)!.slice(1).map(Number))
  return x![0]! - y![0]! || x![1]! - y![1]! || x![2]! - y![2]!
}

/** The commits after `since`, oldest first, or every commit when `since` is null. */
export function commitsSince(since: string | null, to = "HEAD"): Commit[] {
  // Fields end in 0x1f and commits in 0x1e, neither of which a commit message holds.
  const format = "%H%x1f%s%x1f%b%x1f%(trailers:key=Release-Note,valueonly,separator=%x1d)%x1e"
  const range = since ? `${since}..${to}` : to
  return output("git", ["log", "--reverse", `--format=${format}`, range])
    .split("\x1e")
    .map((c) => c.replace(/^\s+/, ""))
    .filter(Boolean)
    .map((c) => {
      const [sha, title, body, notes] = c.split("\x1f")
      return parseCommit(sha!, title!, body ?? "", (notes ?? "").split("\x1d").map((n) => n.trim()).filter(Boolean))
    })
}

/**
 * The version after `last` that `commits` call for, or null when none of them changes what
 * pilots run: a breaking change raises the major, or before 1.0 the minor; a `feat` raises the
 * minor; and a `fix` or `perf` the patch.
 */
export function nextVersion(last: string, commits: Commit[]): string | null {
  const [major, minor, patch] = VERSION.exec(last)!.slice(1).map(Number) as [number, number, number]
  if (commits.some((c) => c.breaking)) return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`
  if (commits.some((c) => c.type === "feat")) return `${major}.${minor + 1}.0`
  if (commits.some((c) => c.type === "fix" || c.type === "perf")) return `${major}.${minor}.${patch + 1}`
  return null
}

/** The release's notes, in Markdown: each `Release-Note:` trailer, grouped by its commit's type. */
export function releaseNotes(commits: Commit[], first: boolean): string {
  const groups: [string, (type: string | null) => boolean][] = [
    ["New", (t) => t === "feat"],
    ["Fixed", (t) => t === "fix" || t === "perf"],
    ["Changed", (t) => t !== "feat" && t !== "fix" && t !== "perf"],
  ]
  const sections = groups.flatMap(([heading, holds]) => {
    const notes = commits.filter((c) => holds(c.type)).flatMap((c) => c.notes)
    return notes.length ? [`## ${heading}\n\n${notes.map((n) => `- ${n}`).join("\n")}`] : []
  })
  if (sections.length) return `${sections.join("\n\n")}\n`
  return first ? "Dual Input's first release.\n" : "Nothing a pilot will notice changed in this release.\n"
}

/**
 * Writes `version` into every file that holds Dual Input's version, `from`: the root
 * `Cargo.toml`'s `[workspace.package]`, which every crate of the root workspace inherits; the
 * desktop app's `Cargo.toml`, a workspace of its own; our crates' entries at `from` in both
 * `Cargo.lock` files, the entries with no `source`, so a crate of ours that names a version of
 * its own keeps it; and the message crate's generated `stamp.ts`. The message crate's hash
 * leaves out the crate's own version, so a bump doesn't change it.
 */
export function setVersion(from: string, version: string, root = ROOT): void {
  const edit = (file: string, change: (text: string) => string) => {
    const full = path.join(root, file)
    const before = fs.readFileSync(full, "utf8")
    const after = change(before)
    if (after === before) throw new Failed(`${file} holds no version to change to ${version}`)
    fs.writeFileSync(full, after)
  }
  // The section's `version` line, among the lines up to the next section's header, which is
  // the first line to start with `[`.
  const section = (name: string) => (text: string) =>
    text.replace(new RegExp(`(^\\[${name.replace(/\./g, "\\.")}\\]\\n(?:(?!\\[)[^\\n]*\\n)*?version = ")[^"]+"`, "m"), `$1${version}"`)
  const lock = (text: string) =>
    text
      .split(/(?=\n\[\[package\]\]\n)/)
      .map((entry) => (/\nsource = /.test(entry) ? entry : entry.replace(`\nversion = "${from}"`, `\nversion = "${version}"`)))
      .join("")
  edit("Cargo.toml", section("workspace.package"))
  edit("src/apps/desktop/Cargo.toml", section("package"))
  edit("Cargo.lock", lock)
  edit("src/apps/desktop/Cargo.lock", lock)
  edit("src/engines/messages/ts/stamp.ts", (t) => t.replace(/export const VERSION = "[^"]+";/, `export const VERSION = "${version}";`))
}
