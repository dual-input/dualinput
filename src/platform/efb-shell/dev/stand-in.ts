// The EFB app's scenes on the stand-in core: each state a person looks at, and the commands a pilot presses walking
// from it as the core would.

import { COUNTDOWN } from "@dualinput/crew"

import { StandInBase } from "../../../engines/page-client/dev/stand-in-base.ts"
import type { Slices } from "../../../engines/page-client/dev/stand-in-base.ts"
import type { CoreSlice } from "../../../engines/messages/ts/clients/CoreSlice.ts"
import type { Setting } from "../../../engines/messages/ts/clients/Setting.ts"
import type { ProfilesSlice } from "../../../engines/messages/ts/profiles/ProfilesSlice.ts"
import type { Difference } from "../../../engines/messages/ts/session/Difference.ts"
import type { RefusedWhy } from "../../../engines/messages/ts/session/RefusedWhy.ts"
import type { NamedAircraft } from "../../../engines/messages/ts/sim/NamedAircraft.ts"
import type { SimSlice } from "../../../engines/messages/ts/sim/SimSlice.ts"
import type { SessionSlice } from "../../../engines/messages/ts/session/SessionSlice.ts"
import type { JsonValue } from "../../../engines/messages/ts/serde_json/JsonValue.ts"
import type { SliceMember } from "../../../engines/messages/ts/session/SliceMember.ts"
import type { Status } from "../../../engines/messages/ts/session/Status.ts"
import type { DesktopState } from "../../../engines/messages/ts/desktop/DesktopState.ts"
import type { ToDesktop } from "../../../engines/messages/ts/desktop/ToDesktop.ts"
import { VERSION } from "../../../engines/messages/ts/stamp.ts"
import type { Socket } from "../../../engines/page-client/src/page-client.ts"
import type { DesktopEnv } from "../src/desktop-link.ts"
import { GUIDE_DONE, OUTPUT, SETUP_DONE } from "../src/settings/setting.ts"

/** A made-up pilot ID, 32 hex digits, which picks the color of their figure. */
const pilotId = (seed: number) => Array.from({ length: 32 }, (_, at) => ((seed * 7 + at * at * 13 + seed * at) % 16).toString(16)).join("")
const ME = pilotId(1)
const JAMES = pilotId(2)

const inFlight: Status = { stage: "ready-to-fly", aircraft: { path: "baron58p/presets/blacksquare/baron58p" }, title: "Baron 58P", pause: 0, ended: null, links: [] }
const atMenu: Status = { stage: "menu", aircraft: null, title: null, pause: 0, ended: null, links: [] }

const member = (pilot: string, name: string, status: Status, rest: Partial<SliceMember> = {}): SliceMember => ({ pilot, name, status, in_flight: status === inFlight, ready: false, without: [], ...rest })
const me = (status: Status, rest: Partial<SliceMember> = {}) => member(ME, "You", status, rest)
const james = (status: Status, rest: Partial<SliceMember> = {}) => member(JAMES, "James", status, rest)
const extra = (name: string, seed: number, rest: Partial<SliceMember> = {}) => member(pilotId(seed), name, inFlight, { ready: true, ...rest })

const CODE = "K7R4XM"
const DIFFERENCES: Difference[] = [
  { item: 1, level: "error", words: "James has version 2.1.2 of the aircraft, you have 2.1.3", note: "Some controls may not sync" },
  { item: 2, level: "warning", words: "Different liveries may alter the aircraft's configuration and cause sync issues" },
  { item: 3, level: "warning", words: "James's sim is 4 hours ahead of yours" },
]

const noSession: SessionSlice = { held: false, code: null, me: ME, pf: null, members: [], preflight: { aircraft: null, phase: "no-aircraft" }, differences: [], ready: null, share: null, roles: [], attempt: null, refused: null }
const held = (rest: Partial<SessionSlice>): SessionSlice => ({ ...noSession, held: true, code: CODE, pf: ME, ready: [], share: [], ...rest })
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
const NO_PROFILE: ProfilesSlice = { loaded: null, supported: SUPPORTED }
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
  programs: [],
  in_use: { id: "usb", name: "Headset (USB Audio)" },
}

const reach = { internet: true, servers: "reachable" as const }
const healthy = { network: { members: [], ...reach }, sim: atWorldMap, profiles: { loaded: { maturity: "Stable" }, supported: SUPPORTED }, session: noSession, settings: settings(true, true) }

/** The up link to James the session's scenes share, over a relay at 120ms. */
const netUp = { network: { members: [{ pilot: JAMES, up: true, path: { Relay: { url: "https://relay.example" } }, round_trip_ms: 120 }], ...reach } }
const DESKTOP = "desktop"
const LOCAL: DesktopState = { update: { state: "current", checked: "4 minutes ago" }, firewall: "allows", start_with_windows: true }

/** What a scene has the answer to Host or Join be, which is no slice of the core's. */
const REFUSING = "refusing"
/** What a scene puts on the clipboard, which is no slice of the core's either. */
const CLIPBOARD = "clipboard"

/** Each state a person looks at, by name, with what it sets on top of the sim's healthy slices. */
export const SCENES: Record<string, Slices> = {
  "First-time setup": firstRun,
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
  Flying: { ...netUp, session: held({ members: [me(inFlight), james(inFlight)], preflight: { aircraft: inFlight.aircraft, phase: "ended" }, differences: DIFFERENCES, ready: null }) },
  "Header: offline": { network: { members: [], internet: false, servers: null } },
  "Header: several things": { network: { members: [], internet: true, servers: "unreachable" }, [DESKTOP]: { ...LOCAL, firewall: "blocks", update: { state: "ready", next: "1.0.3" } } },
  "Header: our own parts": {
    session: held({ members: [me(inFlight), james(inFlight)], preflight: { aircraft: inFlight.aircraft, phase: "ended" }, ready: null }),
    network: { members: [], internet: true, servers: "unreachable" },
    notifications: [
      { id: "sim-service.module-stopped", level: "trouble", text: "Dual Input's WASM module stopped", detail: "Restart the sim to fly together again.", landing: "header" },
      { id: "clients.no-panel", level: "trouble", text: "Cockpit screens aren't syncing", detail: "Dual Input couldn't load into the cockpit's panels. Another add-on that replaces VCockpit.js is the likeliest cause.", landing: "header" },
      { id: "core-helper.down", level: "trouble", text: "Dual Input's Windows helper is down", detail: "Keybinds, audio, and your figure's pointing won't work until it's back.", landing: "header" },
      { id: "network.bind", level: "trouble", text: "Dual Input can't open its connection to other pilots", detail: "Your crew can't reach you until it opens.", landing: "header" },
      { id: "core-helper.failed.binding-1", level: "warning", text: "Your take-control key isn't working", detail: "Windows didn't let Dual Input listen for F9.", landing: "header" },
    ],
    [DESKTOP]: { ...LOCAL, firewall: "blocks" },
  },
  "Recording stopped": { recording: { runs: RUNS, stopped: "no-space" } },
  "Output device missing": { settings: [...settings(true, true), { ...setting(OUTPUT, false), kind: { type: "device" }, value: { id: "old", name: "Studio Headphones" } }] },
  "Update ready": { [DESKTOP]: { ...LOCAL, update: { state: "ready", next: "1.0.3" } } },
  "No tray app": { [DESKTOP]: null },
  "Another version": { core: { ...CORE, version: "0.0.9" } },
}
const AFTER = { answer: 1000, slowAnswer: 10_000 }


/** The stand-in. `scene` jumps to a state, and the commands a pilot presses walk from it as the core would. */
export class StandInCore extends StandInBase {
  private countdown = 0
  private answer = 0
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
    window.setTimeout(() => this.set({ ...healthy, recording: { runs: RUNS, stopped: null }, "core-helper": { ...OUTPUTS, outputs: [] }, notifications: [], core: CORE, ...scene }), 0)
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
    if (what.t === "set-start-with-windows") this.setLocal({ start_with_windows: what.on })
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
