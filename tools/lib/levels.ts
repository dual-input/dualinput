// A released level of the profile format never changes: a bundle published at it stays
// published for good, and every core of a release at or above it reads the bundle by the
// level's schema and declarations as that release's tag holds them
// (record/areas/architecture/02-code-map.md, "Profiles in this repository"). So CI fails, and
// publishes nothing from, a tree whose levels/<n>/ differs from a release tag that holds level n.
// A release before 1.0.0 freezes no level, since nobody flies one: its core may refuse a bundle
// published after its level changed, until it updates. Publishing still counts those releases'
// levels, so they get the tree's profiles (user, 2026-11-21). Every tag on this repository is a
// release's bare version (record/areas/build/01-the-build.md, "A release").

import { spawnSync } from "node:child_process"

import { compareVersions } from "./changes.ts"
import { ROOT } from "./repo.ts"
import { Failed, output } from "./run.ts"

const ENGINE = "src/engines/profile-engine"

/** The profile engine's `LEVEL` at each release tag, by tag. */
export function releasedLevels(): Map<string, number> {
  const tags = output("git", ["tag", "--list"]).split("\n").map((t) => t.trim()).filter(Boolean)
  return new Map(
    tags.map((tag) => {
      const engine = output("git", ["show", `${tag}:${ENGINE}/src/lib.rs`])
      const level = /^pub const LEVEL: u32 = (\d+);/m.exec(engine)?.[1]
      if (!level) throw new Failed(`the profile engine at the tag ${tag} names no LEVEL`)
      return [tag, Number(level)] as const
    }),
  )
}

/** Whether a release tag freezes its levels: one from 1.0.0 on. */
export function holdsLevels(tag: string): boolean {
  return compareVersions(tag, "1.0.0") >= 0
}

/** Each held level whose files in the tree differ from a release tag's, as `level 1, released in 1.0.0`. */
export function changedReleasedLevels(): string[] {
  const changed: string[] = []
  for (const [tag, level] of releasedLevels()) {
    if (!holdsLevels(tag)) continue
    for (let n = 1; n <= level; n++) {
      // `git diff` against the working tree reads both sides with the repository's line ends.
      const diff = spawnSync("git", ["diff", "--quiet", tag, "--", `${ENGINE}/levels/${n}/`], { cwd: ROOT })
      if (diff.status === 1) changed.push(`level ${n}, released in ${tag}`)
      else if (diff.status !== 0) throw new Failed(`git diff against the tag ${tag} exited with ${diff.status}`)
    }
  }
  return changed
}

/** Fails when a released level's files differ from a release tag's. */
export function checkReleasedLevels(): void {
  const changed = changedReleasedLevels()
  if (changed.length) {
    throw new Failed(`a released level of the profile format changed, which no release may do: ${changed.join("; ")}; a change belongs in a new level`)
  }
}
