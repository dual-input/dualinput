// The EFB app's scenes on the stand-in core: each state a person looks at, and the commands a pilot presses walking
// from it as the core would.

import { COUNTDOWN } from "@dualinput/crew"

import { StandInBase } from "../../../engines/page-client/dev/stand-in-base.ts"
import type { Slices } from "../../../engines/page-client/dev/stand-in-base.ts"
import type { CoreSlice } from "../../../engines/messages/ts/clients/CoreSlice.ts"
import type { Setting } from "../../../engines/messages/ts/clients/Setting.ts"
import type { ProfilesSlice } from "../../../engines/messages/ts/profiles/ProfilesSlice.ts"
import type { Runs } from "../../../engines/messages/ts/profiles/Runs.ts"
import type { Difference } from "../../../engines/messages/ts/session/Difference.ts"
import type { RefusedWhy } from "../../../engines/messages/ts/session/RefusedWhy.ts"
import type { NamedAircraft } from "../../../engines/messages/ts/sim/NamedAircraft.ts"
import type { SimSlice } from "../../../engines/messages/ts/sim/SimSlice.ts"
import type { SessionSlice } from "../../../engines/messages/ts/session/SessionSlice.ts"
import type { JsonValue } from "../../../engines/messages/ts/serde_json/JsonValue.ts"
import type { SliceMember } from "../../../engines/messages/ts/session/SliceMember.ts"
import type { Status } from "../../../engines/messages/ts/session/Status.ts"
import type { DesktopState } from "../../../engines/messages/ts/desktop/DesktopState.ts"
import type { Role } from "../../../engines/messages/ts/session/Role.ts"
import type { ToDesktop } from "../../../engines/messages/ts/desktop/ToDesktop.ts"
import { VERSION } from "../../../engines/messages/ts/stamp.ts"
import type { Socket } from "../../../engines/page-client/src/page-client.ts"
import type { DesktopEnv } from "../src/desktop-link.ts"
import { GUIDE_DONE, OUTPUT, SETUP_DONE } from "../src/settings/setting.ts"

/** A made-up pilot ID, 32 hex digits, which seeds their head's own pace. */
const pilotId = (seed: number) => Array.from({ length: 32 }, (_, at) => ((seed * 7 + at * at * 13 + seed * at) % 16).toString(16)).join("")
const ME = pilotId(1)
const JAMES = pilotId(2)

const inFlight: Status = { stage: "ready-to-fly", aircraft: { path: "baron58p/presets/blacksquare/baron58p" }, title: "Baron 58P", pause: 0, ended: null, links: [] }
const atMenu: Status = { stage: "menu", aircraft: null, title: null, pause: 0, ended: null, links: [] }

const member = (pilot: string, name: string, status: Status, rest: Partial<SliceMember> = {}): SliceMember => ({ pilot, name, color: 0, status, in_flight: status === inFlight, ready: false, without: [], ...rest })
const me = (status: Status, rest: Partial<SliceMember> = {}) => member(ME, "You", status, { color: 5, ...rest })
const james = (status: Status, rest: Partial<SliceMember> = {}) => member(JAMES, "James", status, { color: 1, ...rest })
const extra = (name: string, seed: number, rest: Partial<SliceMember> = {}) => member(pilotId(seed), name, inFlight, { color: seed % 8, ready: true, ...rest })

const CODE = "K7R4XM"
const DIFFERENCES: Difference[] = [
  { item: 1, level: "error", words: "James has version 2.1.2 of the aircraft, you have 2.1.3", note: "Some controls may not sync" },
  { item: 2, level: "warning", words: "Different liveries may alter the aircraft's configuration and cause sync issues" },
  { item: 3, level: "warning", words: "James's sim is 4 hours ahead of yours" },
]

/**
 * Traffic's and ATC audio's role keys, which their parts find by label. A scene says who holds each. `LABEL` in
 * src/features/traffic/efb/part.tsx and in src/features/atc-audio/efb/part.tsx names the same label as each feature's
 * core does, so change all three together.
 */
const SHARE_TRAFFIC = "Share my traffic"
const SHARE_ATC = "Share my ATC"
const roles = (holders: { traffic?: string; atc?: string } = {}): Role[] => [
  { key: 1, label: SHARE_TRAFFIC, holder: holders.traffic ?? null },
  { key: 2, label: SHARE_ATC, holder: holders.atc ?? null },
]

const noSession: SessionSlice = { held: false, code: null, me: ME, pf: null, members: [], preflight: { aircraft: null, phase: "no-aircraft" }, differences: [], ready: null, share: null, roles: [], attempt: null, refused: null }
const held = (rest: Partial<SessionSlice>): SessionSlice => ({ ...noSession, held: true, code: CODE, pf: ME, ready: [], share: [], roles: roles(), ...rest })
const running = { aircraft: inFlight.aircraft, phase: "running" as const }

const BARON: NamedAircraft = { path: "baron58p/presets/blacksquare/baron58p", maker: "Black Square", model: "Baron 58P", tail: "N58BS" }
const FENIX: NamedAircraft = { path: "fnx320/presets/fenix/a320", maker: "Fenix", model: "A320", tail: "G-FNXA" }
const SUPPORTED: ProfilesSlice["supported"] = [
  { maker: "Black Square", model: "Baron 58P", maturity: "Stable", installed: true },
  { maker: "Synaptic Simulations", model: "A220-300", maturity: "Stable", installed: true },
  { maker: "A2A Simulations", model: "PA24-250 Comanche", maturity: "Experimental", installed: true },
  { maker: "FSReborn", model: "Phenom 300E", maturity: "Experimental", installed: true },
  { maker: "PMDG", model: "777-300ER", maturity: "Experimental", installed: true },
  { maker: "A2A Simulations", model: "Aerostar 600", maturity: "Experimental", installed: false },
  { maker: "Black Square", model: "Bonanza", maturity: "Stable", installed: false },
  { maker: "iniBuilds", model: "A350", maturity: "Experimental", installed: false },
  { maker: "iniBuilds", model: "A380", maturity: "Experimental", installed: false },
  { maker: "iniBuilds", model: "L-1011 TriStar", maturity: "Experimental", installed: false },
]
const NO_PROFILE: ProfilesSlice = { loaded: null, supported: SUPPORTED, pick_failed: 0, test: null }
const atWorldMap: SimSlice = { stage: "menu", page: "world-map", where: "world-map", aircraft: BARON, pause: 0, ended: null, module: "running" }
const fenix: SimSlice = { ...atWorldMap, aircraft: FENIX }
const CORE: CoreSlice = { version: VERSION, hash: "", username: null }
const setting = (key: string, value: boolean): Setting => ({ key, label: key, kind: { type: "bool" }, value, default: false, part_only: false })
const settings = (setupDone: boolean, guideDone: boolean): Setting[] => [setting(SETUP_DONE, setupDone), setting(GUIDE_DONE, guideDone)]
const firstRun = { settings: settings(false, false), core: { ...CORE, username: "jordan" } }
const firstVisit = { settings: settings(true, false) }
const RUNS = [
  { name: "2026-10-27_21-10-00", size: 64_000_000, in_progress: false },
  { name: "2026-10-28_19-30-00", size: 97_000_000, in_progress: false },
  { name: "2026-10-29_20-05-00", size: 129_000_000, in_progress: false },
  { name: "2026-10-31_18-48-00", size: 18_000_000, in_progress: false },
  { name: "2026-10-31_21-15-00", size: 301_000_000, in_progress: false },
  { name: "2026-11-01_09-40-00", size: 212_000_000, in_progress: false },
  { name: "2026-11-01_14-02-00", size: 86_000_000, in_progress: true },
]
const OUTPUTS = {
  outputs: [
    { id: "usb", name: "Headset (USB Audio)" },
    { id: "realtek", name: "Speakers (Realtek(R) Audio)" },
    { id: "lg", name: "LG HDR 4K (NVIDIA High Definition Audio)" },
  ],
  programs: ["Discord", "BeyondATC", "FlightSimulator2024"],
  in_use: { id: "usb", name: "Headset (USB Audio)" },
}

const reach = { internet: true, servers: "reachable" as const }
const healthy = { network: { members: [], ...reach }, sim: atWorldMap, profiles: { loaded: { maturity: "Stable" }, supported: SUPPORTED, pick_failed: 0, test: null }, session: noSession, settings: settings(true, true) }

/** A test session's profiles' slice: James's save, with what each PC runs. */
const testSession = (yours: Runs, james: Runs): ProfilesSlice => ({
  loaded: { maturity: "Experimental" },
  supported: SUPPORTED,
  pick_failed: 0,
  test: { hash: "3f9c2a1", from: JAMES, members: [{ pilot: ME, runs: yours }, { pilot: JAMES, runs: james }] },
})

/**
 * Take control's slice and its stream's, by name alone, since no shell names a feature: live once this pilot is in the
 * flight, with this pilot not flying unless a scene says so.
 */
const TAKE_CONTROL = "take-control"
const STREAM = "cockpit-stream"
const INPUT = "take-control.input"
const control = (rest: Record<string, unknown>) => ({ live: true, mine: false, denied: [], warning: null, waiting: false, next_press: null, ...rest })
const ended = { aircraft: inFlight.aircraft, phase: "ended" as const }
const flying = (pf: string, holders: { traffic?: string; atc?: string } = {}): SessionSlice =>
  held({ pf, members: [me(inFlight), james(inFlight)], preflight: ended, differences: DIFFERENCES, ready: null, roles: roles(holders) })

/** Traffic's, ATC audio's, and Go to's slices, by name alone and untyped, as take control's above. */
const TRAFFIC = "traffic"
const ATC = "atc-audio"
const GO_TO = "go-to"
const noTraffic = { missing: 0, others: 0, packs: null }
const PACKS = [{ name: "fsltl-traffic-base", version: "1.0.0" }]
const noJoin = { spot: null, join: { as: "hidden" }, said: null }
const AT_KSEA = { airport: "KSEA", stand: { name: "PARKING", number: 140 }, engines: false, livery: "N515MR" }
/** What the stand-in reads of Go to's slice when Join is pressed. */
type Joining = { spot: unknown; join: { as: string }; said: { n: number } | null }
/** James flying from a stand, with this pilot at the menu, out of the flight, where Join shows on James's row. */
const jamesAway = held({ pf: JAMES, members: [me(atMenu), james(inFlight)], preflight: ended, ready: null })
/** This pilot in a flight of their own, in the A320, where Join can't run until they end it, as Go to's core says. */
const inA320: Status = { ...inFlight, aircraft: { path: FENIX.path }, title: "A320" }
const jamesElsewhere = held({ pf: JAMES, members: [me(inA320), james(inFlight)], preflight: ended, ready: null })
/** A key the stand-in binds at the next press, as the helper names it. */
const F9 = { input: { key: { scan: 67, extended: false } }, name: "F9" }
const boundTo = (name: string) => ({ settings: [...settings(true, true), { ...setting(INPUT, false), kind: { type: "input" as const }, value: { ...F9, name }, default: null }] })

/** The up link to James the session's scenes share, over a relay at 120ms. */
const netUp = { network: { members: [{ pilot: JAMES, up: true, path: { Relay: { url: "https://relay.example" } }, round_trip_ms: 120 }], ...reach } }
const DESKTOP = "desktop"
const LOCAL: DesktopState = { update: { state: "current", checked: "4 minutes ago" }, firewall: "allows", start_with_windows: "on" }

/** What a scene has the answer to Host or Join be, which is no slice of the core's. */
const REFUSING = "refusing"
/** What a scene puts on the clipboard, which is no slice of the core's either. */
const CLIPBOARD = "clipboard"

/** Each state a person looks at, by name, with what it sets on top of the sim's healthy slices. */
export const SCENES: Record<string, Slices> = {
  "First-time setup": firstRun,
  "First-time setup, checking": firstRun,
  "Setup: add-on mismatch": { ...firstRun, core: { ...firstRun.core, version: "0.0.9" } },
  "Setup: offline": { ...firstRun, network: { members: [], internet: false, servers: "unreachable" } },
  "Setup: our servers": { ...firstRun, network: { members: [], internet: true, servers: "unreachable" } },
  "Setup: firewall": { ...firstRun, [DESKTOP]: { ...LOCAL, firewall: "blocks" } },
  "First visit": firstVisit,
  "First visit, no profile": { ...firstVisit, sim: fenix, profiles: NO_PROFILE },
  "Before a session": {},
  "No profile for the aircraft": { sim: fenix, profiles: NO_PROFILE },
  "No profile, in a flight": { sim: { ...fenix, where: "flight" }, profiles: NO_PROFILE },
  "Servers refuse": { [REFUSING]: "servers" },
  "No session has the code": { [REFUSING]: "no-code" },
  "Connection won't open": { [REFUSING]: "no-connection" },
  "Too slow to answer": { [REFUSING]: "slow" },
  "A code on the clipboard": { [CLIPBOARD]: CODE },
  "Alone in a session": { session: held({ members: [me(atMenu)] }) },
  "James joins": { session: held({ members: [me(atMenu), james({ ...atMenu, stage: "loading" })] }) },
  Preflight: { ...netUp, session: held({ members: [me(inFlight), james(inFlight, { ready: true })], preflight: running, differences: DIFFERENCES }) },
  "Preflight, aircraft settling": { ...netUp, session: held({ members: [me(inFlight), james(inFlight)], preflight: running, differences: DIFFERENCES, ready: ["Ready opens once your aircraft has settled, about 30s after Ready to fly"] }) },
  "Preflight, James dropped": {
    network: { members: [{ pilot: JAMES, up: false, path: null, round_trip_ms: null }], ...reach },
    session: held({ members: [me(inFlight, { ready: true }), james(inFlight)], preflight: running, differences: DIFFERENCES }),
  },
  "Preflight, James at the menu": {
    ...netUp,
    session: held({ members: [me(inFlight, { ready: true }), james(atMenu)], preflight: running, differences: DIFFERENCES }),
  },
  "Preflight, big crew": {
    ...netUp,
    session: held({
      members: [me(inFlight), james(inFlight, { ready: true }), extra("Adam", 3), extra("Mia", 4, { ready: false }), extra("Lena", 5), extra("Omar", 6, { ready: false }), extra("Priya", 7), extra("Theo", 8), extra("Sven", 9, { ready: false }), extra("Rosa", 10)],
      preflight: running,
      differences: DIFFERENCES,
    }),
  },
  Flying: { ...netUp, ...boundTo("F9"), session: flying(ME), [TAKE_CONTROL]: control({ mine: true }) },
  "James flying": { ...netUp, session: flying(JAMES), [TAKE_CONTROL]: control({}) },
  "Flying together": {
    ...netUp,
    ...boundTo("F9"),
    session: { ...flying(JAMES, { traffic: JAMES, atc: ME }), differences: [] },
    [TAKE_CONTROL]: control({}),
    [ATC]: { capturing: "BeyondATC" },
  },
  "James flying, a key bound": { ...netUp, ...boundTo("F9"), session: flying(JAMES), [TAKE_CONTROL]: control({}) },
  "James flying, a long key's name": { ...netUp, ...boundTo("Thrustmaster TCA Sidestick button 12"), session: flying(JAMES), [TAKE_CONTROL]: control({}) },
  "James flying, catching up": { ...netUp, ...boundTo("F9"), session: flying(JAMES), [TAKE_CONTROL]: control({ denied: ["You're catching up with James."] }), [STREAM]: { catching_up: true, from_preflight_end: false, replaying: false } },
  "James flying, another guard refuses": { ...netUp, session: flying(JAMES), [TAKE_CONTROL]: control({ denied: ["Only the instructor can take control"] }) },
  "Test session": {
    ...netUp,
    session: flying(JAMES),
    [TAKE_CONTROL]: control({}),
    profiles: testSession({ t: "loaded", hash: "3f9c2a1" }, { t: "loaded", hash: "3f9c2a1" }),
    notifications: [{ id: "profile-loader.edit", level: "information", text: "James's profile edit is loaded on both PCs", detail: "Profile 3f9c2a1", pilot: JAMES, once: true, landing: "session" }],
  },
  "Test session, a save loading": { ...netUp, session: flying(JAMES), [TAKE_CONTROL]: control({}), profiles: testSession({ t: "loading" }, { t: "loaded", hash: "3f9c2a1" }) },
  "James's link lost": { network: { members: [{ pilot: JAMES, up: false, path: null, round_trip_ms: null }], ...reach }, ...boundTo("F9"), session: flying(JAMES), [TAKE_CONTROL]: control({ warning: "James may still be flying. If you take control, their aircraft will jump to yours when they reconnect." }) },
  "Traffic: James shares, some missing": { ...netUp, session: flying(JAMES, { traffic: JAMES }), [TRAFFIC]: { ...noTraffic, missing: 3, others: 12 } },
  "Traffic: you share": { ...netUp, session: flying(ME, { traffic: ME }) },
  "ATC: you share": { ...netUp, session: flying(ME, { atc: ME }), [ATC]: { capturing: "BeyondATC" } },
  "ATC: James shares": { ...netUp, session: flying(JAMES, { atc: JAMES }) },
  "Join: James at a stand": { ...netUp, session: jamesAway, [GO_TO]: { ...noJoin, spot: AT_KSEA, join: { as: "ready" } } },
  "Join: another aircraft": { ...netUp, sim: { ...fenix, stage: "ready-to-fly", where: "flight" }, session: jamesElsewhere, [GO_TO]: { ...noJoin, spot: AT_KSEA, join: { as: "unavailable", why: "other-aircraft" } } },
  "Header: offline": { network: { members: [], internet: false, servers: null } },
  "Header: several things": { network: { members: [], internet: true, servers: "unreachable" }, [DESKTOP]: { ...LOCAL, firewall: "blocks", update: { state: "ready", next: "1.0.3" } } },
  "Header: our own parts": {
    session: held({ members: [me(inFlight), james(inFlight)], preflight: { aircraft: inFlight.aircraft, phase: "ended" }, ready: null }),
    network: { members: [], internet: true, servers: "unreachable" },
    notifications: [
      { id: "sim-service.module-stopped", level: "trouble", text: "Dual Input's WASM module stopped", detail: "Restart the sim to fly together again.", landing: "header" },
      { id: "clients.no-panel", level: "trouble", text: "Cockpit screens aren't syncing", detail: "Dual Input couldn't load into the cockpit's panels. Another add-on that replaces VCockpit.js is the likeliest cause.", landing: "header" },
      { id: "core-helper.down", level: "trouble", text: "Dual Input's Windows helper is down", detail: "Keybinds, audio, and your figure's pointing won't work until it's back.", landing: "header" },
      { id: "core-helper.failed.binding-1", level: "warning", text: "Your take-control key isn't working", detail: "Windows didn't let Dual Input listen for F9.", landing: "header" },
    ],
    [DESKTOP]: { ...LOCAL, firewall: "blocks" },
  },
  "Recording stopped": { recording: { runs: RUNS, stopped: "no-space" } },
  "Output device missing": { settings: [...settings(true, true), { ...setting(OUTPUT, false), kind: { type: "device" }, value: { id: "old", name: "Studio Headphones" } }] },
  "Update available": { [DESKTOP]: { ...LOCAL, update: { state: "available", next: "1.0.3" } } },
  "Update ready": { [DESKTOP]: { ...LOCAL, update: { state: "ready", next: "1.0.3" } } },
  "No tray app": { [DESKTOP]: null },
  "Turned off in Windows": { [DESKTOP]: { ...LOCAL, start_with_windows: "off-in-windows" } },
  "Another version": { core: { ...CORE, version: "0.0.9" } },
  "Figures: model can't be read": { avatars: { note: "model" } },
  "Figures: no seats": { avatars: { note: "seats" } },
  "Traffic: nobody shares": { ...netUp, session: flying(JAMES) },
  "ATC: nobody shares": { ...netUp, session: flying(JAMES) },
  Figures: { ...netUp, session: flying(JAMES) },
  Settings: { ...netUp, ...boundTo("F9"), session: flying(JAMES) },
}

/**
 * How long a scene runs before tools/screenshots.ts takes its picture, in ms of its own time, where the tool's 5s would
 * catch it too early: setup greets the pilot for 2s and then runs its checks one by one, reaching the name card at about
 * 9s, or stopping at the check that fails.
 */
export const SCENE_TIMES: Partial<Record<string, number>> = {
  "First-time setup": 12_000,
  "Setup: add-on mismatch": 12_000,
  "Setup: offline": 12_000,
  "Setup: our servers": 12_000,
  "Setup: firewall": 12_000,
}

/** The tab a scene is about, by its label, where it isn't the Session tab. */
export const SCENE_TABS: Partial<Record<string, string>> = {
  "Traffic: James shares, some missing": "Traffic",
  "Traffic: you share": "Traffic",
  "Traffic: nobody shares": "Traffic",
  "ATC: you share": "ATC audio",
  "ATC: James shares": "ATC audio",
  "ATC: nobody shares": "ATC audio",
  "Figures: model can't be read": "Figures",
  "Figures: no seats": "Figures",
  Figures: "Figures",
  "Recording stopped": "Settings",
  "Output device missing": "Settings",
  "Update available": "Settings",
  "Update ready": "Settings",
  "No tray app": "Settings",
  "Turned off in Windows": "Settings",
  Settings: "Settings",
}
const AFTER = { answer: 1000, slowAnswer: 10_000 }


/** The stand-in. `scene` jumps to a state, and the commands a pilot presses walk from it as the core would. */
export class StandInCore extends StandInBase {
  private countdown = 0
  private answer = 0
  private nextPress = 0
  private refusing: string | null = null
  private clipboard: string | null = null
  private desktopSocket: Socket | null = null
  private local: DesktopState | null = LOCAL
  sceneName = "Before a session"

  protected greeted(): void {
    if (!this.slices.session) this.scene(this.sceneName)
  }

  private session(): SessionSlice {
    return this.slices.session as SessionSlice
  }

  private setSession(changes: Partial<SessionSlice>): void {
    this.set({ session: { ...this.session(), ...changes } })
  }

  /** Jumps to a scene: the sim's healthy slices with what it sets on top. Setup ends first, so one scene of it to another starts it over. */
  scene(name: string): void {
    window.clearTimeout(this.countdown)
    window.clearTimeout(this.answer)
    this.sceneName = name
    const scene = SCENES[name]!
    this.refusing = (scene[REFUSING] as string | undefined) ?? null
    this.clipboard = (scene[CLIPBOARD] as string | undefined) ?? null
    this.desktopSocket?.onclose?.()
    this.local = DESKTOP in scene ? (scene[DESKTOP] as DesktopState | null) : LOCAL
    this.tellDesktop()
    this.set({ settings: settings(true, true) })
    window.setTimeout(() => this.set({ ...healthy, [TAKE_CONTROL]: control({ live: false }), [STREAM]: { catching_up: false, from_preflight_end: false, replaying: false }, recording: { runs: RUNS, stopped: null }, "core-helper": { ...OUTPUTS, outputs: [] }, notifications: [], core: CORE, avatars: { note: null }, [TRAFFIC]: noTraffic, [ATC]: { capturing: null }, [GO_TO]: noJoin, ...scene }), 0)
  }

  private setControl(changes: Record<string, unknown>): void {
    this.set({ [TAKE_CONTROL]: { ...(this.slices[TAKE_CONTROL] as Record<string, unknown>), ...changes } })
  }

  /** The button's request, which takes control unless a guard refuses, as the core's does. */
  private takeControl(): void {
    if ((this.slices[TAKE_CONTROL] as { denied: string[] }).denied.length > 0) return
    this.setSession({ pf: ME })
    this.setControl({ mine: true, warning: null })
  }

  /** Bind, whose next press comes 1.5s later, and Cancel, which forgets it. */
  private bind(on: boolean): void {
    window.clearTimeout(this.nextPress)
    this.setControl({ waiting: on, next_press: null })
    if (on) this.nextPress = window.setTimeout(() => this.setControl({ waiting: false, next_press: F9 }), 1500)
  }

  protected command(name: string, args: JsonValue): void {
    const fields = (args ?? {}) as Record<string, unknown>
    if (name === "session.host") this.attempt("host", null)
    else if (name === "session.join") this.attempt("join", String(fields.code))
    else if (name === "session.join-from-clipboard") {
      if (this.clipboard) this.attempt("join", this.clipboard)
    } else if (name === "core-helper.list") this.set({ "core-helper": OUTPUTS })
    else if (name === "session.cancel") this.cancelAttempt()
    else if (name === "session.leave") this.set({ session: noSession })
    else if (name === "session.ready") this.setReady(!!fields.on)
    else if (name === "session.go-without") this.goWithout(String(fields.member))
    else if (name === "clients.set-setting") this.setSetting(String(fields.key), fields.value as JsonValue)
    else if (name === "take-control.request") this.takeControl()
    else if (name === "take-control.bind") this.bind(!!fields.on)
    else if (name === "session.share") this.share(Number(fields.key), !!fields.on)
    else if (name === "traffic.list-packs") this.set({ [TRAFFIC]: { ...(this.slices[TRAFFIC] as Record<string, unknown>), packs: PACKS } })
    else if (name === "go-to.join") this.join(!!fields.now)
  }

  /** A switch claims its role or lets it go, at once, as the core's does with no other member to ask. */
  private share(key: number, on: boolean): void {
    this.setSession({ roles: this.session().roles.map((role) => (role.key === key ? { ...role, holder: on ? ME : null } : role)) })
  }

  /** Join runs for a moment, then says it set the flight up; the "Join now" answer also puts this pilot in the flight, which hides Join. */
  private join(now: boolean): void {
    const goTo = this.slices[GO_TO] as Joining
    if (goTo.join.as !== "ready" || !goTo.spot) return
    const spot = goTo.spot
    this.set({ [GO_TO]: { ...goTo, join: { as: "running" } } })
    window.clearTimeout(this.answer)
    this.answer = window.setTimeout(() => {
      const said = { n: (goTo.said?.n ?? 0) + 1, now, spot, aircraft: inFlight.title ?? "", outcome: { as: "set-up", no_stand: false } }
      this.set({ [GO_TO]: { ...goTo, join: now ? { as: "hidden" } : { as: "ready" }, said } })
      if (now) this.setSession({ members: this.session().members.map((one) => (one.pilot === ME ? { ...one, status: inFlight, in_flight: true } : one)) })
    }, AFTER.answer)
  }

  private setSetting(key: string, value: JsonValue): void {
    const now = this.slices.settings as Setting[]
    const known = now.some((one) => one.key === key)
    this.set({ settings: known ? now.map((one) => (one.key === key ? { ...one, value } : one)) : [...now, { ...setting(key, false), value }] })
  }

  private cancelAttempt(): void {
    window.clearTimeout(this.answer)
    this.setSession({ attempt: null })
  }

  private attempt(on: "host" | "join", code: string | null): void {
    const refusing = this.refusing
    this.setSession({ refused: null, attempt: { on, dialing: false, code } })
    window.clearTimeout(this.answer)
    if (refusing === "slow") {
      if (on === "join") this.answer = window.setTimeout(() => this.setSession({ attempt: { on, dialing: true, code } }), AFTER.answer)
      return
    }
    this.answer = window.setTimeout(() => {
      if (refusing) {
        const why = on === "host" && refusing === "no-code" ? "servers" : refusing
        this.setSession({ attempt: null, refused: { on, why: why as RefusedWhy } })
        return
      }
      const members = on === "host" ? [me(atMenu)] : [me(atMenu), james(inFlight)]
      this.set({ session: held({ members, pf: on === "host" ? ME : JAMES }) })
    }, AFTER.answer)
  }
  private setReady(on: boolean): void {
    const session = this.session()
    const members = session.members.map((one) => (one.pilot === ME ? { ...one, ready: on } : one))
    this.set({ session: { ...session, members, preflight: { ...session.preflight, phase: "running" } } })
    this.checkCountdown()
  }

  private goWithout(pilot: string): void {
    const session = this.session()
    this.set({ session: { ...session, members: session.members.map((one) => (one.pilot === ME ? { ...one, without: [...one.without, pilot] } : one)) } })
    this.checkCountdown()
  }

  /** Once every counted pilot is ready, the countdown runs, and un-readying stops it. */
  private checkCountdown(): void {
    window.clearTimeout(this.countdown)
    const session = this.session()
    const mine = session.members.find((one) => one.pilot === ME)
    const everyone = session.members.every((one) => one.ready || mine?.without.includes(one.pilot))
    if (!everyone) return
    this.set({ session: { ...session, preflight: { ...session.preflight, phase: "countdown" } } })
    this.countdown = window.setTimeout(() => {
      const now = this.session()
      this.set({ session: { ...now, ready: null, preflight: { ...now.preflight, phase: "ended" } } })
    }, COUNTDOWN * 1000)
  }

  /** The desktop app's side of the stand-in: the fixed local port, which holds what a scene says, and answers what the EFB app asks. */
  desktopEnv(): DesktopEnv {
    return {
      every: (ms, then) => void window.setInterval(then, ms),
      connect: () => {
        const socket: Socket = {
          onopen: null,
          onmessage: null,
          onclose: null,
          send: (text) => this.askDesktop(JSON.parse(text) as ToDesktop),
          close: () => {},
        }
        this.desktopSocket = socket
        window.setTimeout(() => {
          if (this.local) socket.onopen?.()
          this.tellDesktop()
        }, 0)
        return socket
      },
    }
  }

  private tellDesktop(): void {
    if (this.local) this.desktopSocket?.onmessage?.(JSON.stringify(this.local))
  }

  private setLocal(changes: Partial<DesktopState>): void {
    if (!this.local) return
    this.local = { ...this.local, ...changes }
    this.tellDesktop()
  }

  private askDesktop(what: ToDesktop): void {
    if (what.t === "set-start-with-windows") this.setLocal({ start_with_windows: what.on ? "on" : "off" })
    else if (what.t === "fix-firewall") window.setTimeout(() => this.setLocal({ firewall: "allows" }), 1400)
    else if (what.t === "check-for-updates") this.checkForUpdate()
  }

  /** Check now: checking, then downloading the update, then ready. */
  private checkForUpdate(): void {
    this.setLocal({ update: { state: "checking" } })
    window.setTimeout(() => {
      for (let step = 0; step <= 20; step++) window.setTimeout(() => this.setLocal({ update: { state: "downloading", next: "1.0.3", done: step * 5 } }), step * 120)
      window.setTimeout(() => this.setLocal({ update: { state: "ready", next: "1.0.3" } }), 21 * 120 + 300)
    }, 1500)
  }
}
