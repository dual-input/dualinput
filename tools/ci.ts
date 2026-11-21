// The steps of CI's workflows, in .github/workflows/, that take more than one command
// (record/areas/build/01-the-build.md, "CI"). Each runs only in a workflow, which sets the
// variables it reads.
//
//   node tools/ci.ts changes
//   node tools/ci.ts publish-profiles <pages>
//
// `changes` tells each job of ci.yml what the push or pull request changed: `code`, unless
// every file it changed is in profiles/, record/, docs/, experiments/, or .claude/, or is
// Markdown, and `profiles`, when one is in profiles/. A pull request that changes no code runs
// none of the checks or the bench, and one that changes only profiles/ runs the profiles' job
// alone; a push to `main` runs everything, so every commit on `main` has a run of its own that
// a release can take (record/areas/architecture/02-code-map.md, "CI").
//
// `publish-profiles` publishes the bundles at every level a release supports into the `pages`
// branch, checked out in <pages>, and pushes it when anything was added
// (record/areas/profiles/02-units.md, "Publishing").

import fs from "node:fs"
import path from "node:path"

import { matrix } from "./bench/order.ts"
import { buildPrograms } from "./lib/cargo.ts"
import { checkReleasedLevels, releasedLevels } from "./lib/levels.ts"
import { ROOT } from "./lib/repo.ts"
import { Failed, main, output, run } from "./lib/run.ts"

/** A path from the root that isn't code, as `changes` above gives them. */
const NOT_CODE = /^(profiles|record|docs|experiments|\.claude)\/|\.md$/

main(() => {
  const [step, ...args] = process.argv.slice(2)
  if (step === "changes" && args.length === 0) return changes()
  if (step === "publish-profiles" && args.length === 1) return publishProfiles(path.resolve(args[0]!))
  throw new Failed("usage: node tools/ci.ts changes | node tools/ci.ts publish-profiles <pages>")
})

function changes(): void {
  let code = true
  let profiles = true
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    // A pull request's run checks out its merge into the base branch, whose first parent is
    // the base, so the two differ by exactly what the pull request changes.
    // A rename lists both paths, so code moved into experiments/ still counts as changed code.
    const files = output("git", ["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"]).split("\n").filter(Boolean)
    console.log(`the pull request changes ${files.length} ${files.length === 1 ? "file" : "files"}:\n  ${files.join("\n  ")}`)
    code = files.some((f) => !NOT_CODE.test(f))
    profiles = files.some((f) => f.startsWith("profiles/"))
  }
  console.log(`code: ${code}, profiles: ${profiles}`)
  const out = process.env.GITHUB_OUTPUT
  if (!out) throw new Failed("GITHUB_OUTPUT isn't set; this step runs only in a workflow")
  // Each scenario's job, longest first, which the bench's matrix takes.
  const files = fs.readdirSync(path.join(ROOT, "tools", "bench", "scenarios")).filter((f) => f.endsWith(".ts"))
  const scenarios = JSON.stringify(matrix(files.map((f) => f.replace(/\.ts$/, ""))))
  fs.appendFileSync(out, `code=${code}\nprofiles=${profiles}\nscenarios=${scenarios}\n`)
}

function publishProfiles(pages: string): void {
  // A push to main publishes beside its checks rather than after them, so this check runs here
  // too: a bundle published under a changed level stays published for good.
  checkReleasedLevels()
  const level = Math.max(0, ...releasedLevels().values())
  console.log(level === 0 ? "no release is published, so no level is released yet" : `releases support levels up to ${level}`)
  const { "dualinput-profile-builder": builder } = buildPrograms(["-p", "dualinput-profile-builder"], ["dualinput-profile-builder"])
  run(builder, ["publish", "--released", String(level), "--profiles", path.join(ROOT, "profiles"), "--pages", pages])
  // The branch keeps every file it ever held, since a session may pin any bundle published.
  run("git", ["add", "--ignore-removal", "."], { cwd: pages })
  if (output("git", ["status", "--porcelain"], { cwd: pages }).trim() === "") {
    console.log("the pages branch holds every bundle already")
    return
  }
  const commit = output("git", ["rev-parse", "--short", "HEAD"]).trim()
  run("git", ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "--quiet", "-m", `The profiles at ${commit}`], { cwd: pages })
  run("git", ["push", "--quiet", "origin", "HEAD:pages"], { cwd: pages })
}
