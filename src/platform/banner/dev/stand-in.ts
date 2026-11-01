// The banner's scenes on the stand-in core: every notification as the design words it, the summary in each of its
// forms, and plays of cards coming and going. The names, the key, and the controls are examples.

import { COUNTDOWN } from "@dualinput/crew"

import { StandInBase } from "../../../engines/page-client/dev/stand-in-base.ts"
import type { Slices } from "../../../engines/page-client/dev/stand-in-base.ts"
import type { JsonValue } from "../../../engines/messages/ts/serde_json/JsonValue.ts"
import type { SessionSlice } from "../../../engines/messages/ts/session/SessionSlice.ts"
import type { SliceMember } from "../../../engines/messages/ts/session/SliceMember.ts"
import type { Status } from "../../../engines/messages/ts/session/Status.ts"
import type { Note } from "../src/note.ts"

const pilotId = (seed: number) => Array.from({ length: 32 }, (_, at) => ((seed * 7 + at * at * 13 + seed * at) % 16).toString(16)).join("")
const ME = pilotId(1)
const JAMES = pilotId(2)
const ADAM = pilotId(3)

const inFlight: Status = { stage: "ready-to-fly", aircraft: { path: "baron58p/presets/blacksquare/baron58p" }, title: "Baron 58P", pause: 0, ended: null, links: [] }
const member = (pilot: string, name: string, rest: Partial<SliceMember> = {}): SliceMember => ({ pilot, name, status: inFlight, in_flight: true, ready: false, without: [], ...rest })

const flying: SessionSlice = { held: true, code: "K7R4XM", me: ME, pf: JAMES, members: [member(ME, "You"), member(JAMES, "James")], preflight: { aircraft: inFlight.aircraft, phase: "ended" }, differences: [], ready: null, share: [], roles: [], attempt: null, refused: null }
const preflight = (rest: Partial<SessionSlice>): SessionSlice => ({ ...flying, preflight: { aircraft: inFlight.aircraft, phase: "running" }, ready: [], ...rest })
const THREE_DIFFERENCES = [
  { item: 1, level: "error" as const, words: "James has version 2.1.2 of the aircraft, you have 2.1.3" },
  { item: 2, level: "warning" as const, words: "Different liveries" },
  { item: 3, level: "warning" as const, words: "James's sim is 4 hours ahead of yours" },
]

/** Each notification, by its name in the design. A one-time note has `once`. */
const N = {
  controlYou: { id: "take-control.you", level: "information", once: true, pilot: ME, text: "You have control" },
  controlThem: { id: "take-control.them", level: "information", once: true, pilot: JAMES, text: "James has control" },
  controlLeft: { id: "take-control.left", level: "information", once: true, pilot: ME, text: "You have control", detail: "James left the flight." },
  refused: { id: "take-control.refused", level: "warning", once: true, text: "Couldn't take control", detail: "You're catching up with James." },
  lostPf: { id: "take-control.lost-pf", level: "warning", text: "Reconnecting to James", detail: "James may still be flying. If you take control, their aircraft will jump to yours when they reconnect." },
  takenWhileAway: { id: "take-control.taken", level: "warning", once: true, text: "Adam took control while you were disconnected", detail: "What you changed in that time was undone, and your pages and FMS entries may differ from Adam's." },
  catchingUp: { id: "cockpit-stream.catch", level: "information", busy: true, text: "Catching up with James", detail: "Anything you move in the cockpit now will be reset." },
  caughtUp: { id: "cockpit-stream.catch", level: "information", once: true, text: "Caught up with James", detail: "Pages and FMS entries may still differ from James's." },
  pause: { id: "rate-and-pause.pause", level: "information", pilot: JAMES, text: "James has paused" },
  left: { id: "session.adam-left", level: "information", once: true, pilot: ADAM, out: true, text: "Adam left the flight", detail: "They're still in the session." },
  closed: { id: "session.adam-closed", level: "information", once: true, pilot: ADAM, out: true, text: "Adam closed their sim", detail: "They're still in the session." },
  crashed: { id: "session.adam-crashed", level: "warning", once: true, pilot: ADAM, out: true, text: "Adam's sim crashed", detail: "They're still in the session." },
  leftSession: { id: "session.adam-left-session", level: "information", once: true, pilot: ADAM, out: true, text: "Adam left the session" },
  back: { id: "session.adam-back", level: "information", once: true, pilot: ADAM, text: "Adam is back in the flight" },
  syncOne: { id: "state-sync.beacon", level: "warning", once: true, text: "Couldn't sync Beacon", detail: "Yours may differ from James's." },
  syncSeveral: { id: "state-sync.several", level: "warning", once: true, text: "Couldn't sync 3 controls", detail: "Yours may differ from James's:", list: ["Beacon", "Taxi light", "Fuel pump 2"] },
  bridge: { id: "clients.no-panel", level: "trouble", landing: "header", text: "Dual Input's panel bridge didn't load", detail: "Features that run in the cockpit's panels are off. Another add-on's VCockpit.js is the likeliest cause." },
  module: { id: "sim-service.stopped", level: "trouble", landing: "header", text: "Dual Input's module stopped in the sim", detail: "Restart the sim to bring it back." },
  helper: { id: "core-helper.down", level: "trouble", landing: "header", text: "Dual Input's Windows helper stopped", detail: "Your binds and the output device are off." },
  seat: { id: "avatars.seat", level: "information", landing: "figures", pilot: JAMES, text: "This seat is taken" },
} satisfies Record<string, Note>

type Script = { after: number; notes: Note[] }[]

/** Each state a person looks at, by name: its slices, and a play of what comes next. */
export const SCENES: Record<string, { slices: Slices; play?: Script }> = {
  Nothing: { slices: { session: flying, notifications: [] } },
  "Summary: pilot flying": { slices: { session: preflight({ pf: ME, members: [member(ME, "You"), member(ADAM, "Adam", { ready: true })], differences: THREE_DIFFERENCES }), notifications: [] } },
  "Summary: not pilot flying": { slices: { session: preflight({ members: [member(ME, "You"), member(JAMES, "James", { ready: true })], differences: [THREE_DIFFERENCES[2]!] }), notifications: [] } },
  "Summary: settling": { slices: { session: preflight({ ready: ["Ready opens once your aircraft has settled, about 30s after Ready to fly"] }), notifications: [] } },
  "Summary: a crewmate out": { slices: { session: preflight({ pf: ME, members: [member(ME, "You"), member(ADAM, "Adam")], differences: THREE_DIFFERENCES }), network: { members: [{ pilot: ADAM, up: false, path: null, round_trip_ms: null }], internet: true, servers: "reachable" }, notifications: [] } },
  "Summary and three notes": { slices: { session: preflight({ pf: ME, members: [member(ME, "You"), member(ADAM, "Adam", { ready: true })], differences: THREE_DIFFERENCES }), notifications: [N.pause, N.syncOne, N.controlThem] } },
  "Each kind": { slices: { session: flying, notifications: [N.controlYou, N.lostPf, N.pause] } },
  Crewmates: { slices: { session: flying, notifications: [N.left, N.crashed, N.back] } },
  "Long words": { slices: { session: flying, notifications: [N.takenWhileAway, N.lostPf] } },
  "Several controls": { slices: { session: flying, notifications: [N.syncSeveral] } },
  "Too many held": { slices: { session: flying, notifications: [N.bridge, N.module, N.helper, N.seat, N.pause, N.lostPf] } },
  "Arrivals, played": {
    slices: { session: flying, notifications: [] },
    play: [
      { after: 500, notes: [N.pause] },
      { after: 1700, notes: [N.pause, N.controlYou] },
      { after: 2900, notes: [N.pause, N.controlYou, N.syncOne] },
    ],
  },
  "Catching up, played": {
    slices: { session: flying, notifications: [] },
    play: [
      { after: 500, notes: [N.catchingUp] },
      { after: 3500, notes: [N.caughtUp] },
    ],
  },
}

export class StandInCore extends StandInBase {
  private timers: number[] = []
  /** The last click a card sent, for a person checking one. */
  lastClick: unknown = null
  sceneName = "Nothing"

  protected greeted(): void {
    if (!this.slices.session) this.scene(this.sceneName)
  }

  scene(name: string): void {
    this.timers.forEach((timer) => window.clearTimeout(timer))
    this.sceneName = name
    const scene = SCENES[name]!
    this.set({ network: { members: [], internet: true, servers: "reachable" }, ...scene.slices })
    this.timers = (scene.play ?? []).map((step) => window.setTimeout(() => this.set({ notifications: step.notes }), step.after))
  }

  clicked(what: unknown): void {
    this.lastClick = what
    console.log(`stand-in: ${JSON.stringify(what)}`)
  }

  protected command(name: string, args: JsonValue): void {
    if (name === "clients.notification-clicked") this.clicked(args)
    if (name === "session.ready") this.setReady(!!(args as { on?: boolean }).on)
  }

  private setReady(on: boolean): void {
    const session = this.slices.session as SessionSlice
    const members = session.members.map((one) => (one.pilot === ME ? { ...one, ready: on } : one))
    const everyone = members.every((one) => one.ready)
    this.set({ session: { ...session, members, preflight: { ...session.preflight, phase: everyone ? "countdown" : "running" } } })
    this.timers.forEach((timer) => window.clearTimeout(timer))
    if (everyone) {
      this.timers = [
        window.setTimeout(() => {
          const now = this.slices.session as SessionSlice
          this.set({ session: { ...now, ready: null, preflight: { ...now.preflight, phase: "ended" } } })
        }, COUNTDOWN * 1000),
      ]
    }
  }
}
