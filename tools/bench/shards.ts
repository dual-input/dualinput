// CI splits the bench into shares that run at once, one job each, so a pull request's bench
// takes about its longest share rather than the whole bench's time
// (record/areas/build/02-testing.md, "What keeps CI green"). Each share is a list of scenario
// files, balanced by how long each file takes.

/**
 * Each scenario file's time in seconds on our development machine: the twelve longest from the
 * whole bench of 2026-11-20, the rest from a run of those files alone on 2026-11-21. When a
 * share's job runs long in CI, or a scenario is added, write its file's time from a run here.
 */
export const SECONDS: Readonly<Record<string, number>> = {
  "network-outages": 392,
  "pointer-sync": 292,
  cockpit: 282,
  session: 272,
  avatars: 259,
  "network-loss": 190,
  "state-sync": 184,
  traffic: 176,
  "flight-model": 171,
  "take-control": 164,
  "desktop-app": 140,
  profiles: 124,
  "clients-panels": 77,
  "network-relays": 76,
  network: 69,
  "sim-module": 52,
  "atc-audio": 35,
  "rate-and-pause": 32,
  "clients-outages": 30,
  "go-to": 26,
  "core-helper": 24,
  "clients-protocol": 15,
  "sim-runs": 14,
  recording: 13,
  "sim-connections": 12,
  "clients-apps": 8,
  "killed-core": 6,
  "sim-load": 4,
  builds: 2,
}

/** What a file missing from `SECONDS` counts as, a guess between the shorter files' times. */
const UNTIMED = 60

/**
 * The scenarios of share `n` of `count`, counted from 1. Each file, longest first, goes to the
 * share with the least time so far, so no share runs longer than the others by more than its
 * last file.
 */
export function share(scenarios: readonly string[], n: number, count: number): string[] {
  const shares = Array.from({ length: count }, () => ({ seconds: 0, files: [] as string[] }))
  const time = (file: string) => SECONDS[file] ?? UNTIMED
  for (const file of [...scenarios].sort((a, b) => time(b) - time(a) || a.localeCompare(b))) {
    const least = shares.reduce((min, s) => (s.seconds < min.seconds ? s : min))
    least.seconds += time(file)
    least.files.push(file)
  }
  return shares[n - 1]!.files.sort()
}

/** The seconds `files` took on our development machine, as `SECONDS` gives them. */
export function seconds(files: readonly string[]): number {
  return files.reduce((sum, file) => sum + (SECONDS[file] ?? UNTIMED), 0)
}
