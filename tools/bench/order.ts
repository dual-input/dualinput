// CI runs each scenario file as a job of its own, named by its title, so each check a pull
// request shows is one scenario, and a failed one reruns alone (record/areas/build/02-testing.md,
// "What keeps CI green"). The jobs start longest first, since GitHub runs only so many at once
// and the run lasts until its longest scenario ends.

/**
 * Each scenario file's title, and its time in seconds on our development machine: the 12
 * longest from the whole bench of 2026-11-20, `authoring` from a run of it alone on 2026-11-22,
 * `tape` from a run of it alone on 2026-11-24, `sync-log` from a run of it alone on 2026-11-25,
 * and the rest from a run of those files alone on 2026-11-21. When you add a scenario, add it
 * here; tools/bench/order.test.ts fails until you do.
 */
export const SCENARIOS: Readonly<Record<string, { title: string; seconds: number }>> = {
  "network-outages": { title: "Network outages", seconds: 392 },
  "pointer-sync": { title: "Pointer sync", seconds: 292 },
  cockpit: { title: "Cockpit stream", seconds: 282 },
  session: { title: "Session", seconds: 272 },
  avatars: { title: "Avatars", seconds: 259 },
  "network-loss": { title: "Network under loss", seconds: 190 },
  "state-sync": { title: "Cockpit state sync", seconds: 184 },
  traffic: { title: "Traffic", seconds: 176 },
  "flight-model": { title: "Flight-model sync", seconds: 171 },
  "take-control": { title: "Take-control", seconds: 164 },
  "desktop-app": { title: "Desktop app", seconds: 140 },
  profiles: { title: "Profiles", seconds: 124 },
  authoring: { title: "Authoring", seconds: 95 },
  tape: { title: "The recorder", seconds: 170 },
  "test-sessions": { title: "Test sessions", seconds: 45 },
  "clients-panels": { title: "Cockpit panels", seconds: 77 },
  "sync-log": { title: "The Sync log", seconds: 51 },
  "network-relays": { title: "Two relays", seconds: 76 },
  network: { title: "Network", seconds: 69 },
  "sim-module": { title: "WASM module", seconds: 52 },
  "atc-audio": { title: "ATC audio", seconds: 35 },
  "rate-and-pause": { title: "Rate and pause", seconds: 32 },
  "clients-outages": { title: "Core outages and pages", seconds: 30 },
  "go-to": { title: "Go to", seconds: 26 },
  "core-helper": { title: "Core helper", seconds: 24 },
  "clients-protocol": { title: "Client protocol", seconds: 15 },
  "sim-runs": { title: "Sim runs", seconds: 14 },
  recording: { title: "Recordings", seconds: 13 },
  "sim-connections": { title: "Sim connections", seconds: 12 },
  "clients-apps": { title: "Apps' wiring", seconds: 8 },
  "killed-core": { title: "Killed core", seconds: 6 },
  "sim-load": { title: "Flight load", seconds: 4 },
  builds: { title: "Bench and release builds", seconds: 2 },
}

/** Each scenario's file name and title, longest first, as CI's matrix takes them. */
export function matrix(scenarios: readonly string[]): { name: string; title: string }[] {
  const seconds = (name: string) => SCENARIOS[name]?.seconds ?? 0
  return [...scenarios]
    .sort((a, b) => seconds(b) - seconds(a) || a.localeCompare(b))
    .map((name) => ({ name, title: SCENARIOS[name]?.title ?? name }))
}
