// A release's steps, each one step of a workflow (record/areas/build/01-the-build.md, "A
// release"):
//
//   node tools/release.ts pr                opens or updates the release pull request, from the
//                                           commits since the last release
//   node tools/release.ts start <commit>    stops unless <commit> is a release commit whose version
//                                           isn't published yet
//   node tools/release.ts download          fetches the newest release's full package, which `pack`
//                                           makes a delta from
//   node tools/release.ts pack              packs target/release-folder, with the release's notes
//   node tools/release.ts upload <commit>   uploads what `pack` wrote as a draft, with the tag on <commit>
//   node tools/release.ts check             checks that the draft holds what `pack` wrote
//   node tools/release.ts publish           publishes the draft as the newest release
//
// `pr` runs on each push to main (.github/workflows/release-pr.yml), and the rest when CI
// passes on a release commit, `chore(release): <version>` (.github/workflows/release.yml).
//
// `pack` packs target/release-folder, which `node tools/build.ts release` lays out, as the root
// Cargo.toml's version into target/releases, where `vpk` makes a delta from the release before
// when that one is there. It installs `vpk` into target/vpk the first time, which needs the
// .NET 8 SDK or later. It runs on a developer's PC too; the other steps reach GitHub, through
// `gh` with the workflow's token in GH_TOKEN, and run only in a workflow.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { commitsSince, lastRelease, nextVersion, releaseNotes, setVersion } from "./lib/changes.ts"
import { workspaceVersion } from "./lib/package.ts"
import { fullPackage, pack, RELEASE_FOLDER, RELEASES, vpk } from "./lib/release.ts"
import { Failed, main, output, run } from "./lib/run.ts"

const USAGE = "usage: node tools/release.ts pr | start <commit> | download | pack | upload <commit> | check | publish"

/**
 * A release commit's title, which the release pull request's commit takes, and a release
 * commit pushed by hand, the first release's or a stuck one's; squash-merging adds ` (#<n>)`.
 */
const RELEASE_TITLE = /^chore\(release\): (\d+\.\d+\.\d+)(?: \(#\d+\))?$/

/** The branch the release pull request comes from, which `pr` rewrites from main each time. */
const BRANCH = "release"

main(() => {
  const [step, ...args] = process.argv.slice(2)
  const commit = args.length === 1 && /^[0-9a-f]{40}$/.test(args[0]!) ? args[0]! : undefined
  if (step === "pack" && args.length === 0) {
    if (!fs.existsSync(RELEASE_FOLDER)) throw new Failed(`${RELEASE_FOLDER} holds no release; run node tools/build.ts release first`)
    const last = lastRelease()
    const notes = path.join(RELEASES, "..", "release-notes.md")
    fs.writeFileSync(notes, releaseNotes(commitsSince(last), last === null))
    pack(workspaceVersion(), notes)
    console.log(`packed version ${workspaceVersion()} into ${RELEASES}`)
  } else if (step === "pr" && args.length === 0) pullRequest()
  else if (step === "start" && commit) start(commit)
  else if (step === "download" && args.length === 0) download()
  else if (step === "upload" && commit) upload(commit)
  else if (step === "check" && args.length === 0) check()
  else if (step === "publish" && args.length === 0) publish()
  else throw new Failed(`${USAGE}\nA commit is its 40 hex digits.`)
})

/** The repository, as `owner/name`, which the workflow names. */
function repository(): string {
  const repo = process.env.GITHUB_REPOSITORY
  if (!repo) throw new Failed("GITHUB_REPOSITORY isn't set; this step runs only in the release workflow")
  return repo
}

function api<T>(route: string, ...args: string[]): T {
  return JSON.parse(output("gh", ["api", ...args, `repos/${repository()}/${route}`])) as T
}

type Release = { id: number; tag_name: string; draft: boolean; html_url: string; assets: { id: number; name: string }[] }

/** Every release, drafts among them when the token can push. */
function releases(): Release[] {
  return api<Release[]>("releases?per_page=100")
}

/** `vpk`'s environment: the token, which it reads from VPK_TOKEN, so no command line shows it. */
function vpkEnv(): NodeJS.ProcessEnv {
  const token = process.env.GH_TOKEN
  if (!token) throw new Failed("GH_TOKEN isn't set; this step runs only in the release workflow")
  return { ...process.env, VPK_TOKEN: token }
}

/**
 * Opens the release pull request, or rewrites it: the `release` branch becomes main plus one
 * commit, `chore(release): <version>`, which writes the next version into every file that holds
 * it, and the pull request's body holds the release's notes so far. It does nothing while no
 * commit since the last release changes what pilots run. The first release, with no tag before
 * it, is a commit of that title pushed to main by hand. The workflow's own token pushes the
 * branch, so GitHub starts no CI on it; merging it runs CI on main, which releases it.
 */
function pullRequest(): void {
  const last = lastRelease()
  if (!last) return console.log("no release is tagged yet: push the first, `chore(release): <version>`, to main by hand")
  // Between a release commit's merge and its tag, main holds a version no release has yet. A
  // release commit whose CI failed holds main there too, until a fix and a release commit
  // pushed by hand release it.
  if (workspaceVersion() !== last) {
    return console.log(`main holds ${workspaceVersion()}, which isn't released yet: if CI failed on its release commit, fix it, then push an empty \`chore(release): ${workspaceVersion()}\` to main`)
  }
  const commits = commitsSince(last)
  const next = nextVersion(last, commits)
  if (!next) return console.log(`nothing since ${last} is a feat, fix, or perf, so there's nothing to release`)
  const notes = releaseNotes(commits, false)
  setVersion(last, next)
  const bot = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"]
  run("git", ["switch", "--quiet", "-C", BRANCH])
  run("git", [...bot, "commit", "--quiet", "--all", "-m", `chore(release): ${next}`, "-m", notes])
  run("git", ["push", "--quiet", "--force", "origin", BRANCH])
  const title = `chore(release): ${next}`
  const body = `${notes}\nMerging this releases ${next}: CI runs on the merged commit, and the release workflow publishes it once CI passes. This pull request gets no CI run of its own, so merge it past the \`ci\` check as an admin, with a rebase or a squash.\n`
  const file = path.join(RELEASES, "..", "release-pr.md")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
  const open = output("gh", ["pr", "list", "--repo", repository(), "--head", BRANCH, "--state", "open", "--json", "number", "--jq", ".[0].number"]).trim()
  if (open) run("gh", ["pr", "edit", open, "--repo", repository(), "--title", title, "--body-file", file])
  else run("gh", ["pr", "create", "--repo", repository(), "--base", "main", "--head", BRANCH, "--title", title, "--body-file", file])
}

/**
 * Stops unless `commit` is a release commit whose version the tree holds, and unless no
 * published release has that version, since a release's tag is its version and a published one
 * never changes. A draft of it doesn't stop it: `upload` deletes it. CI's run on the commit
 * passed, or the release workflow wouldn't have started.
 */
function start(commit: string): void {
  const head = output("git", ["rev-parse", "HEAD"]).trim()
  if (head !== commit) throw new Failed(`the checkout is at ${head}, not ${commit}`)
  const title = output("git", ["log", "-1", "--format=%s", commit]).trim()
  const titled = RELEASE_TITLE.exec(title)?.[1]
  const version = workspaceVersion()
  if (titled !== version) throw new Failed(`${commit}'s title, "${title}", doesn't release the version the tree holds, ${version}`)
  const published = releases().find((r) => r.tag_name === version && !r.draft)
  if (published) throw new Failed(`version ${version} is published already, at ${published.html_url}`)
  console.log(`releasing version ${version} from ${commit}`)
}

/**
 * Fetches the newest release's full package into target/releases, and fails unless it's the
 * one releases/latest names, or nothing came and nothing is published. `vpk download github`
 * exits 0 having fetched nothing, and would fetch a draft its token could list, which this
 * job's read-only token can't.
 */
function download(): void {
  fs.rmSync(RELEASES, { recursive: true, force: true })
  fs.mkdirSync(RELEASES, { recursive: true })
  run(vpk(), ["download", "github", "--repoUrl", `https://github.com/${repository()}`, "--outputDir", RELEASES], { env: vpkEnv() })
  const newest = latestTag()
  const fetched = fs.readdirSync(RELEASES).filter((f) => f.endsWith("-full.nupkg"))
  const wanted = newest ? [fullPackage(newest)] : []
  if (fetched.join() !== wanted.join()) {
    throw new Failed(`vpk download github fetched ${fetched.join(", ") || "nothing"}, where the newest release, ${newest ?? "none yet"}, holds ${wanted.join("") || "nothing"}`)
  }
  console.log(newest ? `fetched ${wanted[0]}, which the delta starts from` : "no release is published yet, so this one carries no delta")
}

/** The tag releases/latest names, or null when no release is published. */
function latestTag(): string | null {
  const result = spawnSync("gh", ["api", `repos/${repository()}/releases/latest`], { encoding: "utf8" })
  if (result.status === 0) return (JSON.parse(result.stdout) as Release).tag_name
  // gh prints "gh: Not Found (HTTP 404)" when no release is published.
  if (/HTTP 404/.test(result.stderr)) return null
  throw new Failed(`gh api releases/latest failed:\n${result.stderr}`)
}

/** Deletes a draft of this version that a failed run left, since `vpk upload github` refuses a tag a release holds, then uploads a draft no pilot sees. */
function upload(commit: string): void {
  const version = workspaceVersion()
  for (const draft of releases().filter((r) => r.tag_name === version && r.draft)) {
    console.log(`deleting the draft a failed run left: ${draft.html_url}`)
    output("gh", ["api", "--method", "DELETE", `repos/${repository()}/releases/${draft.id}`])
  }
  run(vpk(), ["upload", "github", "--repoUrl", `https://github.com/${repository()}`, "--tag", version, "--targetCommitish", commit, "--outputDir", RELEASES], { env: vpkEnv() })
}

/** This version's draft, which `upload` left. */
function draft(): Release {
  const version = workspaceVersion()
  const found = releases().find((r) => r.tag_name === version && r.draft)
  if (!found) throw new Failed(`no draft of version ${version} is there to check or publish`)
  return found
}

/**
 * Fails unless the draft holds every file `vpk pack` listed in assets.win.json, and its
 * releases.win.json, the feed the desktop app's updater reads, lists this version's full
 * package and, when `download` fetched the release before into target/releases, this version's
 * delta from it. The draft's feed lists only this build's packages, so the release before shows
 * only here. fsc-editor's v0.1.0 shipped with nothing attached while its publisher exited 0
 * (fsc-editor, commit 7b2348e).
 */
function check(): void {
  const version = workspaceVersion()
  const release = draft()
  const uploaded = new Set(release.assets.map((a) => a.name))
  const packed = (JSON.parse(fs.readFileSync(path.join(RELEASES, "assets.win.json"), "utf8")) as { RelativeFileName: string }[]).map((a) => a.RelativeFileName)
  const missing = [...packed, "releases.win.json"].filter((f) => !uploaded.has(f))
  if (missing.length) throw new Failed(`the draft ${release.html_url} lacks ${missing.join(", ")}`)
  const feedAsset = release.assets.find((a) => a.name === "releases.win.json")!
  const feed = JSON.parse(output("gh", ["api", "-H", "Accept: application/octet-stream", `repos/${repository()}/releases/assets/${feedAsset.id}`])) as {
    Assets: { Version: string; Type: string; FileName: string }[]
  }
  const ours = (type: string) => feed.Assets.some((a) => a.Version === version && a.Type === type && uploaded.has(a.FileName))
  if (!ours("Full")) throw new Failed(`the draft's releases.win.json lists no full package of ${version} that the draft holds`)
  const older = fs.readdirSync(RELEASES).some((f) => f.endsWith("-full.nupkg") && f !== fullPackage(version))
  if (older && !ours("Delta")) throw new Failed(`the build fetched the release before, but the draft's releases.win.json lists no delta of ${version} that the draft holds`)
  console.log(`the draft holds the ${packed.length} files vpk pack wrote, and its feed lists ${version}'s full package${older ? " and its delta" : ""}`)
}

function publish(): void {
  const release = draft()
  output("gh", ["api", "--method", "PATCH", `repos/${repository()}/releases/${release.id}`, "-F", "draft=false", "-f", "make_latest=true"])
  console.log(`published https://github.com/${repository()}/releases/tag/${release.tag_name}`)
}
