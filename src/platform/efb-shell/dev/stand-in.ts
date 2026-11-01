// A stand-in for the core inside the page, so the app runs with no core and no sim: it speaks page-client's
// protocol over a socket of its own, holds the slices a scene sets, and answers commands as the core would. The
// real core's behavior is the bench's to test; this only puts the screens in each state a person needs to look at.

import type { Env, Socket } from "../../../engines/page-client/src/page-client.ts"
import type { ConnectionState } from "../../../engines/page-client/src/page-client.ts"
import type { Difference } from "../../../engines/messages/ts/session/Difference.ts"
import type { FromClient } from "../../../engines/messages/ts/clients/FromClient.ts"
import type { SessionSlice } from "../../../engines/messages/ts/session/SessionSlice.ts"
import type { JsonValue } from "../../../engines/messages/ts/serde_json/JsonValue.ts"
import type { SliceMember } from "../../../engines/messages/ts/session/SliceMember.ts"
import type { Status } from "../../../engines/messages/ts/session/Status.ts"
import type { Wanted } from "../src/wanted.ts"
import { COUNTDOWN } from "../src/session/ready.tsx"

/** A made-up pilot ID, 32 hex digits, which picks the color of their figure. */
const pilotId = (seed: number) => Array.from({ length: 32 }, (_, at) => ((seed * 7 + at * at * 13 + seed * at) % 16).toString(16)).join("")
const ME = pilotId(1)
const JAMES = pilotId(2)
const PORT = 1

const inFlight: Status = { stage: "ready-to-fly", aircraft: { path: "baron58p/presets/blacksquare/baron58p" }, title: "Baron 58P", pause: 0, ended: null, links: [] }
const atMenu: Status = { stage: "menu", aircraft: null, title: null, pause: 0, ended: null, links: [] }

const member = (pilot: string, name: string, status: Status, rest: Partial<SliceMember> = {}): SliceMember => ({ pilot, name, status, in_flight: status === inFlight, ready: false, without: [], ...rest })
const me = (status: Status, rest: Partial<SliceMember> = {}) => member(ME, "You", status, rest)
const james = (status: Status, rest: Partial<SliceMember> = {}) => member(JAMES, "James", status, rest)
const extra = (name: string, seed: number, rest: Partial<SliceMember> = {}) => member(pilotId(seed), name, inFlight, { ready: true, ...rest })

const CODE = "K7R4XM"
const DIFFERENCES: Difference[] = [
  { item: 1, level: "error", words: "James has version 2.1.2 of the aircraft, you have 2.1.3" },
  { item: 2, level: "warning", words: "Different liveries may alter the aircraft's configuration and cause sync issues" },
  { item: 3, level: "warning", words: "James's sim is 4 hours ahead of yours" },
]

const noSession: SessionSlice = { held: false, code: null, me: ME, pf: null, members: [], preflight: { aircraft: null, phase: "no-aircraft" }, differences: [], ready: null, share: null, roles: [] }
const held = (rest: Partial<SessionSlice>): SessionSlice => ({ ...noSession, held: true, code: CODE, pf: ME, ready: [], share: [], ...rest })
const running = { aircraft: inFlight.aircraft, phase: "running" as const }

const AIRCRAFT: Wanted["aircraft"] = { maker: "Black Square", model: "Baron 58P", tail: "N58BS", maturity: "Stable" }
const UNSUPPORTED: Wanted["aircraft"] = { maker: "Fenix", model: "A320", tail: "G-FNXA", maturity: null }
const SUPPORTED: Wanted["supported"] = [
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
const SETUP = { username: "jordan" }
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

const healthy = { network: { members: [], internet: true }, sim: { stage: "menu", page: "main", aircraft: null, pause: 0, ended: null, module: "running" } }

/** The up link to James the session's scenes share, over a relay at 120ms. */
const netUp = { network: { members: [{ pilot: JAMES, up: true, path: { Relay: { url: "https://relay.example" } } }], internet: true } }
const ROUND_TRIPS = { [JAMES]: 120 }
const NOTES = { 1: "Some controls may not sync", 2: undefined, 3: undefined } as unknown as Record<number, string>

type Slices = Record<string, unknown>

/** Each state a person looks at, by name, with what it sets on top of the sim's healthy slices. */
export const SCENES: Record<string, Slices> = {
  "First-time setup": { session: noSession, wanted: { setup: SETUP, aircraft: AIRCRAFT } },
  "Setup: add-on mismatch": { session: noSession, wanted: { setup: { ...SETUP, failure: "addon", addonVersion: "0.0.9" }, aircraft: AIRCRAFT } },
  "Setup: offline": { session: noSession, wanted: { setup: { ...SETUP, failure: "offline" }, aircraft: AIRCRAFT } },
  "Setup: our servers": { session: noSession, wanted: { setup: { ...SETUP, failure: "servers" }, aircraft: AIRCRAFT } },
  "Setup: firewall": { session: noSession, wanted: { setup: { ...SETUP, failure: "firewall" }, aircraft: AIRCRAFT } },
  "First visit": { session: noSession, wanted: { firstVisit: true, aircraft: AIRCRAFT, supported: SUPPORTED } },
  "First visit, no profile": { session: noSession, wanted: { firstVisit: true, aircraft: UNSUPPORTED, supported: SUPPORTED } },
  "Before a session": { session: noSession, wanted: { aircraft: AIRCRAFT, supported: SUPPORTED } },
  "No profile for the aircraft": { session: noSession, wanted: { aircraft: UNSUPPORTED, supported: SUPPORTED } },
  "No profile, in a flight": { session: noSession, wanted: { aircraft: UNSUPPORTED, supported: SUPPORTED, where: "flight" } },
  "Servers refuse": { session: noSession, wanted: { aircraft: AIRCRAFT, refusing: "servers" } },
  "No session has the code": { session: noSession, wanted: { aircraft: AIRCRAFT, refusing: "no-code" } },
  "Too slow to answer": { session: noSession, wanted: { aircraft: AIRCRAFT, refusing: "slow" } },
  "Alone in a session": { session: held({ members: [me(atMenu)] }) },
  "James joins": { session: held({ members: [me(atMenu), james({ ...atMenu, stage: "loading" })] }) },
  Preflight: { ...netUp, session: held({ members: [me(inFlight), james(inFlight, { ready: true })], preflight: running, differences: DIFFERENCES }), wanted: { roundTrips: ROUND_TRIPS, notes: NOTES } },
  "Preflight, aircraft settling": { ...netUp, session: held({ members: [me(inFlight), james(inFlight)], preflight: running, differences: DIFFERENCES, ready: ["Ready opens once your aircraft has settled, about 30s after Ready to fly"] }), wanted: { roundTrips: ROUND_TRIPS, notes: NOTES } },
  "Preflight, James dropped": {
    network: { members: [{ pilot: JAMES, up: false, path: null }], internet: true },
    session: held({ members: [me(inFlight, { ready: true }), james(inFlight)], preflight: running, differences: DIFFERENCES }),
    wanted: { notes: NOTES },
  },
  "Preflight, big crew": {
    ...netUp,
    session: held({
      members: [me(inFlight), james(inFlight, { ready: true }), extra("Adam", 3), extra("Mia", 4, { ready: false }), extra("Lena", 5), extra("Omar", 6, { ready: false }), extra("Priya", 7), extra("Theo", 8), extra("Sven", 9, { ready: false }), extra("Rosa", 10)],
      preflight: running,
      differences: DIFFERENCES,
    }),
    wanted: { roundTrips: ROUND_TRIPS, notes: NOTES },
  },
  Flying: { ...netUp, session: held({ members: [me(inFlight), james(inFlight)], preflight: { aircraft: inFlight.aircraft, phase: "ended" }, differences: DIFFERENCES, ready: null }), wanted: { roundTrips: ROUND_TRIPS, notes: NOTES } },
  "Header: offline": { session: noSession, network: { members: [], internet: false }, wanted: { aircraft: AIRCRAFT } },
  "Header: several things": { session: noSession, wanted: { aircraft: AIRCRAFT, servers: "unreachable", firewall: "blocks", update: { state: "ready", next: "1.0.3" } } },
  "Update ready": { session: noSession, wanted: { aircraft: AIRCRAFT, update: { state: "ready", next: "1.0.3" } } },
}

const AFTER = { answer: 1000, slowAnswer: 10_000 }

/** The stand-in. `scene` jumps to a state, and the commands a pilot presses walk from it as the core would. */
export class StandInCore {
  private socket: Socket | null = null
  private watched = new Set<string>()
  private slices: Slices = {}
  private hear: ((text: string) => void) | null = null
  private countdown = 0
  private answer = 0
  /** How the socket closes, for the screens without the service. */
  private connectionState: ConnectionState = "connected"
  sceneName = "Before a session"

  env(): Env {
    return {
      connect: () => {
        const socket: Socket = {
          onopen: null,
          onmessage: null,
          onclose: null,
          send: (text) => this.receive(text),
          close: () => {
            if (this.socket === socket) this.socket = null
          },
        }
        this.socket = socket
        window.setTimeout(() => socket.onopen?.(), 0)
        return socket
      },
      every: (ms, then) => void window.setInterval(then, ms),
      now: () => Date.now(),
      listen: (hear) => {
        this.hear = hear
        this.announce()
      },
      log: (message) => console.log(`stand-in: ${message}`),
    }
  }

  private announce(): void {
    this.hear?.(JSON.stringify({ port: PORT, session: false }))
  }

  private send(message: unknown): void {
    this.socket?.onmessage?.(JSON.stringify(message))
  }

  private publish(name: string): void {
    if (this.watched.has(name) && this.slices[name] !== undefined) this.send({ t: "state", slice: name, value: this.slices[name] })
  }

  private set(changes: Slices): void {
    this.slices = { ...this.slices, ...changes }
    Object.keys(changes).forEach((name) => this.publish(name))
  }

  private session(): SessionSlice {
    return this.slices.session as SessionSlice
  }

  private wanted(): Wanted & { refusing?: string } {
    return (this.slices.wanted ?? {}) as Wanted & { refusing?: string }
  }

  /** Jumps to a scene: the sim's healthy slices with what it sets on top. */
  scene(name: string): void {
    window.clearTimeout(this.countdown)
    window.clearTimeout(this.answer)
    this.sceneName = name
    this.set({ ...healthy, recording: { runs: RUNS }, "core-helper": OUTPUTS, notifications: [], wanted: {}, ...SCENES[name] })
  }

  /** The socket closing without a `bye`, or with one, or the core coming back. */
  connection(state: "reconnecting" | "closed" | "not-running" | "back"): void {
    if (state === "back") {
      this.connectionState = "connected"
      this.announce()
      return
    }
    if (state === "closed") this.send({ t: "bye" })
    const socket = this.socket
    this.socket = null
    if (state !== "closed") socket?.onclose?.()
    this.connectionState = "closed"
  }

  private receive(text: string): void {
    const message = JSON.parse(text) as FromClient
    if (message.t === "alive") {
      // Each side sends something every 2s, and the page counts 8s of silence as a core that hung.
      this.send({ t: "alive" })
    } else if (message.t === "watch") {
      message.slices.forEach((name) => {
        this.watched.add(name)
        this.publish(name)
      })
    } else if (message.t === "hello") {
      if (!this.slices.session) this.scene(this.sceneName)
    } else if (message.t === "command") {
      this.command(message.name, message.args)
      this.send({ t: "answer", id: message.id })
    }
  }

  private command(name: string, args: JsonValue): void {
    const fields = (args ?? {}) as Record<string, unknown>
    if (name === "session.host" || name === "session.join") this.attempt(name === "session.host" ? "host" : "join")
    else if (name === "session.leave") this.set({ session: noSession, wanted: { aircraft: AIRCRAFT } })
    else if (name === "session.ready") this.setReady(!!fields.on)
    else if (name === "session.go-without") this.goWithout(String(fields.member))
    else if (name === "update.check") this.checkForUpdate()
    else if (name === "setup.done") this.set({ wanted: { ...this.wanted(), setup: null, color: String(fields.color) } })
    else if (name === "guide.done") this.set({ wanted: { ...this.wanted(), firstVisit: false } })
  }

  private attempt(on: "host" | "join"): void {
    const refusing = this.wanted().refusing
    this.set({ wanted: { ...this.wanted(), refused: null, attempt: { on, dialing: false } } })
    window.clearTimeout(this.answer)
    if (refusing === "slow") {
      if (on === "join") this.answer = window.setTimeout(() => this.set({ wanted: { ...this.wanted(), attempt: { on, dialing: true } } }), AFTER.answer)
      return
    }
    this.answer = window.setTimeout(() => {
      if (refusing) {
        const why = on === "host" && refusing === "no-code" ? "servers" : refusing
        this.set({ wanted: { ...this.wanted(), attempt: null, refused: { on, why: why as "servers" } } })
        return
      }
      const members = on === "host" ? [me(atMenu)] : [me(atMenu), james(inFlight)]
      this.set({ session: held({ members, pf: on === "host" ? ME : JAMES }), wanted: { ...this.wanted(), attempt: null } })
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

  /** Check now: checking, then downloading the update, then ready. */
  private checkForUpdate(): void {
    const set = (update: Wanted["update"]) => this.set({ wanted: { ...this.wanted(), update } })
    set({ state: "checking", next: "1.0.3" })
    window.setTimeout(() => {
      for (let step = 0; step <= 20; step++) window.setTimeout(() => set({ state: "downloading", next: "1.0.3", done: step * 5 }), step * 120)
      window.setTimeout(() => set({ state: "ready", next: "1.0.3" }), 21 * 120 + 300)
    }, 1500)
  }
}
