// The EFB app's home page, designed from the user's sketch of 2026-10-26: the start card, then on a
// pilot's first visit a short guide to how a session works that ends on the aircraft check, and on
// later visits the profile authors' notes. The aircraft and the notes are examples.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ArrowRightLeft, BookOpen, Check, ChevronDown, ChevronUp, CircleCheck, CircleX, Copy, ExternalLink, Hand, Headset, Info, LogOut, Plane, RotateCcw, TriangleAlert, X } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { StatusChip } from "@/bench/screens"
import { AppFrame, InlineLink, Label, type Core, type HeaderStatus } from "./shell"
import { FIGURE_COLORS } from "./figure-portrait"
import { StandingFigure } from "./figure-standing"
import { ConfirmButton, RESTART_SIM } from "./confirm"
import { AircraftContext, AircraftPicker, LOADED, LOADED_UNSUPPORTED, PROFILES, type Aircraft } from "./aircraft"
import { NO_SCROLLBAR, useScroller } from "./scroller"
import { cueHeads, EmptyHead, Head } from "./figure-head"
import { useShowPhase, type SessionPhase } from "./phase"
import { useShowControl, useShowSession, type Control } from "./flight"


// How hosting and joining can be refused: either one when the PC seems offline, which Windows
// reports, with the words of the header's row and setup's check for it, and when our servers don't
// answer; and joining with the four refusals the backend's lookup gives
// (record/areas/network/02-units.md, Its requests). The words are drafts, and the versions and the
// time are examples: the count of wrong codes is per clock hour, so the pause ends on the next hour.
const REFUSALS = {
  offline: { title: "Your PC seems offline", detail: "Dual Input needs the internet to connect you and your crew. Check your connection and try again?" },
  servers: { title: "Couldn't reach our servers", detail: "Dual Input needs them to connect you and your crew. Try again in a moment." },
  "no-code": { title: "No session has this code", detail: "Check it with your host and try again." },
  "you-older": { title: "Your Dual Input is older than the host's", detail: "Your host has 1.0.3 while you have 1.0.2.", action: { label: "Restart the sim to update", ...RESTART_SIM } },
  "host-older": { title: "The host's Dual Input is older than yours", detail: "Your host has 1.0.1 while you have 1.0.2. They need to update before you can join." },
  "too-many": { title: "Too many wrong codes", detail: "You are being rate limited because you've tried too many wrong codes in an hour. Joining is paused until 15:00. If you think this is a mistake, please contact us on our Discord." },
}
type Refusal = keyof typeof REFUSALS
// When each refusal shows, for the sheet that lays them side by side.
const REFUSED_WHEN: Record<Refusal, string> = {
  offline: "Hosting or joining: the PC seems offline",
  servers: "Hosting or joining: our servers didn't answer",
  "no-code": "Joining: no session has the code",
  "you-older": "Joining: your version is older",
  "host-older": "Joining: the host's version is older",
  "too-many": "Joining: too many wrong codes",
}
export type Action = "host" | "join"
// A join is dialing once our servers have found its code and it's reaching the crew; slow, once
// the attempt has taken SLOW_AFTER.
type Status =
  | { kind: "idle" }
  | { kind: "busy"; on: Action; dialing?: boolean; slow?: boolean }
  | { kind: "done"; on: Action }
  | { kind: "refused"; on: Action; why: Refusal }

// A normal attempt is done well under 2s: one request to our servers, and for a join a connection,
// which opened in a median of 24ms to 159ms from friends' homes to ours (record/areas/network/
// 01-between-machines.md, The way through home routers). By 6s a joiner has redialed twice, so an
// attempt that long shows a line saying so, with Cancel, under the control that asked. Wi-Fi and
// carrier-grade NAT are unmeasured, so v1's recordings would tune it.
const SLOW_AFTER = 6000

// What the page's standing figure reacts to: an attempt to host or join, as a figure-attempt event,
// our servers' answer, as figure-answer with ok in its detail, and Cancel, as figure-cancel, all
// bubbling from the card. In the app any join announces itself, the clipboard's included. The bench
// fakes our servers: they answer after a moment, yes; or refusing, no, refusing a host as
// unreachable and a join as naming no session, the refusal that also marks the code's slots; or
// slow, answering a host only after SLOW_ANSWER_AFTER, and finding a join's code at once while the
// host it names never answers, as when their sim has crashed and the backend still lists them; or
// out of reach of a PC that's offline, which refuses either at once, since the request fails
// without leaving it, after a moment that lets the press show. The host's name is an example.
export type Servers = "answering" | "refusing" | "slow" | "offline"
const DEMO_CODE = "K7R4XM"
const DEMO_HOST = "James"
const ANSWER_AFTER = 1000
const SLOW_ANSWER_AFTER = 10000
const OFFLINE_ANSWER_AFTER = 300
// How long "Session started" holds before the card turns to the session, and how long a turn's
// height takes to ease, in milliseconds.
const SESSION_AFTER = 900
const HALF_EASE = 300

// The kit's solid red, for a button whose action is hard to take back.
const RED_BUTTON = "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/30"
// The kit's solid green, for a button pressed into a state that's good to be in.
const GREEN_BUTTON = "bg-success text-success-foreground hover:bg-success/90 focus-visible:border-success/40 focus-visible:ring-success/30"

// Where a crewmate is before preflight, as the session's keys tell every core
// (record/areas/session/02-units.md, Members and In the flight): their sim's stage, at the main menu
// which page, and in a flight its aircraft, which before the session has one, or in another, leaves
// them out of the flight; or their link lost, which Dual Input mends on its own, or their sim
// crashed, after which it rejoins them once they're back in a flight. It shows under their name,
// the two troubles in the warning color. The aircraft is an example.
type Whereabouts = "closed" | "starting" | "menu" | "world-map" | "loading" | "aircraft" | "catching-up" | "lost" | "crashed"
const WHERE: Record<Whereabouts, { when: string; shows: string; trouble?: boolean }> = {
  closed: { when: "Their sim isn't running", shows: "Sim not running" },
  starting: { when: "Their sim is starting", shows: "Starting the sim" },
  menu: { when: "At the sim's main menu", shows: "At the main menu" },
  "world-map": { when: "At Free flight's world map", shows: "At the world map" },
  loading: { when: "Loading a flight", shows: "Loading a flight" },
  aircraft: { when: "In a flight before the session has an aircraft, or in another one", shows: "In the A320" },
  // A late joiner's or a returning pilot's catch-up, during which control can't pass to them
  // (record/areas/sync/03-catch-up.md, While catch-up runs).
  "catching-up": { when: "In the flight, catching up, so control can't pass to them yet", shows: "Catching up" },
  lost: { when: "Their link is lost, and Dual Input is reconnecting them", shows: "Connection lost", trouble: true },
  crashed: { when: "Their sim crashed, and Dual Input rejoins them once they're back in a flight", shows: "Sim crashed", trouble: true },
}

// A session as a frame opens on it, or as Host or Join turns the card to it: whether this pilot
// joined it or hosts it, and who else is in it. The host starts as the pilot flying, so a joiner's
// host, James, is flying, and James's row gives the joiner the way there. A crew bigger than v1's two
// (record/areas/product/03-v1-scope.md) is a Later pick drawn now. The names, colors, and where
// each pilot is are examples.
// Once preflight runs, a pilot in the flight shows their link, its path and round trip, as the
// network's slice carries them, and whether they're ready.
// The traffic host and the ATC host each have a chip on their row, with their tab's icon, so who
// shares shows on the session page, though the switch lives on the traffic tab (user, 2026-10-31).
// They're two roles, each declared by its feature, which the one "Share my traffic and ATC" switch
// claims together (record/areas/session/01-roles-and-members.md, The traffic and ATC host), so one
// pilot holds both in v1.
type Pilot = { name: string; hue: string; at?: Whereabouts; flying?: boolean; way?: Way; link?: string; ready?: boolean; traffic?: boolean; atc?: boolean }
// A session can open with its flight already started: then whether this pilot's catch-up runs, the
// binding's name for the take-control strip, and a demo of taking control, which can hand control
// back to the pilot flying a while later.
type Flight = { catchingUp?: boolean; bound?: string; demo?: "hold" | "tap"; handsBack?: boolean }
type Session = { joined: boolean; crew: Pilot[]; preflight?: Preflight; traffic?: string; atc?: string; flight?: Flight }

// Preflight, from the moment the PF is in a flight on the ground, as every core follows the PF's
// `preflight` key (record/areas/session/02-units.md, Preflight and The match check;
// record/areas/product/03-v1-scope.md, Preflight and Preflight match check): whether this pilot's
// aircraft has settled after its load, which Ready waits for; whether this pilot starts ready; the
// match check's differences, each in its item's words from this pilot's side, with a note on what
// it can cause where that isn't plain; and for the PF, the checklist of the controls Dual Input counts, each by its profile entry's
// ID, `name`, and `default` (record/areas/sync/05-units.md, Ready, notifications, log lines, and the
// checklist), and a `description`, a field the profile format doesn't have yet.
type Difference = { level: "error" | "warning" | "info"; says: string; note?: string }
type ChecklistItem = { id: string; name: string; default: string; description?: string }
type Preflight = { settled: boolean; ready?: boolean; differences: Difference[]; checklist?: ChecklistItem[] }
// Every difference the match check can raise, from this pilot's side, with a crewmate, James
// (record/areas/session/02-units.md, The match check; record/areas/profiles/02-units.md, The match
// check's item): the aircraft's package and where it's installed, its version, the livery, the
// session's profile, and the sim's date and time of day. Nothing here stops the flight, so a note
// says what a difference can cause, and none gives advice or a command (user, 2026-10-30). A date
// names only the crewmate's, which is the one this pilot can't see in their own sim. The words are drafts, and the
// versions, stores, times, and dates are examples. A livery can set the aircraft's
// equipment and units, as a Fenix A320 livery's `fnx_*` keys set its baro unit, ADIRS type, and
// standby instrument (record/areas/aircraft/fenix-a320-family/study.md).
const SWITCHES_THERE = "James's switches, knobs, and displays won't sync"
const SWITCHES_HERE = "Your switches, knobs, and displays won't sync"
const HEADS_UP = {
  olderThere: { level: "error", says: "James has version 2.1.2 of the aircraft, you have 2.1.3" },
  olderHere: { level: "error", says: "You have version 2.1.2 of the aircraft, James has 2.1.3" },
  streamedThere: { level: "warning", says: "James's aircraft is streamed, and yours is installed", note: "The two copies may differ and some controls may not sync" },
  streamedHere: { level: "warning", says: "Your aircraft is streamed, and James's is installed", note: "The two copies may differ and some controls may not sync" },
  versionUnreadThere: { level: "warning", says: "James's aircraft is streamed, so its version can't be validated" },
  versionUnreadHere: { level: "warning", says: "Your aircraft is streamed, so its version can't be validated" },
  stores: { level: "warning", says: "James's aircraft is in Community, and yours is from the Marketplace", note: "The same version can differ between stores" },
  packages: { level: "warning", says: "Your aircraft and James's come from different packages" },
  livery: { level: "warning", says: "Different liveries may alter the aircraft's configuration and cause sync issues" },
  noProfile: { level: "error", says: "No profile for this aircraft", note: "The cockpits won't sync" },
  downloadThere: { level: "error", says: "James couldn't download this aircraft's profile", note: SWITCHES_THERE },
  downloadHere: { level: "error", says: "Your PC couldn't download this aircraft's profile", note: SWITCHES_HERE },
  unpublishedThere: { level: "error", says: "James doesn't have your unpublished profile for this aircraft", note: SWITCHES_THERE },
  unpublishedHere: { level: "error", says: "James's profile for this aircraft is unpublished, so you don't have it", note: SWITCHES_HERE },
  unpublished: { level: "info", says: "Unpublished profile" },
  aheadThere: { level: "warning", says: "James's sim is 4 hours ahead of yours" },
  aheadHere: { level: "warning", says: "Your sim is 4 hours ahead of James's" },
  date: { level: "warning", says: "James's sim is on 2 March" },
  versions: { level: "error", says: "James and Adam have version 2.1.2 of the aircraft, Mia has 2.1.1, you have 2.1.3" },
} satisfies Record<string, Difference>
// When each shows, for the frame of them all; a streamed copy against an installed one raises two.
const HEADS_UP_CASES: { when: string; items: Difference[] }[] = [
  { when: "James's version of the aircraft is older", items: [HEADS_UP.olderThere] },
  { when: "Yours is older", items: [HEADS_UP.olderHere] },
  { when: "Later: a crew of four on three versions", items: [HEADS_UP.versions] },
  { when: "James's aircraft is streamed, and yours installed", items: [HEADS_UP.streamedThere, HEADS_UP.versionUnreadThere] },
  { when: "Yours is streamed, and James's installed", items: [HEADS_UP.streamedHere, HEADS_UP.versionUnreadHere] },
  { when: "Installed from different stores", items: [HEADS_UP.stores] },
  { when: "From different packages", items: [HEADS_UP.packages] },
  { when: "Different liveries", items: [HEADS_UP.livery] },
  { when: "No profile covers the aircraft, for every pilot", items: [HEADS_UP.noProfile] },
  { when: "James couldn't download the session's profile", items: [HEADS_UP.downloadThere] },
  { when: "You couldn't", items: [HEADS_UP.downloadHere] },
  { when: "The session runs your unpublished profile, which James lacks", items: [HEADS_UP.unpublishedThere] },
  { when: "It runs James's, which you lack", items: [HEADS_UP.unpublishedHere] },
  { when: "Every pilot loaded the session's profile, which isn't published yet, shown once", items: [HEADS_UP.unpublished] },
  { when: "James's sim is more than 10 minutes ahead", items: [HEADS_UP.aheadThere] },
  { when: "Yours is", items: [HEADS_UP.aheadHere] },
  { when: "The sims are on different dates", items: [HEADS_UP.date] },
]
// The differences a version, a livery, and a time of day make, from each side.
const DIFFERENCES: Record<"host" | "joiner", Difference[]> = {
  host: [HEADS_UP.olderThere, HEADS_UP.livery, HEADS_UP.aheadThere],
  joiner: [HEADS_UP.olderHere, HEADS_UP.livery, HEADS_UP.aheadHere],
}
// The checklist's items are hypothetical. Every pilot's list holds the profile authors' items, for
// what Dual Input can't sync and each pilot sets by hand, here from the authors' notes' example;
// the PF's opens with the controls Dual Input counts, and whether the 58P's profile counts any is
// unknown until the profile is written (record/areas/product/03-v1-scope.md, Preflight). The last
// counted one's name is too long for its row, and its description runs past a line.
const EVERY_PILOT: ChecklistItem[] = [
  { id: "failure_rate", name: "Tablet failure rate", default: "0", description: "Each sim rolls its own failures, so every pilot sets this" },
  { id: "gps_flight_plan", name: "GPS flight plan", default: "Loaded", description: "The GPS's flight plan doesn't sync, so load the same one on every machine" },
]
const PF_CHECKLIST: ChecklistItem[] = [
  { id: "heading_bug", name: "Heading bug", default: "360" },
  { id: "course", name: "Course", default: "000", description: "The OBS knob, at the lower left of the HSI" },
  {
    id: "landing_elevation",
    name: "Cabin pressure controller landing field elevation",
    default: "1000",
    description: "The outer ring on the cabin pressure controller, on the right of the instrument panel, below the radios",
  },
  ...EVERY_PILOT,
]
const LINK = "Relay · 120ms"

const JAMES: Pilot = { name: DEMO_HOST, hue: "red" }
// The worst case, for Later, to compare the card with the usual one (user, 2026-10-30): a
// big crew, more than v1's two pilots, the most match check messages that can show at once, and a
// 20-item checklist, its extra items hypothetical. The messages are one from each group
// that can't show together: the version (an older one, or a streamed copy's two lines, whose
// version can't be read); the stores, only for two installed copies; the profile (none at all, or a
// download failing on either PC or both, or an unpublished one someone lacks, or one everyone has);
// and the time (hours ahead, or another date); with the packages and the livery, which go with any.
const BIG_CREW: Pilot[] = ["Adam", "Mia", "Lena", "Omar", "Priya", "Theo", "Sven", "Rosa", "Kai", "Noor", "Ivo", "Zoe"].map((name, i) => ({
  name,
  hue: ["green", "blue", "yellow", "purple", "teal", "pink", "red"][i % 7],
  link: LINK,
  ready: i % 3 !== 0,
}))
const MOST_DIFFERENCES: Difference[] = [
  HEADS_UP.olderThere,
  HEADS_UP.stores,
  HEADS_UP.packages,
  HEADS_UP.livery,
  HEADS_UP.downloadThere,
  HEADS_UP.downloadHere,
  HEADS_UP.aheadThere,
]
const LONG_CHECKLIST: ChecklistItem[] = [
  ...PF_CHECKLIST,
  { id: "altimeter", name: "Altimeter setting", default: "29.92" },
  { id: "fuel_selector", name: "Fuel selector", default: "Left", description: "The selector on the floor between the seats" },
  { id: "mixture", name: "Mixture", default: "Rich" },
  { id: "propeller", name: "Propeller", default: "High RPM" },
  { id: "cowl_flaps", name: "Cowl flaps", default: "Open" },
  { id: "elevator_trim", name: "Elevator trim", default: "Takeoff", description: "The wheel left of the throttle quadrant" },
  { id: "transponder", name: "Transponder code", default: "1200" },
  { id: "com1", name: "COM 1 frequency", default: "121.900" },
  { id: "nav1", name: "NAV 1 frequency", default: "110.300" },
  { id: "adf", name: "ADF frequency", default: "350" },
  { id: "ap_altitude", name: "Autopilot altitude", default: "5000" },
  { id: "panel_lights", name: "Panel lights", default: "Off" },
  { id: "pitot_heat", name: "Pitot heat", default: "Off" },
  { id: "yaw_damper", name: "Yaw damper", default: "Off", description: "Each sim engages its own, so leave it off until the flight starts" },
  { id: "parking_brake", name: "Parking brake", default: "Set" },
]
// The key the take-control strip shows as bound, an example of a name the helper gives a key.
const BOUND = "F9"
const SESSIONS: Record<
  | "alone" | "crewmate" | "bigger-crew" | "joined" | "preflight-alone" | "preflight-loading" | "preflight-crew" | "preflight-settling" | "preflight-dropped" | "preflight-countdown" | "preflight-joined" | "preflight-worst"
  | "flying-pm" | "flying-pf" | "flying-take" | "flying-tap" | "flying-catching-up" | "flying-pf-lost" | "flying-combo" | "flying-hardware",
  Session
> = {
  alone: { joined: false, crew: [] },
  crewmate: { joined: false, crew: [{ ...JAMES, at: "world-map" }] },
  "bigger-crew": {
    joined: false,
    crew: [
      { ...JAMES, at: "world-map" },
      { name: "Adam", hue: "green", at: "aircraft" },
      { name: "Mia", hue: "blue", at: "loading" },
    ],
  },
  joined: { joined: true, crew: [{ ...JAMES, flying: true, way: "stand" }] },
  // Preflight on the host's card: alone; with James still loading; with James in the flight, ready;
  // with the host's aircraft still settling; with James dropped out while the host is ready; and
  // with everyone ready, so the countdown runs. Then on the joiner's card, in the flight.
  "preflight-alone": { joined: false, crew: [], preflight: { settled: true, differences: [], checklist: PF_CHECKLIST } },
  "preflight-loading": { joined: false, crew: [{ ...JAMES, at: "loading" }], preflight: { settled: true, differences: [], checklist: PF_CHECKLIST } },
  "preflight-crew": { joined: false, crew: [{ ...JAMES, link: LINK, ready: true }], traffic: DEMO_HOST, atc: DEMO_HOST, preflight: { settled: true, differences: DIFFERENCES.host, checklist: PF_CHECKLIST } },
  "preflight-worst": { joined: false, crew: [{ ...JAMES, link: LINK, ready: true }, ...BIG_CREW], preflight: { settled: true, differences: MOST_DIFFERENCES, checklist: LONG_CHECKLIST } },
  "preflight-settling": { joined: false, crew: [{ ...JAMES, link: LINK }], preflight: { settled: false, differences: DIFFERENCES.host, checklist: PF_CHECKLIST } },
  "preflight-dropped": { joined: false, crew: [{ ...JAMES, at: "lost" }], preflight: { settled: true, ready: true, differences: DIFFERENCES.host, checklist: PF_CHECKLIST } },
  "preflight-countdown": { joined: false, crew: [{ ...JAMES, link: LINK, ready: true }], traffic: DEMO_HOST, atc: DEMO_HOST, preflight: { settled: true, ready: true, differences: DIFFERENCES.host, checklist: PF_CHECKLIST } },
  "preflight-joined": { joined: true, crew: [{ ...JAMES, flying: true, link: LINK }], traffic: DEMO_HOST, atc: DEMO_HOST, preflight: { settled: true, differences: DIFFERENCES.joiner, checklist: EVERY_PILOT } },
  // In the flight, preflight over, its differences folded to counts: the joiner, monitoring, with
  // James flying; the host, flying; the joiner taking control with a hold, and later James taking
  // it back; the joiner letting go too soon; a late joiner whose catch-up runs; and the joiner whose
  // link to James, flying, is lost. James shares traffic and ATC.
  "flying-pm": { joined: true, crew: [{ ...JAMES, flying: true, link: LINK }], traffic: DEMO_HOST, atc: DEMO_HOST, preflight: { settled: true, differences: DIFFERENCES.joiner }, flight: { bound: BOUND } },
  "flying-pf": { joined: false, crew: [{ ...JAMES, link: LINK }], traffic: DEMO_HOST, atc: DEMO_HOST, preflight: { settled: true, differences: DIFFERENCES.host }, flight: { bound: BOUND } },
  "flying-take": { joined: true, crew: [{ ...JAMES, flying: true, link: LINK }], traffic: DEMO_HOST, atc: DEMO_HOST, preflight: { settled: true, differences: DIFFERENCES.joiner }, flight: { bound: BOUND, demo: "hold", handsBack: true } },
  "flying-tap": { joined: true, crew: [{ ...JAMES, flying: true, link: LINK }], traffic: DEMO_HOST, atc: DEMO_HOST, preflight: { settled: true, differences: DIFFERENCES.joiner }, flight: { bound: BOUND, demo: "tap" } },
  "flying-catching-up": { joined: true, crew: [{ ...JAMES, flying: true, link: LINK }], traffic: DEMO_HOST, atc: DEMO_HOST, preflight: { settled: true, differences: DIFFERENCES.joiner }, flight: { bound: BOUND, catchingUp: true } },
  "flying-pf-lost": { joined: true, crew: [{ ...JAMES, flying: true, at: "lost" }], traffic: DEMO_HOST, atc: DEMO_HOST, preflight: { settled: true, differences: DIFFERENCES.joiner }, flight: { bound: BOUND } },
  // Long bindings on the strip, to see how they fit: a four-key combination, which the binding
  // doesn't take (record/areas/control/01-take-control.md, The binding), and a hardware button,
  // whose name format is hypothetical.
  "flying-combo": { joined: true, crew: [{ ...JAMES, flying: true, link: LINK }], traffic: DEMO_HOST, atc: DEMO_HOST, preflight: { settled: true, differences: DIFFERENCES.joiner }, flight: { bound: "Ctrl+Shift+Alt+T", demo: "hold" } },
  "flying-hardware": { joined: true, crew: [{ ...JAMES, flying: true, link: LINK }], traffic: DEMO_HOST, atc: DEMO_HOST, preflight: { settled: true, differences: DIFFERENCES.joiner }, flight: { bound: "TCA Sidestick Button 3", demo: "hold" } },
}
// How long the countdown runs once every counted pilot is ready, in seconds.
const COUNTDOWN = 3
export type SessionKey = keyof typeof SESSIONS
// The session a frame moves on to, after that many milliseconds.
export type NextSession = { after: number; session: SessionKey }
const hexOf = (hue: string) => FIGURE_COLORS.find((c) => c.name === hue)!.hex

// For a joiner not yet in the flight, where the pilot flying is, under their name, and Join at the
// row's end (record/areas/interface/decisions.md, Join takes a joiner from the world map into the
// PF's flight; record/areas/session/02-units.md, Go to). Join asks first: Set up only has the menu
// script set the world map to the PF's airport, their stand while their engines are off or a runway
// there while they run, so the joiner's run too, their aircraft, and their livery where the joiner
// has it; Join now does the same, then starts the flight and presses Ready to fly. Once the joiner
// is in it, Dual Input moves their aircraft to the PF's. It works only at Free flight's world map,
// the EFB's one place outside a flight, so in a flight, without the PF's aircraft, or with the
// script gone after a sim update, Join is disabled, and its tooltip says why. A toast says how it
// went: what's left after Set up only; a stand the world map doesn't list, which leaves the airport
// alone; or the step that failed. The words name pilots, never he or she, since Dual Input doesn't
// know anyone's pronouns, and a tooltip or toast of one sentence has no period (user, 2026-10-29).
// The airport, stand, and aircraft are examples.
type Way = "stand" | "runway" | "no-stand" | "fails" | "no-flight" | "no-aircraft" | "other-aircraft" | "no-departure" | "no-script"
const WAYS: Record<Way, { when: string; at: string; why?: string; setUp?: string; now?: string; outcome?: "warning" | "error" }> = {
  stand: { when: "James is at a stand, engines off", at: "At EGLL, Parking 140", setUp: "Your departure is EGLL, Parking 140, in the Baron 58P. Start the flight when you're ready.", now: "Starting your flight at EGLL, Parking 140" },
  runway: { when: "James's engines are running", at: "At EGLL, engines running", setUp: "Your departure is a runway at EGLL, in the Baron 58P, so your engines run. Start the flight when you're ready.", now: "Starting your flight on a runway at EGLL, engines running" },
  "no-stand": { when: "Join finds no Parking 140 in EGLL's stands", at: "At EGLL, Parking 140", setUp: "Your departure is EGLL, in the Baron 58P, but its stands have no Parking 140. Pick James's stand on the world map, then start the flight.", now: "EGLL's stands have no Parking 140, so you'll start elsewhere there, and Dual Input moves you to James.", outcome: "warning" },
  fails: { when: "Join's airport search fails", at: "At EGLL, Parking 140", setUp: "Join couldn't find EGLL on the world map. Try again, or set up the flight yourself.", now: "Join couldn't find EGLL on the world map. Try again, or set up the flight yourself.", outcome: "error" },
  "no-flight": { when: "James hasn't loaded a flight", at: "Hasn't loaded a flight yet", why: "You can join once James is in a flight" },
  "no-aircraft": { when: "You don't have James's aircraft", at: "At EGLL, Parking 140", why: "Install the Baron 58P to fly with James" },
  "other-aircraft": { when: "You're in a flight in another aircraft", at: "At EGLL, Parking 140", why: "End this flight to join James from the world map" },
  "no-departure": { when: "James's flight names no departure airport", at: "In the Baron 58P", why: "Can't detect departure airport. Start your flight anywhere and Dual Input will teleport you to James." },
  "no-script": { when: "Join can't run, as after a sim update", at: "At EGLL, Parking 140", why: "Looks like something broke Join (perhaps a sim update, or corrupted Dual Input installation)." },
}
// How long the bench takes to set up the world map, in milliseconds: the airport search, then the
// stand or runway, the aircraft, and the livery.
const SET_UP_AFTER = 1200

// Join now takes the sim's own flight-button yellow, so it reads as starting the flight, as the
// world map's Start flight does: `--colorSpecial` and `--colorSpecial_Content` (read in fs-base-ui
// 0.1.10, components/shared/variables.css).
const SIM_FLY_BUTTON = "bg-[#FFDE03] text-[#242934] hover:bg-[#FFDE03]/90 focus-visible:border-[#FFDE03]/40 focus-visible:ring-[#FFDE03]/30"

// A pilot in the crew list: their figure's head, their name with the pilot flying marked, and under
// it where they are, where that says anything. The row's end is for each pilot's Ready once
// preflight runs, and before it, when no pilot can give one, it's empty but for Join on the pilot
// flying's row for a joiner out of the flight, since getting into that flight comes first.
// A pilot in the flight is "In the flight" under the name, and their link, its path and round trip,
// is a quiet chip after the name, outside the pilot flying's: the round trip changes as it's
// measured, and on the outside its changing width moves nothing else. The row's end is the card's
// to give: during preflight, each pilot's Ready.
// A row given pop pops its head in after that many milliseconds, fixed when the row first shows.
function CrewRow({ pilot, pop, end, alive }: { pilot: Pilot; pop?: number; end?: React.ReactNode; alive?: boolean }) {
  const { Badge } = useUI()
  const [popAfter] = useState(pop)
  const under = pilot.way ? { shows: WAYS[pilot.way].at, trouble: false } : pilot.at ? WHERE[pilot.at] : pilot.link ? { shows: "In the flight", trouble: false } : undefined
  const last = end ?? (pilot.way && <JoinPf way={pilot.way} />)
  return (
    <li className="flex items-center gap-3">
      <span data-fold-morph={`head-${pilot.name}`} className="flex shrink-0">
        <Head hex={hexOf(pilot.hue)} pop={popAfter} alive={alive ? pilot.name : undefined} slumped={pilot.at === "lost" || pilot.at === "crashed"} />
      </span>
      <div data-fold-fade className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 text-sm font-medium">
          {pilot.name}
          {pilot.flying && <Badge variant="secondary">Pilot flying</Badge>}
          {pilot.link && (
            <Badge variant="outline" className="text-muted-foreground tabular-nums">
              {pilot.link}
            </Badge>
          )}
          {pilot.traffic && <RoleChip icon={<Plane />} says="Shares traffic" />}
          {pilot.atc && <RoleChip icon={<Headset />} says="Shares ATC" />}
        </span>
        {under && <span className={"text-xs " + (under.trouble ? "text-warning" : "text-muted-foreground")}>{under.shows}</span>}
      </div>
      {last && (
        <span data-fold-fade className="ml-auto">
          {last}
        </span>
      )}
    </li>
  )
}

// A role's chip: its tab's icon alone, since a row already holds a name of up to 20 characters,
// Pilot flying, and the link, and a tooltip says what it means. The words are drafts.
function RoleChip({ icon, says }: { icon: React.ReactNode; says: string }) {
  const { Badge, Tooltip, TooltipContent, TooltipTrigger } = useUI()
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Badge variant="outline" aria-label={says} className="px-1.5 text-muted-foreground">
          {icon}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{says}</TooltipContent>
    </Tooltip>
  )
}

// Join, on the pilot flying's row. A press asks first, in the confirm popover, since Join now
// starts a flight: the question names the pilot flying, the row already says where they are, and
// the two answers say how far to go. It names no aircraft, whose name can run long. While the
// script works, Join shows a spinner. Where Join can't go, it's disabled, and a tooltip says why; a
// disabled button takes no pointer events, so the tooltip hangs on a wrapper.
function JoinPf({ way }: { way: Way }) {
  const { Button, Spinner, Tooltip, TooltipContent, TooltipTrigger } = useUI()
  const w = WAYS[way]
  const [busy, setBusy] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const go = (now: boolean) => {
    setBusy(true)
    timer.current = window.setTimeout(() => {
      setBusy(false)
      const show = w.outcome === "error" ? toast.error : w.outcome === "warning" ? toast.warning : toast
      show(now ? w.now : w.setUp)
    }, SET_UP_AFTER)
  }
  if (w.why)
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <Button size="sm" disabled>
            Join
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-60">{w.why}</TooltipContent>
      </Tooltip>
    )
  return (
    <ConfirmButton
      label={
        <>
          {busy && <Spinner data-icon="inline-start" />}
          Join
        </>
      }
      question={`Join ${DEMO_HOST}?`}
      also={{ label: "Set up only", onSelect: () => go(false) }}
      go="Join now"
      onConfirm={() => go(true)}
      trigger={{ size: "sm", disabled: busy }}
      tone="primary"
      className={SIM_FLY_BUTTON}
      align="end"
    />
  )
}

// This pilot's Ready, at the end of their row: outlined until pressed, then filled green with a
// check, and pressed again it un-readies. Until the aircraft has settled after its load, about 30s after
// Ready to fly (decision 048), it's disabled, and a tooltip says why.
// Pressed, it eases to green as the check opens room for itself before the word and springs in,
// and a ring of the green spreads from the button and fades (index.css, ready-pulse); un-readied,
// the check shrinks away and the room closes. The check and the word are one child of the button,
// so the kit's gap between an icon and its label stays out of the easing.
const READY_EASE = { room: 200, check: 300, after: 60 }
function ReadyButton({ ready, settled, onToggle }: { ready: boolean; settled: boolean; onToggle: () => void }) {
  const { Button, Tooltip, TooltipContent, TooltipTrigger } = useUI()
  const was = useRef(ready)
  const [pulses, setPulses] = useState(0)
  useEffect(() => {
    if (ready && !was.current) setPulses((n) => n + 1)
    was.current = ready
  }, [ready])
  if (!settled)
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <Button size="sm" variant="outline" disabled>
            Ready
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-60">Ready opens once your aircraft has settled, about 30s after Ready to fly</TooltipContent>
      </Tooltip>
    )
  return (
    <Button size="sm" variant={ready ? "default" : "outline"} className={"relative " + (ready ? GREEN_BUTTON : "")} onClick={onToggle}>
      {pulses > 0 && <span key={pulses} className="pointer-events-none absolute -inset-px rounded-[inherit] text-success" style={{ animation: "ready-pulse 600ms ease-out both" }} />}
      <span className="inline-flex items-center">
        <span className="inline-flex overflow-hidden transition-[width] ease-out" style={{ width: ready ? 20 : 0, transitionDuration: `${READY_EASE.room}ms` }}>
          <Check
            className="mr-1 size-4 shrink-0"
            style={{
              transform: ready ? "scale(1)" : "scale(0.3)",
              opacity: ready ? 1 : 0,
              transition: ready
                ? `transform ${READY_EASE.check}ms cubic-bezier(0.34, 1.56, 0.64, 1) ${READY_EASE.after}ms, opacity ${READY_EASE.check}ms ease-out ${READY_EASE.after}ms`
                : `transform 150ms ease-in, opacity 150ms ease-in`,
            }}
          />
        </span>
        Ready
      </span>
    </Button>
  )
}

// A number that rolls to its next value as a counter's wheel does: the old one slides up out of its
// window as the new one slides up in from below.
const ROLL_MS = 250
function Rolling({ value }: { value: number }) {
  const [leaving, setLeaving] = useState<number | null>(null)
  const last = useRef(value)
  useEffect(() => {
    if (last.current === value) return
    setLeaving(last.current)
    last.current = value
    const t = window.setTimeout(() => setLeaving(null), ROLL_MS)
    return () => clearTimeout(t)
  }, [value])
  const timing = { animationDuration: `${ROLL_MS}ms` }
  return (
    <span className="relative inline-flex overflow-hidden">
      {leaving !== null && (
        <span key={`out-${leaving}`} className="absolute inset-0 animate-out ease-in fade-out slide-out-to-top" style={{ ...timing, animationFillMode: "forwards" }}>
          {leaving}
        </span>
      )}
      <span key={value} className={leaving !== null ? "animate-in ease-out fade-in slide-in-from-bottom" : ""} style={timing}>
        {value}
      </span>
    </span>
  )
}

// The countdown, once every counted pilot is ready: a ring just before this pilot's Ready, the
// button that stops it, in the whole card and the folded one alike, with the seconds left rolling
// inside it and its arc draining over them, so it takes no row of its own and moves nothing as it
// comes and goes; Ready keeps its place at the row's end. It's green, as a pressed Ready is, since
// it runs because every Ready is. It pops in from half its size and shrinks away when un-readying
// stops it. It's an SVG stroke, since
// Coherent GT draws no conic gradient (record/areas/architecture/coherent-gt.md); whether it
// animates a stroke's dash offset is unmeasured. The arc's path counts 100 long (pathLength), as
// index.css's countdown-ring takes it.
const RING = { size: 28, stroke: 2.5, in: 200, out: 150 }
function CountdownRing({ left }: { left: number | null }) {
  const running = left !== null
  const last = useRef(left ?? 0)
  if (running) last.current = left
  // It stays drawn while it shrinks away, and each run drains from full.
  const [held, setHeld] = useState(running)
  const [run, setRun] = useState(0)
  useEffect(() => {
    if (running) {
      setHeld(true)
      setRun((r) => r + 1)
      return
    }
    const t = window.setTimeout(() => setHeld(false), RING.out)
    return () => clearTimeout(t)
  }, [running])
  if (!running && !held) return null
  const c = RING.size / 2
  const r = c - RING.stroke / 2
  return (
    <span
      role="timer"
      aria-label={`Flight starts in ${last.current}`}
      className={"relative flex shrink-0 items-center justify-center text-success " + (running ? "animate-in fade-in zoom-in-50" : "")}
      style={{
        width: RING.size,
        height: RING.size,
        animationDuration: `${RING.in}ms`,
        opacity: running ? 1 : 0,
        transform: running ? "none" : "scale(0.5)",
        transition: running ? undefined : `opacity ${RING.out}ms ease-in, transform ${RING.out}ms ease-in`,
      }}
    >
      <svg className="absolute inset-0" width={RING.size} height={RING.size} viewBox={`0 0 ${RING.size} ${RING.size}`} fill="none">
        <circle cx={c} cy={c} r={r} strokeWidth={RING.stroke} className="stroke-success/20" />
        <circle
          key={run}
          cx={c}
          cy={c}
          r={r}
          strokeWidth={RING.stroke}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={100}
          transform={`rotate(-90 ${c} ${c})`}
          className="stroke-current"
          style={{ animation: `countdown-ring ${COUNTDOWN}s linear both` }}
        />
      </svg>
      <span className="relative text-xs font-semibold tabular-nums">
        <Rolling value={last.current} />
      </span>
    </span>
  )
}

// The session's phase, which the header shows (phase.tsx): preflight once the PF is in a flight on
// the ground, or has a way for a joiner to reach them, then syncing once the countdown ends.
const phaseOf = (session: Session, started: boolean): SessionPhase | undefined =>
  started ? "syncing" : session.preflight || session.crew.find((p) => p.flying)?.way ? "preflight" : undefined

// A pilot's head in the folded card's row, named with where they stand for a screen reader, with a
// badge at its lower right: while the countdown waits on them, an empty ring in the muted color,
// the card's own color inside, so whom it waits on shows rather than being read from which checks
// are missing; once they're ready, green fills it from the middle and a check comes in; and a red
// cross while they're out of the flight, a dropped link or a crashed sim (user, 2026-10-30). A
// pilot the crew went without has none. A ring in the card's color parts the badge from the head.
// Tried and dropped for waiting: an hourglass, outlined or solid, which at 14px read as a scribble
// or an X; and the ring in preflight's information color, which didn't work beside the heads.
type HeadState = "ready" | "out" | "waiting"
const HEAD_SAYS: Record<HeadState, string> = { ready: "ready", out: "out of the flight", waiting: "not ready" }
const FILL_MS = 220
function StripHead({ pilot, state }: { pilot: Pilot; state?: HeadState }) {
  const ready = state === "ready"
  const at = "absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full ring-2 ring-card "
  return (
    <span data-fold-morph={`head-${pilot.name}`} className="relative inline-flex" aria-label={state ? `${pilot.name}, ${HEAD_SAYS[state]}` : pilot.name}>
      <Head hex={hexOf(pilot.hue)} alive={pilot.name} turns slumped={state === "out"} />
      {state === "out" && (
        <span data-fold-fade className={at + "bg-destructive text-destructive-foreground"}>
          <X className="size-2.5" strokeWidth={3} />
        </span>
      )}
      {(state === "waiting" || ready) && (
        <span data-fold-fade className={at + "bg-card text-success-foreground inset-ring-[1.5px] inset-ring-muted-foreground"}>
          <span className="absolute inset-0 rounded-full bg-success" style={{ transform: ready ? "none" : "scale(0)", transition: `transform ${FILL_MS}ms ease-out` }} />
          <Check className="relative size-2.5" strokeWidth={3} style={{ opacity: ready ? 1 : 0, transition: `opacity ${FILL_MS}ms ease-out` }} />
        </span>
      )}
    </span>
  )
}

// The match check's differences, under the crew rows with no title of their own, since nearly
// every one names a crewmate, and the record has them beside each Ready
// (record/areas/product/03-v1-scope.md, Preflight match check). In preflight they're listed in
// full, for the crew to weigh before Ready. Once the flight starts they still hold, and a late
// joiner or a changed aircraft can raise new ones, but they're for looking up when something
// won't sync, so the list folds to its counts: a count of each level, then a chevron, which open
// it again. Open, the list takes the counts' place rather than sitting under them, since they'd
// only repeat it, and the list itself folds it back, with an up chevron after its last line.
// Whether a new difference in flight opens the list by itself waits for the flying page.
// The counts are snug: the chevron beside them, in a tint that hugs them on hover, 8px around on
// every side, its corners 6px, as the checklist rows' are, with the counts on the card's content
// edge, and the press reaches 6px above the tint, unseen, to 42px tall, for a VR pointer. The
// open list's tint covers the whole list, which has nothing else to press. Either nudges down 1px
// while pressed, as the kit's buttons do (user, 2026-10-31). Both forms start 12px
// under the crew, their words 20px under it, the card's own spacing, so they read as a group of
// their own; and each ends the card 8px into its bottom padding, so a tint's bottom sits as far
// from the card's edge as its side does, 12px.
// The counts and the list are one thing in two forms, so one turns into the other (morph): both
// stay drawn, one over the other at the same corner, the one not showing hidden, and the box
// between them eases to the height of the one showing, as a room does (EaseRoom).
function CrewDifferences({ differences, started }: { differences: Difference[]; started: boolean }) {
  const [open, setOpen] = useState(false)
  const expanded = !started || open
  const count = (level: Difference["level"]) => differences.filter((d) => d.level === level).length
  const errors = count("error")
  const warnings = count("warning")
  const fold = () => setOpen(false)
  const box = useRef<HTMLDivElement>(null)
  const counts = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // Its own height first, unmarked for stillEasing, which the measure below then pins, the same.
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const shown = expanded ? list.current : counts.current
    if (!shown) return
    const h = shown.offsetHeight + parseFloat(getComputedStyle(shown).marginTop)
    if (h !== height) setHeight(h)
  })
  useLayoutEffect(() => {
    box.current?.dispatchEvent(new CustomEvent(EASE_EVENT, { bubbles: true }))
  }, [height])
  const painted = usePainted()
  useLayoutEffect(() => {
    if (!painted.current || !counts.current || !list.current) return
    return expanded ? morph(counts.current, list.current, MORPH.inAfter.open) : morph(list.current, counts.current, MORPH.inAfter.fold)
    // It morphs when the form changes, from the one showing before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])
  const hidden = "pointer-events-none absolute top-0 left-0 opacity-0"
  return (
    <div ref={box} data-ease-to={height} className="relative mt-3 -mb-2 transition-[height] ease-in-out" style={{ height, transitionDuration: `${MORPH.ms}ms` }}>
      {started && (
        <button
          ref={counts}
          type="button"
          aria-hidden={expanded}
          tabIndex={expanded ? -1 : 0}
          aria-expanded={false}
          aria-label={`${errors} errors and ${warnings} warnings between the crew's setups`}
          onClick={() => setOpen(true)}
          className={"group -mx-2 -mt-1.5 flex w-fit pt-1.5 text-sm outline-none active:translate-y-px " + (expanded ? hidden : "")}
        >
          <span className="flex items-center gap-3 rounded-[6px] p-2 group-hover:bg-muted/50 group-focus-visible:bg-muted/50">
            {errors > 0 && (
              <span className="flex items-center gap-1.5 text-destructive">
                <CircleX data-morph="error" className="size-4" />
                <span data-fade>{errors}</span>
              </span>
            )}
            {warnings > 0 && (
              <span className="flex items-center gap-1.5 text-warning">
                <TriangleAlert data-morph="warning" className="size-4" />
                <span data-fade>{warnings}</span>
              </span>
            )}
            <ChevronDown data-fade className="-ml-1.5 size-4 text-muted-foreground" />
          </span>
        </button>
      )}
      <div
        ref={list}
        role={started ? "button" : undefined}
        tabIndex={started && expanded ? 0 : undefined}
        aria-hidden={!expanded}
        aria-expanded={started ? true : undefined}
        onClick={started ? fold : undefined}
        onKeyDown={(e) => {
          if (!started || (e.key !== "Enter" && e.key !== " ")) return
          e.preventDefault()
          fold()
        }}
        className={"-mx-2 rounded-[6px] p-2 outline-none " + (started ? "cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 active:translate-y-px " : "") + (expanded ? "" : hidden + " right-0")}
      >
        <ScrollWindow max={MESSAGES_WINDOW}>
          <Differences differences={differences} marked after={started ? <ChevronUp className="ml-1.5 inline size-4 align-[-3px] text-muted-foreground" /> : undefined} />
        </ScrollWindow>
      </div>
    </div>
  )
}

// A list that scrolls in a window of its own once it runs past max pixels, as the crew and the
// match check's messages do with a big crew, so the session card stays short enough to fold in one
// gesture (user, 2026-10-30). It scrolls as the app's other boxes do, by wheel, drag, and coast, a
// drag staying with it while it can scroll the way the drag goes and passing to the page past its
// end, and fades at its edges in the card's color say there's more. The card's fold reads how much
// of a part it shows (data-fold-window). The crew's shows three rows, this pilot and two more, which
// covers v1's two-pilot sessions with room to spare and keeps the card small (user, 2026-10-30),
// and half of a fourth; the messages' the three a two-pilot crew most often has and part of a
// fourth; so the cut line says there's more. The crew's has no limit outside preflight, where no
// checklist waits under the card and the card doesn't fold, so a big crew only lengthens the page
// (user, 2026-10-30).
const CREW_WINDOW = 150
const MESSAGES_WINDOW = 128
// A box that scrolls clips what reaches past it, so the window reaches out past its list, taking it
// back with as much negative margin: above and below, 8px, the green ring a pressed Ready spreads
// (index.css, ready-pulse), which was cut off on the top row (user, 2026-10-30); and to either
// side 8px, the ring's spread at the row's end, which also covers a list head's nose, which its
// cone and a nod's dip take out of its window by up to 7px (figure-head.tsx, LIST_ROOM).
const WINDOW_ROOM = { x: 8, y: 8 }
function ScrollWindow({ max, children }: { max?: number; children: React.ReactNode }) {
  const w = useScroller({ nested: true })
  const fade = (to: "top" | "bottom", on: boolean): React.CSSProperties => ({ background: `linear-gradient(to ${to === "top" ? "bottom" : "top"}, var(--card), transparent)`, opacity: on ? 1 : 0 })
  return (
    <div className="relative">
      <div
        ref={w.ref}
        data-fold-window
        onScroll={w.onScroll}
        onMouseDown={w.onMouseDown}
        onWheel={w.onWheel}
        className={"overflow-y-auto " + NO_SCROLLBAR + " " + w.cursor}
        style={{ maxHeight: max === undefined ? undefined : max + 2 * WINDOW_ROOM.y, margin: `${-WINDOW_ROOM.y}px ${-WINDOW_ROOM.x}px`, padding: `${WINDOW_ROOM.y}px ${WINDOW_ROOM.x}px` }}
      >
        {children}
      </div>
      <div className="pointer-events-none absolute right-0 left-0 h-6 transition-opacity duration-200" style={{ ...fade("top", w.above), top: -WINDOW_ROOM.y, marginInline: -WINDOW_ROOM.x }} />
      <div className="pointer-events-none absolute right-0 left-0 h-6 transition-opacity duration-200" style={{ ...fade("bottom", w.below), bottom: -WINDOW_ROOM.y, marginInline: -WINDOW_ROOM.x }} />
    </div>
  )
}

// One form of the differences turning into the other: what's marked to fade in the leaving form
// fades out, its icons that the arriving form also has glide to where it has them, and the
// arriving form's own words fade up in, a row at a time. The leaving form stays shown over the
// arriving one until the glide ends, then hides, and the arriving form's icons take over from the
// gliding ones in the same spot. Opening, the words start as the icons set off; folding, the counts
// wait for the icons to near them. It styles the elements directly, and the cleanup it returns
// undoes it, so a press mid-morph starts the next from where things are.
const MORPH = { ms: 320, out: 110, in: 180, stagger: 40, inAfter: { open: 90, fold: 200 } }
function morph(from: HTMLElement, to: HTMLElement, inAfter: number) {
  const touched: (HTMLElement | SVGElement)[] = []
  const set = (e: HTMLElement | SVGElement, s: Record<string, string>) => {
    Object.assign(e.style, s)
    touched.push(e)
  }
  const scale = zoomOf(from)
  set(from, { opacity: "1" })
  from.querySelectorAll<HTMLElement>("[data-fade]").forEach((e) => set(e, { transition: `opacity ${MORPH.out}ms ease-in`, opacity: "0" }))
  from.querySelectorAll<SVGElement>("[data-morph]").forEach((icon) => {
    const target = to.querySelector<SVGElement>(`[data-morph="${icon.dataset.morph}"]`)
    if (!target) return set(icon, { transition: `opacity ${MORPH.out}ms ease-in`, opacity: "0" })
    const a = icon.getBoundingClientRect()
    const b = target.getBoundingClientRect()
    set(target, { opacity: "0" })
    set(icon, { transition: `transform ${MORPH.ms}ms cubic-bezier(0.4, 0, 0.2, 1)`, transform: `translate(${(b.left - a.left) / scale}px, ${(b.top - a.top) / scale}px)` })
  })
  const arriving = [...to.querySelectorAll<HTMLElement>("[data-fade]")]
  arriving.forEach((e) => set(e, { transition: "none", opacity: "0", transform: "translateY(4px)" }))
  void to.offsetHeight
  arriving.forEach((e) => {
    const row = e.closest("li")
    const i = row ? [...row.parentElement!.children].indexOf(row) : 0
    const delay = inAfter + i * MORPH.stagger
    Object.assign(e.style, { transition: `opacity ${MORPH.in}ms ease-out ${delay}ms, transform ${MORPH.in}ms ease-out ${delay}ms`, opacity: "1", transform: "none" })
  })
  const undo = () => touched.forEach((e) => Object.assign(e.style, { opacity: "", transform: "", transition: "" }))
  const rows = to.querySelectorAll("li").length
  const end = window.setTimeout(undo, Math.max(MORPH.ms, inAfter + Math.max(0, rows - 1) * MORPH.stagger + MORPH.in))
  return () => {
    clearTimeout(end)
    undo()
  }
}

// The canvas zooms the frames, so a distance on screen is turned back into a box's own pixels by
// this.
const zoomOf = (e: HTMLElement) => e.getBoundingClientRect().width / e.offsetWidth || 1

// Whether the frame has painted once: what a frame opens on shows at once, and a change after its
// first paint eases.
function usePainted() {
  const painted = useRef(false)
  useEffect(() => {
    const f = requestAnimationFrame(() => (painted.current = true))
    return () => cancelAnimationFrame(f)
  }, [])
  return painted
}

// The match check's differences, in a section of the session card: an error's icon in red, a
// warning's in amber, and a note's muted, the difference, and what it can cause, muted. Anything
// given to go after it ends the last line. Marked, the first icon of each level is one the counts
// also have, and everything else fades, for a morph between the two. Each line fades on its own as
// the session card folds (drawFold), so the lines slide under the folded row one by one.
function Differences({ differences, after, marked }: { differences: Difference[]; after?: React.ReactNode; marked?: boolean }) {
  const first = (i: number) => differences.findIndex((d) => d.level === differences[i].level) === i
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {differences.map((d, i) => {
        const mark = marked ? (first(i) ? { "data-morph": d.level } : { "data-fade": "" }) : {}
        return (
        <li key={d.says} data-fold-fade className="flex items-start gap-2">
          {d.level === "error" ? (
            <CircleX {...mark} className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : d.level === "warning" ? (
            <TriangleAlert {...mark} className="mt-0.5 size-4 shrink-0 text-warning" />
          ) : (
            <Info {...mark} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <span data-fade={marked ? "" : undefined}>
            {d.says}
            {d.note && <span className="text-muted-foreground"> · {d.note}</span>}
            {i === differences.length - 1 && after}
          </span>
        </li>
        )
      })}
    </ul>
  )
}

// The pilot's checklist, on the page under the session card, for them to work through before
// Ready: every pilot's holds what the profile's authors list for each pilot to set by hand, and the
// PF's also opens with the controls Dual Input tracks by counting their events, since no variable
// shows their value, and counts from where the aircraft starts them (record/areas/product/
// 03-v1-scope.md, Preflight). Its rows read as an aircraft's checklist does, each control, dots,
// then its starting value, in capitals, in B612 Mono, the typeface Airbus made for its cockpit
// displays, and a row checked turns green. Each row is the page's width and at least 44px tall, so
// a VR controller's pointer lands on one without careful aim, and a press nudges it down 1px, as
// the kit's buttons do. A row checked is the pilot's own note, and Ready doesn't wait for it.
// Profile authors write the names, values, and descriptions, and Dual Input makes some entries
// itself, so the rows take any length rather than the format limiting it: a value always shows
// whole, since a value cut short reads as another value, and wraps once it passes half the row; a
// name takes the rest of the line, cut at its edge, and slides to show its end while the pointer
// rests on it; the dots between keep at least three; and a description wraps under the name as
// long as it runs. Rows go by the entry's ID, since two entries can share a name. How bright the
// list is follows the session card's fold (StartCard).
// Under the rows, a muted Reset checklist unchecks them all, for a pilot whose cockpit went back
// where it started, as after reloading the flight; it waits, disabled, until a row is checked, so
// the list's end never moves (user, 2026-10-31). Tried and dropped: clearing the checks by
// themselves when the aircraft loaded again, which could clear a pilot's checks on a signal that
// wasn't a reload.
const LEADER = ".".repeat(80)
function Checklist({ items }: { items: ChecklistItem[] }) {
  const { Button } = useUI()
  const [done, setDone] = useState<string[]>([])
  const [pointed, setPointed] = useState<string | null>(null)
  const toggle = (id: string) => setDone((d) => (d.includes(id) ? d.filter((n) => n !== id) : [...d, id]))
  return (
    <section className="flex shrink-0 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">Preflight Checklist</h3>
        <p className="text-sm text-muted-foreground">Check these before you click Ready, so every cockpit starts in sync.</p>
      </div>
      {/* The rows reach 8px past the text on either side, so their text lines up with the title
          while a hovered row's tint has room around it. */}
      <ul className="-mx-2 flex flex-col font-checklist text-[13px]">
        {items.map((item) => {
          const checked = done.includes(item.id)
          return (
            <li key={item.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(item.id)}
                onMouseEnter={() => setPointed(item.id)}
                onMouseLeave={() => setPointed((p) => (p === item.id ? null : p))}
                className={"flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-[6px] px-2 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/30 active:translate-y-px " + (checked ? "text-success" : "")}
              >
                <span className="flex items-center gap-3">
                  <ChecklistBox checked={checked} />
                  {/* B612 Mono leaves more room under its baseline than above its capitals, so
                      centered lines put the capitals 1px above the box's center; the text drops
                      that 1px. */}
                  <ChecklistName text={item.name} sliding={pointed === item.id} />
                  <span className="relative top-px min-w-[3ch] flex-1 overflow-hidden whitespace-nowrap opacity-40">{LEADER}</span>
                  <span className="relative top-px max-w-1/2 shrink-0 text-right break-words uppercase">{item.default}</span>
                </span>
                {/* Under the name, past the box and its gap. */}
                {item.description && <span className="pl-7 text-[11px] leading-snug opacity-60">{item.description}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      <Button variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground" disabled={done.length === 0} onClick={() => setDone([])}>
        <RotateCcw data-icon="inline-start" />
        Reset checklist
      </Button>
    </section>
  )
}

// A checklist name too long for its line, cut at the line's edge, slides left to show its end
// while the pointer rests on its row: after a beat, so a pointer passing over doesn't set it moving,
// at a pace to read by, holding at the end, and back once the pointer leaves. It's a transition on
// transform, which Coherent GT keeps, so each name slides its own distance without a keyframe per
// name. The distance is the name's own width past the line's, both measured untransformed.
const SLIDE = { wait: 500, pxPerSecond: 50, backMs: 250 }
function ChecklistName({ text, sliding }: { text: string; sliding: boolean }) {
  const line = useRef<HTMLSpanElement>(null)
  const name = useRef<HTMLSpanElement>(null)
  const [past, setPast] = useState(0)
  useLayoutEffect(() => {
    if (line.current && name.current) setPast(Math.max(0, name.current.offsetWidth - line.current.clientWidth))
  }, [text, sliding])
  const go = sliding && past > 0
  return (
    <span ref={line} className="relative top-px min-w-0 overflow-hidden whitespace-nowrap uppercase">
      <span
        ref={name}
        className="inline-block"
        style={{
          transform: `translateX(${go ? -past : 0}px)`,
          transition: go ? `transform ${(past / SLIDE.pxPerSecond) * 1000}ms linear ${SLIDE.wait}ms` : `transform ${SLIDE.backMs}ms ease-out`,
        }}
      >
        {text}
      </span>
    </span>
  )
}

// A checklist row's box, drawn as an avionics display draws one: a square outline with sharp
// corners, dimmed while open, and once checked, a check stroked inside it with square ends, both in
// the row's color.
function ChecklistBox({ checked }: { checked: boolean }) {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" aria-hidden className="size-4 shrink-0">
      <rect x="1" y="1" width="16" height="16" strokeWidth={1.5} opacity={checked ? 1 : 0.6} />
      {checked && <polyline points="4.5,9.5 7.5,12.5 13.5,5.5" strokeWidth={2.25} strokeLinecap="square" strokeLinejoin="miter" />}
    </svg>
  )
}

// The heads pop in as the card turns to the session, one after another down the list, while the
// figure that stood under the card leaps off the page, so the pilot seems to land in the crew; a
// pilot who joins later pops in as their row appears. The first head's wait, and each next one's,
// in milliseconds.
const POP = { first: 120, stagger: 70 }

// The session's side of the card, from the moment Host or Join succeeds, in place of the aircraft
// and Host and Join: the invite code, with Copy, every pilot's to share, since it belongs to the session; and Leave, in
// the kit's tinted red, since it ends the session for this pilot, asking first once anyone else is
// in it. Then the crew, each pilot by their figure's head, this pilot first
// as You. The host is the pilot flying when a session starts, and alone, a row waits for the
// crewmate the code brings, so the list shows what comes next; v1 sessions are two pilots, so that
// row fills and goes with the first join. This pilot's color is an example.
// During preflight, each row ends with that pilot's Ready, this pilot's as their button. Every
// pilot counts but those a ready pilot went without, and a pilot who dropped out is unready and
// still counts, so the crew waits for them unless someone goes without them; the PF can't be gone
// without. Once every counted pilot is ready, the countdown runs, and un-readying stops it. The
// match check's differences follow the rows (CrewDifferences). The flight starting, which the card
// hands up and the phase shows, is as far as these frames go.
// While the checklist has the page, the card folds to one row for what a pilot working through it
// watches: every pilot's head, badged ready or out, so they see whom they're waiting on, and their
// own Ready at the end, with the countdown's ring before it once it runs. The code, Leave, Go without, and
// the match check wait for the whole card.
const ROW_HEADS = 7
// The row and the whole card are one card in two forms, both drawn: the whole card in the page's
// flow, the row over its top, hidden until the card folds. The card's fold draws the way between
// them (drawFold), from the parts marked data-fold-morph, which glide, and data-fold-fade, which
// fade.
function SessionHalf({ session, started, folded, onStarted, onLeave }: { session: Session; started: boolean; folded: boolean; onStarted: () => void; onLeave: () => void }) {
  const { Button, CardContent, Separator } = useUI()
  const { joined, crew, preflight } = session
  const turnedIn = useRef(false)
  useEffect(() => {
    turnedIn.current = true
  }, [])
  // Who flies: the host when the session starts, and whoever takes control after. Once the flight
  // has started, the session page says how control stands, and the app's frame draws the strip
  // under the tabs (flight.tsx).
  const firstPf = (joined && crew.find((p) => p.flying)?.name) || "You"
  const [pf, setPf] = useState(firstPf)
  const flight = session.flight
  const me: Pilot = { name: "You", hue: "orange", flying: pf === "You", at: started && flight?.catchingUp ? "catching-up" : undefined, traffic: session.traffic === "You", atc: session.atc === "You" }
  const pfPilot = crew.find((p) => p.name === pf)
  const takeNow = useRef(() => setPf("You"))
  const control = useMemo<Control | undefined>(
    () => (started ? { mine: pf === "You", pf, catchingUp: !!flight?.catchingUp, pfLost: pfPilot?.at === "lost", bound: flight?.bound, take: () => takeNow.current(), demo: flight?.demo } : undefined),
    [started, pf, pfPilot?.at, flight],
  )
  useShowControl(control)
  // A demo that hands control back: the pilot flying takes it again a while after this pilot took
  // it, and the strip turns back into the button. The banner says who has control
  // (record/areas/control/01-take-control.md, A pass), so the app adds nothing.
  useEffect(() => {
    if (!flight?.handsBack || pf !== "You" || firstPf === "You") return
    const t = window.setTimeout(() => setPf(firstPf), 2500)
    return () => clearTimeout(t)
  }, [pf, flight, firstPf])

  const [ready, setReady] = useState(!!preflight?.ready)
  const [goneWithout, setGoneWithout] = useState<string[]>([])
  const [left, setLeft] = useState<number | null>(null)
  const allReady = !!preflight && !started && ready && crew.filter((p) => !goneWithout.includes(p.name)).every((p) => p.ready)
  useEffect(() => {
    if (!allReady) {
      setLeft(null)
      return
    }
    setLeft(COUNTDOWN)
    const tick = window.setInterval(() => setLeft((l) => (l === null ? null : l - 1)), 1000)
    return () => clearInterval(tick)
  }, [allReady])
  useEffect(() => {
    if (left === 0) onStarted()
    // It hands up the moment the countdown ends, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left])
  // The crew's heads hear what happens to the crew (figure-head.tsx, LiveFigure): a pilot who
  // readies nods and the rest look at them.
  const crewBox = useRef<HTMLDivElement>(null)
  const readyBefore = useRef(new Set([...(ready ? ["You"] : []), ...crew.filter((p) => p.ready).map((p) => p.name)]))
  useEffect(() => {
    const now = new Set([...(ready ? ["You"] : []), ...crew.filter((p) => p.ready).map((p) => p.name)])
    for (const name of now) if (!readyBefore.current.has(name)) cueHeads(crewBox.current, { kind: "ready", name })
    readyBefore.current = now
  }, [ready, crew])
  // This pilot's Ready, with the countdown's ring before it, in the whole card and the folded one.
  const myReady = preflight && (
    <span data-fold-morph="ready" data-pressed={ready || undefined} className="flex items-center gap-2">
      <CountdownRing left={left} />
      <ReadyButton ready={ready} settled={preflight.settled} onToggle={() => setReady((r) => !r)} />
    </span>
  )
  const endOf = (p: Pilot, you: boolean): React.ReactNode => {
    if (!preflight || started) return undefined
    if (you) return myReady
    if (goneWithout.includes(p.name)) return <span className="text-xs text-muted-foreground">Not counted</span>
    if ((p.at === "lost" || p.at === "crashed") && ready && !p.flying)
      return (
        <Button size="sm" variant="secondary" onClick={() => setGoneWithout((g) => [...g, p.name])}>
          Go without
        </Button>
      )
    if (p.way) return undefined
    // Not ready is a plain muted line, as the folded row's empty ring is muted; chips with icons, as
    // the folded row's badges, made the whole card busy, and preflight's information color didn't
    // work (user, 2026-10-30).
    return p.ready ? <StatusChip level="success">Ready</StatusChip> : <span className="text-xs text-muted-foreground">Not ready</span>
  }
  const code = `${DEMO_CODE.slice(0, 3)}-${DEMO_CODE.slice(3)}`
  const copy = (
    <Button variant="ghost" size="icon-sm" aria-label="Copy the invite code" onClick={() => toast("Copied the invite code")}>
      <Copy />
    </Button>
  )
  const leave = (
    <>
      Leave <LogOut data-icon="inline-end" />
    </>
  )
  // This pilot first, then, during preflight, the pilots the countdown waits on, not ready or
  // dropped out, and then the rest, so the crew's window and the folded row show who's holding the
  // flight up first (user, 2026-10-30). A pilot moves down the list as they ready, unanimated.
  // The folded row has room for ROW_HEADS heads before Ready with its ring; a bigger crew shows the
  // first ones and a count of the rest.
  const waitedOn = (p: Pilot) => !!preflight && !started && !p.ready && !goneWithout.includes(p.name)
  const crewNow = crew.map((p) => ({ ...p, flying: p.name === pf, traffic: session.traffic === p.name, atc: session.atc === p.name }))
  const everyone = [me, ...crewNow.filter(waitedOn), ...crewNow.filter((p) => !waitedOn(p))]
  // Where a pilot stands, for their head's badge in the folded row.
  const stateOf = (p: Pilot, you: boolean): HeadState | undefined => {
    if (you ? ready : p.ready) return "ready"
    if (p.at === "lost" || p.at === "crashed") return "out"
    return you || waitedOn(p) ? "waiting" : undefined
  }
  const inRow = everyone.length > ROW_HEADS ? everyone.slice(0, ROW_HEADS - 1) : everyone
  const notInRow = everyone.length - inRow.length
  return (
    <div ref={crewBox} data-heads className="relative">
      <div data-fold-form="full" inert={folded} className={"flex flex-col gap-(--card-spacing) " + (folded ? "pointer-events-none" : "")}>
        <CardContent data-fold-fade className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label>Invite code</Label>
            <div className="flex items-center gap-1">
              <span className="font-mono text-2xl font-medium tracking-wider">{code}</span>
              {copy}
            </div>
          </div>
          {crew.length > 0 ? (
            <span data-leave className="contents">
              <ConfirmButton label={leave} question="Leave the session?" go="Leave" onConfirm={onLeave} trigger={{ variant: "destructive", size: "sm" }} className={RED_BUTTON} align="end" />
            </span>
          ) : (
            <Button data-leave variant="destructive" size="sm" onClick={onLeave}>
              {leave}
            </Button>
          )}
        </CardContent>
        <Separator data-fold-fade />
        <CardContent className="flex flex-col gap-3">
          <Label data-fold-fade>Crew</Label>
          <div className="flex flex-col">
            <ScrollWindow max={preflight && !started ? CREW_WINDOW : undefined}>
              <ul className="flex flex-col gap-2">
                {everyone.map((p, i) => (
                  <CrewRow key={p.name} pilot={p} pop={turnedIn.current ? 0 : POP.first + i * POP.stagger} end={endOf(p, i === 0)} alive={!!preflight && !started && p.at !== "lost" && p.at !== "crashed"} />
                ))}
                {crew.length === 0 && (
                  <li data-fold-fade className="flex items-center gap-3 text-sm text-muted-foreground/60">
                    <EmptyHead />
                    Send the invite code for others to join
                  </li>
                )}
              </ul>
            </ScrollWindow>
            {preflight && preflight.differences.length > 0 && <CrewDifferences differences={preflight.differences} started={started} />}
          </div>
        </CardContent>
      </div>
      {preflight && (
        <div data-fold-form="row" inert={!folded} className={"absolute top-0 right-0 left-0 " + (folded ? "" : "pointer-events-none opacity-0")}>
          <CardContent className="flex items-center gap-4">
            <div className="flex shrink-0 items-center gap-1.5">
              {inRow.map((p, i) => (
                <StripHead key={p.name} pilot={p} state={stateOf(p, i === 0)} />
              ))}
              {/* A head's size, 28px. */}
              {notInRow > 0 && (
                <span data-fold-follows={`head-${everyone[inRow.length].name}`} aria-label={`${notInRow} more pilots`} className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground tabular-nums">
                  +{notInRow}
                </span>
              )}
            </div>
            <span className="ml-auto">{myReady}</span>
          </CardContent>
        </div>
      )}
    </div>
  )
}

// The session card's fold follows the page's scroll, as a phone app's collapsing header does
// (user, 2026-10-30): from the page's top, the first stretch of scrolling folds the whole card into
// its row, the checklist rising with the card's edge, and past it the checklist scrolls on under the
// row; scrolling back to the top unfolds it. The page keeps the whole card's height in its flow,
// with room under the shrinking card making up the difference, so folding never changes what can
// be scrolled, and can't fold or unfold itself.
// On the way, the whole card's content scrolls with the page, as a list scrolls under a header, and
// the row builds itself at the top as the crew rows reach it, so a pause anywhere looks deliberate
// (user, 2026-10-30, after heads gliding from the first pixel left their rows behind: "everything
// looks like a mess"). What's above this pilot's crew row, the code, Leave, and the Crew label,
// fades as it slides under the card's top edge. Each of the row's heads, and this pilot's Ready,
// takes over from its twin in the crew list where that twin is, scrolling with it until it reaches
// its place in the row, and sliding sideways into it over the last dock pixels before. It's the
// row's own part that travels, never the list's, since the crew list is a window of its own that
// would cut off a part leaving it; so a part the window hides comes into view only as it nears its
// place. A crew row's words fade out by the time its head is halfway through that approach, so they
// never run into the row above, and its badge rides its head in and fades in as it lands.
// Everything else below fades as it nears the docked row, so it slides under it rather than across
// it. A part with no twin in the other form fades with its own. Per scroll it styles the parts
// directly rather than rendering, so a frame's work is a few dozen writes. Whether Coherent GT runs
// scroll-driven animations is unmeasured, and a scroll handler needs none.
// A fold is never left partway: a drag let go of inside it lands on a form (StartCard), and a wheel
// that stops inside it finishes the way it was going once it has rested snapAfter, in
// milliseconds. The crew list and the match check's messages each scroll in a window of their own
// (ScrollWindow), so however big the crew, the card stays short enough to fold in one gesture
// (user, 2026-10-30, after a card several screens tall that only stopped in the right places felt
// loose at its usual size). The pill on the card's edge glides the page to the top or to the
// fold; the flight starting unfolds a folded card over ms. A part fades over edgeFade pixels as it
// nears the docked row, or over its own height while sliding under the card's top. All that is how a
// finger scrubs the fold; one the page animates, on a click, a snap, or a flick, goes as one motion
// (blendLooks), what fades out going over the first blendOut of the way and what fades in over the
// last blendIn.
const FOLD = { ms: 380, snapAfter: 120, edgeFade: 24, dock: 64, blendOut: 0.4, blendIn: 0.5 }
// How much of the checklist shows while the whole card does; it comes up to full as the card folds.
const LIST_DIM = 0.5
type FoldParts = { full: HTMLElement; row: HTMLElement; range: number }
function foldParts(inner: HTMLElement | null): FoldParts | undefined {
  const full = inner?.querySelector<HTMLElement>('[data-fold-form="full"]')
  const row = inner?.querySelector<HTMLElement>('[data-fold-form="row"]')
  return full && row ? { full, row, range: full.offsetHeight - row.offsetHeight } : undefined
}
const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}
const easeOut = (t: number) => 1 - (1 - t) ** 3
// How far each of the row's parts has been moved, so its place without the move can be read back.
const moved = new WeakMap<Element, [number, number]>()
// A part's look in the fold: how far it's moved, for the row's parts that travel, how much of it
// shows, and for a row's head, how far round to its back it has turned as it docks (figure-head.tsx,
// LiveFigure); and how much of the whole card shows around its marked parts.
type Look = { x?: number; y?: number; o: number; turn?: number }
type FoldLook = { parts: Map<HTMLElement, Look>; fullO: number }
const glidesIn = (form: HTMLElement) => [...form.querySelectorAll<HTMLElement>("[data-fold-morph]")]
// A part marked to fade never takes a gliding part inside it along.
const fadesIn = (form: HTMLElement) => [...form.querySelectorAll<HTMLElement>("[data-fold-fade]")].filter((e) => !e.querySelector("[data-fold-morph]"))
const standInsIn = (form: HTMLElement) => [...form.querySelectorAll<HTMLElement>("[data-fold-follows]")]
// Back to the whole card at rest, every style the fold set taken off.
function clearFold({ full, row }: FoldParts) {
  for (const e of [...glidesIn(full), ...glidesIn(row), ...fadesIn(full), ...fadesIn(row), ...standInsIn(row)]) {
    Object.assign(e.style, { transform: "", opacity: "" })
    e.style.removeProperty("--fold-turn")
    moved.delete(e)
  }
  Object.assign(full.style, { transform: "", opacity: "" })
  row.style.opacity = ""
}
// How the fold looks at p, above 0, as a finger scrubs it. It only reads the page.
function foldLook({ full, row, range }: FoldParts, p: number): FoldLook {
  const twin = (form: HTMLElement, e: HTMLElement) => form.querySelector<HTMLElement>(`[data-fold-morph="${e.dataset.foldMorph}"]`)
  const scale = zoomOf(full)
  // The whole card moves as one, so a part's place from its top holds wherever it's moved; the row
  // starts where the whole card does before moving, at the top of the box holding both.
  const fullBox = full.getBoundingClientRect()
  const both = (full.parentElement ?? full).getBoundingClientRect()
  const inFull = (e: HTMLElement) => {
    const r = e.getBoundingClientRect()
    return { x: (r.left - fullBox.left) / scale, y: (r.top - fullBox.top) / scale, h: r.height / scale }
  }
  const inRow = (e: HTMLElement) => {
    const r = e.getBoundingClientRect()
    const [mx, my] = moved.get(e) ?? [0, 0]
    return { x: (r.left - both.left) / scale - mx, y: (r.top - both.top) / scale - my, h: r.height / scale }
  }
  // How much of a part the window it scrolls in shows, from 0 to 1, or all of it outside one.
  const shown = (e: HTMLElement) => {
    const w = e.closest<HTMLElement>("[data-fold-window]")
    if (!w) return 1
    const r = e.getBoundingClientRect()
    const b = w.getBoundingClientRect()
    return Math.min(1, Math.max(0, (Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top)) / (r.height || 1)))
  }
  // A crew-list part and its twin in the row: dx and dy take the twin from the part's place to its
  // own, so the twin docks at the scroll -dy.
  const pairs = glidesIn(full).map((e) => {
    const t = twin(row, e)
    const a = inFull(e)
    const b = t && inRow(t)
    return { e, t, a, dx: b ? b.x - a.x : 0, dy: b ? b.y - a.y : 0, shown: shown(e) }
  })
  const docked = pairs.filter((g) => g.t)
  // The page has scrolled s into the fold. A twin's approach runs 0 to 1 over the dock pixels
  // before it docks. The docked row ends at dockLine, and this pilot's crew row starts at firstRow.
  const s = p * range
  const dockLine = Math.max(0, ...docked.map((g) => { const b = inRow(g.t!); return b.y + b.h }))
  const firstRow = Math.min(...docked.map((g) => g.a.y))
  const approach = (dy: number) => (p >= 1 ? 1 : smooth(1 - (-dy - s) / FOLD.dock))
  // Above this pilot's row, a part fades as it slides under the card's top edge, pad above the
  // whole card's top, over its own height, or edgeFade for a short one; below it, as it nears the
  // docked row. Fading out before the edge, so nothing showed cut, vanished it early once the edge
  // was the card's own (user, 2026-10-30).
  const clip = full.closest<HTMLElement>("[data-fold-clip]")
  const pad = clip ? (both.top - clip.getBoundingClientRect().top) / scale : 0
  const fading = (from: number, top: number, h: number) => smooth(from < firstRow ? (pad + top + h) / Math.max(h, FOLD.edgeFade) : (top - dockLine) / FOLD.edgeFade)
  const look = new Map<HTMLElement, Look>()
  for (const { e, t, a, dx, dy, shown } of pairs) {
    if (!t) {
      look.set(e, { o: fading(a.y, a.y - s, a.h) })
      continue
    }
    look.set(e, { o: 0 })
    const k = approach(dy)
    // As much of it shows as its window showed, and the rest comes in as it nears its place, but no
    // sooner than the fold's first dock pixels: a head scrolled out over the top of a scrolled list
    // is already at or past its place, and appeared there the moment the fold began (user,
    // 2026-10-30).
    look.set(t, { x: -dx * (1 - k), y: p >= 1 ? 0 : Math.max(0, -dy - s), o: shown + (1 - shown) * Math.min(k, smooth(s / FOLD.dock)), turn: t.dataset.foldMorph?.startsWith("head-") ? k : undefined })
  }
  // A crew row's words are gone by the time its head is halfway through its approach.
  for (const e of fadesIn(full)) {
    const { y, h } = inFull(e)
    const head = e.closest("li")?.querySelector<HTMLElement>("[data-fold-morph]")
    const g = head && docked.find((g) => g.e === head)
    look.set(e, { o: g ? 1 - smooth(approach(g.dy) * 2) : fading(y, y - s, h) })
  }
  for (const e of glidesIn(row).filter((e) => !twin(full, e))) look.set(e, { o: smooth((p - 0.8) / 0.2) })
  // A badge rides its head, which carries it, and comes in as the head lands.
  for (const e of fadesIn(row)) {
    const key = e.closest<HTMLElement>("[data-fold-morph]")?.dataset.foldMorph
    const g = key ? docked.find((g) => g.e.dataset.foldMorph === key) : undefined
    look.set(e, { o: g ? smooth((approach(g.dy) - 0.6) / 0.4) : p >= 1 ? 1 : 0 })
  }
  // A part of the row standing in for a crew-list head it isn't the twin of, as the count of the
  // crew the row has no room for stands in for the first head left out, fades in at its own place
  // when that head would have docked there, rather than with the last head that docks, which read
  // as early. It isn't a pilot, so it doesn't fly in from a pilot's row (user, 2026-10-30). The
  // head itself stays in the list, fading with its row.
  for (const e of standInsIn(row)) {
    const o = full.querySelector<HTMLElement>(`[data-fold-morph="${e.dataset.foldFollows}"]`)
    look.set(e, { o: o ? Math.min(approach(inRow(e).y - inFull(o).y), smooth(s / FOLD.dock)) : p >= 1 ? 1 : 0 })
  }
  return { parts: look, fullO: p >= 1 ? 0 : 1 }
}
// Draws a look, with the whole card scrolled s into the fold.
function showLook({ full, row }: FoldParts, look: FoldLook, s: number) {
  Object.assign(full.style, { transform: `translateY(${-s}px)`, opacity: String(look.fullO) })
  row.style.opacity = "1"
  for (const [e, { x, y, o, turn }] of look.parts) {
    e.style.opacity = String(o)
    if (turn !== undefined) e.style.setProperty("--fold-turn", String(turn))
    if (x === undefined || y === undefined) continue
    moved.set(e, [x, y])
    e.style.transform = `translate(${x}px, ${y}px)`
  }
}
// The fold at p, as a finger scrubs it.
function drawFold(parts: FoldParts, p: number) {
  if (p <= 0) clearFold(parts)
  else showLook(parts, foldLook(parts, p), p * parts.range)
}
// Between two looks at q, from 0 to 1, for a fold the page animates rather than a finger scrubs, as
// one motion rather than the scrub's sequence played fast, which read as a million things jumping
// into place (user, 2026-10-30): what travels goes straight to its place, every part together;
// what fades out does so over the first blendOut of the way, the whole card's words together; and
// what fades in over the last blendIn.
function blendLooks(a: FoldLook, b: FoldLook, q: number): FoldLook {
  const fade = (from: number, to: number) => from + (to - from) * (to < from ? smooth(q / FOLD.blendOut) : to > from ? smooth((q - 1 + FOLD.blendIn) / FOLD.blendIn) : 1)
  const parts = new Map<HTMLElement, Look>()
  for (const [e, from] of a.parts) {
    const to = b.parts.get(e) ?? from
    const glides = from.x !== undefined && from.y !== undefined && to.x !== undefined && to.y !== undefined
    const turn = from.turn !== undefined && to.turn !== undefined ? from.turn + (to.turn - from.turn) * q : undefined
    parts.set(e, { x: glides ? from.x! + (to.x! - from.x!) * q : undefined, y: glides ? from.y! + (to.y! - from.y!) * q : undefined, o: fade(from.o, to.o), turn })
  }
  return { parts, fullO: fade(a.fullO, b.fullO) }
}

// The loaded aircraft on top, since a session flies the host's aircraft, then Host and the code
// field to join with. Selecting the code field fills it from the clipboard and joins at once
// (record/areas/product/03-v1-scope.md, Invite code), so the field stays in view. Host, the code
// field, and Join are marked data-figure-target, which the figure locks on to; Host is also
// data-host, which it looks at by default; and Host and Join are data-figure-press, a press on which
// winds it up. A disabled button takes no pointer events, so the figure ignores Join until the code is
// whole.
// While our servers answer, the button that asked shows it's busy and the code field is locked, and
// a refusal, or the line for an attempt taking long, opens under the control that asked: Host, or
// the code. Once Host or Join succeeds, the card turns to the session, the one hosted or the one
// joined, which has no use for the aircraft, and Leave turns it back; a frame can open on a session,
// and move on to another a while later, such as a crewmate joining, or preflight starting. In
// preflight, the pilot's checklist sits under the card until the flight starts, and scrolling it
// folds the card to a row (FOLD); a frame can open folded.
function StartCard({ aircraft, servers = "answering", play, session, next, opensFolded }: { aircraft: Aircraft; servers?: Servers; play?: Action; session?: SessionKey; next?: NextSession; opensFolded?: boolean }) {
  const { Badge, Button, Card, CardContent, Separator, Spinner, InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } = useUI()
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [code, setCode] = useState("")
  const codeNow = useRef("")
  codeNow.current = code
  const hostButton = useRef<HTMLButtonElement>(null)
  const joinButton = useRef<HTMLButtonElement>(null)
  const working = status.kind === "busy" || status.kind === "done"

  // An attempt's timers: its slow line's, and the fake servers' answers. A new attempt or Cancel
  // clears them, so a timer from an attempt before can't reach this one.
  const timers = useRef<number[]>([])
  const stop = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  useEffect(() => stop, [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
  useEffect(() => {
    if (next) later(next.after, () => setShown(next.session))
    // It plays once, from the frame's opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const busy =(change: { dialing?: boolean; slow?: boolean }) => setStatus((s) => (s.kind === "busy" ? { ...s, ...change } : s))

  // The card turns between the aircraft with Host and Join, and the session, as the guide's pages
  // turn: the side it leaves fades out, then the next fades in, rising 6px, as the card eases to
  // its height. The height is measured after every render while a turn eases it, and in the
  // session, since Coherent GT has no ResizeObserver; at rest on Host and Join, the card sets its
  // own, since a refusal's room eases open there and a measured height would clip it.
  const [half, setHalf] = useState<"start" | "session">(session ? "session" : "start")
  const [shown, setShown] = useState<SessionKey>(session ?? "alone")
  // A session that a frame moves on to can be in a flight already.
  const [started, setStarted] = useState(!!SESSIONS[shown].flight)
  const [startedFor, setStartedFor] = useState(shown)
  if (shown !== startedFor) {
    setStartedFor(shown)
    if (SESSIONS[shown].flight) setStarted(true)
  }
  useShowSession(half === "session")
  const checklist = half === "session" && !started ? SESSIONS[shown].preflight?.checklist : undefined
  const [foldedNow, setFoldedNow] = useState(false)
  const folded = foldedNow && !!checklist
  const phase = half === "session" ? phaseOf(SESSIONS[shown], started) : undefined
  useShowPhase(phase)
  const [turning, setTurning] = useState<"out" | "in" | null>(null)
  const turnTo = (next: "start" | "session") => {
    setTurning("out")
    later(TURN.out, () => {
      setHalf(next)
      setTurning("in")
    })
    later(TURN.out + HALF_EASE, () => setTurning(null))
  }
  const halfBox = useRef<HTMLDivElement>(null)
  const halfInner = useRef<HTMLDivElement>(null)
  const [halfHeight, setHalfHeight] = useState<number>()
  // A room in the session that starts to ease, such as the countdown's, re-renders only itself, so
  // it says so, and the card measures again, to the height the room is easing to, and eases with it.
  const [, remeasure] = useState(0)
  useEffect(() => {
    const box = halfBox.current
    const again = () => remeasure((n) => n + 1)
    box?.addEventListener(EASE_EVENT, again)
    return () => box?.removeEventListener(EASE_EVENT, again)
  }, [])
  useLayoutEffect(() => {
    const inner = halfInner.current
    const h = turning === "out" ? halfBox.current?.offsetHeight : (turning === "in" || half === "session") && inner ? inner.offsetHeight + stillEasing(inner) : undefined
    if (h !== halfHeight) setHalfHeight(h)
  })
  // Leave turns back to Host and Join, the code cleared; leaving needs no answer from our servers.
  const leave = () => {
    stop()
    setStatus({ kind: "idle" })
    setCode("")
    setStarted(false)
    turnTo("start")
  }

  const attempt = (on: Action, from: HTMLElement) => {
    stop()
    from.dispatchEvent(new CustomEvent("figure-attempt", { bubbles: true }))
    setStatus({ kind: "busy", on })
    later(SLOW_AFTER, () => busy({ slow: true }))
    const answer = (why?: Refusal) => {
      from.dispatchEvent(new CustomEvent("figure-answer", { bubbles: true, detail: { ok: !why } }))
      setStatus(why ? { kind: "refused", on, why } : { kind: "done", on })
      if (!why)
        later(SESSION_AFTER, () => {
          setShown(on === "host" ? "alone" : "joined")
          turnTo("session")
        })
    }
    if (servers === "offline") later(OFFLINE_ANSWER_AFTER, () => answer("offline"))
    else if (servers === "refusing") later(ANSWER_AFTER, () => answer(on === "host" ? "servers" : "no-code"))
    else if (servers === "answering") later(ANSWER_AFTER, () => answer())
    else if (on === "host") later(SLOW_ANSWER_AFTER, () => answer())
    else later(ANSWER_AFTER, () => busy({ dialing: true }))
  }
  const join = (from: HTMLElement) => codeNow.current.length === 6 && attempt("join", from)
  // Cancel stops the attempt here alone: a joiner registers with our servers only once it reaches
  // the crew, and a session they start for a canceled host after all lapses, since nobody renews
  // it. The code stays.
  const cancel = (from: HTMLElement) => {
    stop()
    from.dispatchEvent(new CustomEvent("figure-cancel", { bubbles: true }))
    setStatus({ kind: "idle" })
  }

  // A frame asked to play hosting or joining plays it a moment after it opens: for a join it types
  // the demo code, and then it presses its button and lets go on it, as a pilot's click does.
  useEffect(() => {
    if (!play) return
    const timers: number[] = []
    const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms))
    const click = (at: number, button: () => HTMLButtonElement | null, act: (b: HTMLElement) => void) => {
      later(at, () => button()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })))
      later(at + 300, () => {
        const b = button()
        if (!b) return
        b.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
        act(b)
      })
    }
    if (play === "host") click(1400, () => hostButton.current, (b) => attempt("host", b))
    else {
      DEMO_CODE.split("").forEach((_, i) => later(900 + i * 110, () => setCode(DEMO_CODE.slice(0, i + 1))))
      click(1900, () => joinButton.current, (b) => join(b))
    }
    return () => timers.forEach(clearTimeout)
    // It plays once, from the frame's opening; each play button opens the frame afresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A refused join clears when the code is edited; a code that names no session marks its slots.
  const refusedOn = (on: Action) => (status.kind === "refused" && status.on === on ? status.why : undefined)
  const joinRefused = refusedOn("join") !== undefined
  const badCode = refusedOn("join") === "no-code"
  // Under each control, its refusal, or its slow line, which names the host once a join is dialing.
  const under = (on: Action) => {
    const why = refusedOn(on)
    if (why) return <Refused why={why} />
    if (status.kind === "busy" && status.on === on && status.slow)
      return <SlowLine text={status.dialing ? `Still trying to reach ${DEMO_HOST}…` : "This is taking longer than usual."} onCancel={cancel} />
  }
  // Before a session, the card never shrinks, so the notes below are what gives way on a full page.
  // In a session the page ends at the card, with the PF's checklist under it in preflight, and the
  // two can run past the page, so they scroll as one, out through the page's side and bottom padding
  // to the window's edge and the tab bar, with dragging and no scrollbar, as the aircraft picker
  // has. The card stays pinned at the top while the checklist scrolls under it, so Ready and the
  // countdown never scroll away; it carries the page's background across the page's side
  // padding, so nothing under it shows past its edges, and a fade under it once anything has gone
  // under. A fade at the bottom says there's more below. The card's edge is a ring drawn outside
  // its box, which the scroller would clip at the top, so the scroller starts 1px higher and pads
  // that 1px back; the pinned card then sticks below that 1px, so its background reaches up over
  // it with a shadow, or what scrolls under the card showed through as a line (user, 2026-10-30).
  // The card's ring draws over that shadow.
  // Pinned whole, the card can leave the checklist a row's room, so it folds to its row as the
  // checklist scrolls (FOLD). A checklist that runs past the page by less than the fold gets room
  // under it to make up the rest, so the card can always fold all the way. The pill on its edge
  // shows while the page can scroll. The fade under the card shows once anything has gone under the
  // folded card.
  // A drag let go of coasts on (useScroller), and where the coast would end inside the fold, it
  // lands on the nearer form instead, from the speed it was let go at, so a flick folds or unfolds
  // the whole way and a slow release goes back to where it was nearest. A drag draws the fold in the
  // same frame as it scrolls.
  const scroller = useScroller({ settleAt: (end) => settleFold(end), onMove: () => foldFromScroll(), onMotion: (to) => blendTo(to), onLift: () => snapLater() })
  const scrolls = half === "session"
  const canFold = !!checklist && (scroller.above || scroller.below)
  const spacer = useRef<HTMLDivElement>(null)
  const listBox = useRef<HTMLDivElement>(null)
  const foldBox = useRef<HTMLDivElement>(null)
  const chevron = useRef<SVGSVGElement>(null)
  const fold = useRef(0)
  const [goneUnder, setGoneUnder] = useState(false)
  const [pad, setPad] = useState(0)
  const openFolded = useRef(!!opensFolded)
  const snapTimer = useRef(0)
  const unfoldFrame = useRef(0)
  useEffect(
    () => () => {
      cancelAnimationFrame(unfoldFrame.current)
      clearTimeout(snapTimer.current)
    },
    []
  )
  // Draws the card at fold p: its parts, its height, and the room under it that keeps the page's
  // height. The pill's chevron turns over as the fold passes halfway, pointing the way the pill
  // would take it, since one turned partway, as the fold left it, read as broken.
  // A fold the page animates, a glide or a coast, or the flight's start unfolding the card, blends
  // from how it looked when it set off to how it looks where it's going (blendLooks), by how far
  // through the fold it's come; one a press or a wheel stops goes back to being scrubbed. From here
  // to where it's going: s0 and sT, in the fold's own pixels, the page scrolled past it counting as
  // its end.
  const blend = useRef<{ s0: number; sT: number; from: FoldLook; to: FoldLook } | null>(null)
  const blendBetween = (s0: number, sT: number) => {
    blend.current = null
    const parts = foldParts(halfInner.current)
    if (!parts || parts.range <= 0) return
    const from = Math.min(Math.max(s0, 0), parts.range)
    const to = Math.min(Math.max(sT, 0), parts.range)
    if (Math.abs(to - from) < 1) return
    // Just past 0, where the row's parts stand in for the list's, in their places.
    const look = (s: number) => foldLook(parts, Math.max(s / parts.range, 0.001))
    blend.current = { s0: from, sT: to, from: look(from), to: look(to) }
  }
  const blendTo = (to: number | null) => {
    if (to === null || !checklist) blend.current = null
    else blendBetween(scroller.ref.current?.scrollTop ?? 0, to)
  }
  const showFold = (p: number) => {
    fold.current = p
    const parts = foldParts(halfInner.current)
    const b = blend.current
    if (parts && b) {
      const q = Math.min(1, Math.max(0, (p * parts.range - b.s0) / (b.sT - b.s0)))
      if (q >= 1) blend.current = null
      else showLook(parts, blendLooks(b.from, b.to, q), p * parts.range)
    }
    if (parts && !blend.current) drawFold(parts, p)
    const shrink = parts ? p * parts.range : 0
    if (foldBox.current) foldBox.current.style.height = shrink ? `${(halfBox.current?.offsetHeight ?? 0) - shrink}px` : ""
    if (spacer.current) spacer.current.style.height = shrink ? `${shrink}px` : ""
    listBox.current?.style.setProperty("--list-shown", String(LIST_DIM + (1 - LIST_DIM) * p))
    if (chevron.current) Object.assign(chevron.current.style, { transform: p >= 0.5 ? "none" : "rotate(180deg)", transition: "transform 200ms ease-out" })
    setFoldedNow(p >= 1)
  }
  const foldFromScroll = () => {
    const s = scroller.ref.current
    const parts = foldParts(halfInner.current)
    if (!s || !checklist || !parts || parts.range <= 0) return
    // Within a pixel of either end is that end: a zoomed page's scroll stops on a fraction short of
    // it, 280.4 of 281 at 223%, which left the card never quite folded.
    const top = s.scrollTop
    const p = top < 1 ? 0 : top > parts.range - 1 ? 1 : top / parts.range
    showFold(p)
    setGoneUnder(s.scrollTop > parts.range + 1)
    return { p, range: parts.range }
  }
  // Where a coast that would end at end lands instead: inside the fold, on its nearer form.
  const settleFold = (end: number) => {
    const parts = foldParts(halfInner.current)
    if (!checklist || !parts || end < 1 || end > parts.range - 1) return undefined
    return end < parts.range / 2 ? 0 : parts.range
  }
  // A wheel, or a key, leaves no letting go, so a fold it leaves partway finishes once the scroll
  // has rested snapAfter, toward the way it was going: a wheel turned down and stopped meant to
  // fold, wherever it stopped.
  const lastTop = useRef(0)
  const heading = useRef(0)
  const onScroll = () => {
    scroller.onScroll()
    const s = scroller.ref.current
    if (s && s.scrollTop !== lastTop.current) {
      heading.current = Math.sign(s.scrollTop - lastTop.current)
      lastTop.current = s.scrollTop
    }
    snapLater()
  }
  // A finger lifted inside the fold, on a phone, finishes it the same way once the page has rested.
  const snapLater = () => {
    const at = foldFromScroll()
    clearTimeout(snapTimer.current)
    if (!at || scroller.moving() || at.p <= 0 || at.p >= 1) return
    snapTimer.current = window.setTimeout(() => {
      if (!scroller.moving()) scroller.glideTo(heading.current > 0 ? at.range : 0)
    }, FOLD.snapAfter)
  }
  // The flight starting takes the checklist away, and a folded card unfolds by itself, over ms;
  // a card turning back to Host and Join drops its fold at once, unseen.
  const unfoldByTime = () => {
    const from = fold.current
    const parts = foldParts(halfInner.current)
    if (parts) blendBetween(from * parts.range, 0)
    let start: number | undefined
    const step = (now: number) => {
      if (start === undefined) start = now
      const t = Math.min(1, (now - start) / FOLD.ms)
      showFold(from * (1 - easeOut(t)))
      unfoldFrame.current = t < 1 ? requestAnimationFrame(step) : 0
    }
    unfoldFrame.current = requestAnimationFrame(step)
  }
  // After every render, since what it measures can change with any of them: the room under the
  // checklist, a frame that opens folded, and the fold at the page's scroll.
  useLayoutEffect(() => {
    const s = scroller.ref.current
    const parts = foldParts(halfInner.current)
    if (!s || !checklist || !parts || parts.range <= 0) {
      if (pad) setPad(0)
      if (fold.current > 0 && !unfoldFrame.current) {
        if (parts) unfoldByTime()
        else showFold(0)
      }
      return
    }
    const natural = s.scrollHeight - pad - s.clientHeight
    const want = natural > 1 ? Math.max(0, Math.ceil(parts.range - natural)) : 0
    if (want !== pad) {
      setPad(want)
      return
    }
    if (openFolded.current && s.scrollHeight - s.clientHeight >= parts.range) {
      openFolded.current = false
      s.scrollTop = parts.range
    }
    foldFromScroll()
  })
  const fade = (to: "top" | "bottom", shown: boolean): React.CSSProperties => ({ background: `linear-gradient(to ${to === "top" ? "bottom" : "top"}, var(--background), transparent)`, opacity: shown ? 1 : 0 })
  return (
    // The card's padding matches the page's 20px, where Luma's default card spacing is 24px.
    // It sits above what's under it, so the figure's canvas can stay put as the card grows down over
    // its empty top. The card's parts sit inside the part that turns, which spaces them as the
    // card's own gap would.
    <div className={"relative flex flex-col " + (scrolls ? "-mx-5 -mt-px -mb-5 min-h-0" : "shrink-0")}>
    <div
      ref={scroller.ref}
      onScroll={onScroll}
      onWheel={scrolls ? scroller.onWheel : undefined}
      onTouchStart={scrolls ? scroller.onTouchStart : undefined}
      onTouchEnd={scrolls ? scroller.onTouchEnd : undefined}
      onTouchCancel={scrolls ? scroller.onTouchEnd : undefined}
      onMouseDown={scrolls ? scroller.onMouseDown : undefined}
      className={
        "flex flex-col gap-5 " +
        (scrolls ? "min-h-0 overflow-y-auto px-5 pt-px pb-5 select-none " + NO_SCROLLBAR + " " + scroller.cursor : "")
      }
      // The room under a checklist that runs past the page by less than the fold, on top of the
      // page's 20px. The page's height never changes as the card folds, so the browser has nothing
      // to keep in view by moving the scroll.
      style={scrolls ? { paddingBottom: pad ? `calc(var(--spacing) * 5 + ${pad}px)` : undefined, overflowAnchor: "none" } : undefined}
    >
    <div className={"flex shrink-0 flex-col " + (scrolls ? "pin-top z-20 -mx-5 bg-background px-5 shadow-[0_-1px_0_var(--background)]" : "")}>
    {/* Only once something has gone under the folded card: hanging below it, inside the part that
        scrolls, the fade would otherwise make a short page scroll by its overhang. */}
    {scrolls && goneUnder && <div className="pointer-events-none absolute top-full right-0 left-0 h-6" style={fade("top", true)} />}
    {/* The card's padding sits inside the part that turns: at the bottom, so something reaching into
        it, as the differences' folded row does, isn't cut off by the part's own edge; and at the
        top, so what the fold scrolls up slides under the card's own edge, rather than being cut
        across a band of empty card (user, 2026-10-30). The fold sets the outer box's height; turns
        and rooms set the inner one's. */}
    <Card className="relative z-10 shrink-0 [--card-spacing:--spacing(5)]" style={{ paddingTop: 0, paddingBottom: 0 }}>
      <div ref={foldBox} data-fold-clip className="overflow-hidden">
      <div ref={halfBox} className="overflow-hidden transition-[height] ease-out" style={{ height: halfHeight, transitionDuration: `${HALF_EASE}ms` }}>
        <div
          ref={halfInner}
          key={half}
          className={"flex flex-col gap-(--card-spacing) py-(--card-spacing) " + (turning === "in" ? "animate-in fade-in slide-in-from-bottom-[6px]" : "")}
          style={{ animationDuration: `${TURN.in}ms`, opacity: turning === "out" ? 0 : 1, transition: `opacity ${TURN.out}ms ease-out` }}
        >
          {half === "session" ? (
            <SessionHalf session={SESSIONS[shown]} started={started} folded={folded} onStarted={() => setStarted(true)} onLeave={leave} />
          ) : (
            <>
            <CardContent className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Label>{aircraft.maker}</Label>
                <span className="truncate text-lg leading-tight font-semibold">{aircraft.model}</span>
                <span className="text-xs text-muted-foreground">{aircraft.tail}</span>
              </div>
              {aircraft.maturity ? <Badge variant={aircraft.maturity === "Stable" ? "secondary" : "outline"}>{aircraft.maturity}</Badge> : <StatusChip level="warning">Not supported yet</StatusChip>}
            </CardContent>
            <Separator />
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col">
                <Button ref={hostButton} size="lg" className="w-full" data-host data-figure-target data-figure-press disabled={working} onClick={(e: React.MouseEvent<HTMLElement>) => attempt("host", e.currentTarget)}>
                  {status.kind === "busy" && status.on === "host" ? (
                    <>
                      <Spinner data-icon="inline-start" /> Starting your session…
                    </>
                  ) : status.kind === "done" && status.on === "host" ? (
                    <>
                      <Check data-icon="inline-start" /> Session started
                    </>
                  ) : (
                    "Host a session"
                  )}
                </Button>
                <EaseRoom>{under("host")}</EaseRoom>
              </div>
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or join with a code</span>
                <Separator className="flex-1" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center justify-between gap-3">
                  <div data-figure-target onKeyDown={(e) => e.key === "Enter" && join(e.currentTarget)}>
                    <InputOTP
                      maxLength={6}
                      value={code}
                      disabled={working}
                      onChange={(v: string) => {
                        setCode(v.toUpperCase())
                        if (joinRefused) setStatus({ kind: "idle" })
                      }}
                    >
                      <InputOTPGroup>
                        {[0, 1, 2].map((i) => (
                          <InputOTPSlot key={i} index={i} className={"font-mono " + (badCode ? "border-destructive/60" : "")} />
                        ))}
                      </InputOTPGroup>
                      <InputOTPSeparator />
                      <InputOTPGroup>
                        {[3, 4, 5].map((i) => (
                          <InputOTPSlot key={i} index={i} className={"font-mono " + (badCode ? "border-destructive/60" : "")} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  <Button ref={joinButton} variant="outline" disabled={code.length < 6 || working} data-figure-target data-figure-press onClick={(e: React.MouseEvent<HTMLElement>) => join(e.currentTarget)}>
                    {status.kind === "busy" && status.on === "join" ? <Spinner /> : status.kind === "done" && status.on === "join" ? <Check /> : "Join"}
                  </Button>
                </div>
                <EaseRoom>{under("join")}</EaseRoom>
              </div>
            </CardContent>
            </>
          )}
        </div>
      </div>
      </div>
    </Card>
    {/* A pill, 48 by 24px, reads as a handle to grab, as a phone's sheet grabber does, which suits
        a fold that follows the scroll, and is wider to hit with a mouse in the sim (user,
        2026-10-31; tried and dropped: a 28px circle, which read as a button that flips). Centered on
        the card's bottom edge by its offsets, without the translate property, which Coherent GT
        drops (record/areas/architecture/coherent-gt.md). It's sky, the app's color for what can be
        pressed, on the card's own color, its fill held on hover. Its edge is drawn inside it, since
        a translucent ring outside would tint the card's half and the page's half differently. In
        dark, the card's 10% ring over the page comes out the same gray as 5% over the card's
        lighter fill, so the pill's edge is 5% in both themes. */}
    {canFold && (
      <Button
        variant="outline"
        size="icon-sm"
        className="absolute -bottom-3 left-1/2 z-30 -ml-6 h-6 w-12 rounded-full border-0 bg-card text-primary inset-ring-1 inset-ring-foreground/5 hover:bg-card hover:text-primary dark:bg-card dark:hover:bg-card"
        aria-label={folded ? "Show the whole session card" : "Fold the session card"}
        onClick={() => scroller.glideTo(fold.current >= 0.5 ? 0 : (foldParts(halfInner.current)?.range ?? 0))}
      >
        {/* One chevron, turning with the fold (showFold). */}
        <ChevronDown ref={chevron} />
      </Button>
    )}
    </div>
    {/* The room the folding card leaves, so the page below keeps its place. It's apart from the
        pinned card, which a page pins only while there's at least its height left below it: a card
        carrying the room itself, 1489px with a crew of 14, was pushed off the top once folded. Its
        top margin takes back the page's gap before it. */}
    {scrolls && <div ref={spacer} aria-hidden className="-mt-5 shrink-0" />}
    {/* For every pilot, what preflight's rule asks for, between the card and the checklist, so it
        shows whether or not their profile gives them one (record/areas/product/03-v1-scope.md,
        Preflight, Rules): catch-up sets only what the profile holds, so a display a PM pages through
        now keeps that page, and the PF's counted controls count from where the aircraft starts
        them. */}
    {half === "session" && !started && SESSIONS[shown].preflight && (
      <p className="flex shrink-0 items-start gap-2 text-sm text-info">
        <Hand className="mt-0.5 size-4 shrink-0" />
        Avoid unnecessary cockpit interactions until the flight starts, as some may not sync.
      </p>
    )}
    {/* The checklist, its title and words with it, stays dim while the whole card shows, so a pilot
        new to the page takes in the crew and Ready first, and comes up to full as the card folds
        and the pilot scrolls into the list (user, 2026-10-30). A pointer on it, or the keyboard
        in it, brings it up at once, so it never reads as disabled, and a list short enough that the
        card never folds can still be worked at full. A click leaves its row focused, so only
        keyboard focus counts, or the list stayed lit after the pointer left. Tried and dropped:
        dimming the names, dots, and descriptions apart, the values left bright. */}
    {checklist && (
      <div ref={listBox} className="flex shrink-0 flex-col opacity-(--list-shown) transition-opacity duration-200 hover:opacity-100 has-focus-visible:opacity-100" style={{ "--list-shown": LIST_DIM } as React.CSSProperties}>
        <Checklist items={checklist} />
      </div>
    )}
    </div>
    {scrolls && <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-20 h-8 transition-opacity duration-200" style={fade("bottom", scroller.below)} />}
    </div>
  )
}

// The guide's pages before the aircraft check, in the user's words.
const GUIDE = [
  {
    title: "Flying together",
    body: "One of you hosts and shares their invite code, and others enter it to join. You each spawn into the same aircraft, preferably cold and dark, and Dual Input keeps you in sync.",
  },
  {
    title: "Who flies",
    body: "The host starts as the pilot flying: their yoke, rudder, and throttles move the aircraft. You both work the switches, knobs, and displays. Others can take over as pilot flying at any time (see Settings for keybinds).",
  },
  {
    title: "Preflight",
    body: "The Preflight phase lines everyone up before anything moves. Dual Input flags deal breakers between your setups and presents any checklist items from profile authors to help avoid sync issues.",
  },
  {
    title: "Profiles",
    body: "Profile files tell Dual Input which switches, knobs, and displays to sync and how. They are mostly built by community members. How well an aircraft is synced depends on the specific way an aircraft was built and how the profile handles it.",
  },
]
const PAGES = GUIDE.length + 1
// How long the guide takes to go once closed, and a page turn's two halves, in milliseconds.
const LEAVE_MS = 300
const TURN = { out: 110, in: 170 }

// The guide's last page: whether Dual Input supports the loaded aircraft, and when it doesn't, what
// a session still shares in it and the way to the aircraft it does support, the aircraft picker.
function AircraftCheck({ supported }: { supported: boolean }) {
  const [picking, setPicking] = useState(false)
  if (supported)
    return (
      <>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <CircleCheck className="size-4 shrink-0 text-success" />
          This aircraft is supported
        </h3>
        <p className="text-sm text-muted-foreground">Click Host above and share the invite code with someone to start flying together.</p>
      </>
    )
  return (
    <>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <TriangleAlert className="size-4 shrink-0 text-warning" />
        Dual Input doesn't support this aircraft yet
      </h3>
      <p className="text-sm text-muted-foreground">Cockpit state won't sync but you can still fly it together, sharing its position, who's flying, traffic, and ATC.</p>
      <p className="pt-3 text-sm text-muted-foreground">
        Alternatively, switch to a <InlineLink onClick={() => setPicking(true)}>supported aircraft</InlineLink>, or try your hand at building a profile for it (<InlineLink>see how</InlineLink>).
      </p>
      <AircraftPicker open={picking} onOpenChange={setPicking} />
    </>
  )
}

// What a session still does in an aircraft Dual Input has no profile for, in the user's words:
// everything but the cockpit's state, which takes a profile.
const SHARED_UNSUPPORTED = ["Share flight and physics", "Pass control between each other", "Share Traffic and ATC"]

// Home on a later visit in an aircraft Dual Input has no profile for: what a session still does
// there, as a list, then the two ways forward as text buttons, as Continue anyway is in setup, one
// below the other under their own lead-in. Each lead-in sits close over what it leads to.
// Switching opens the aircraft picker. Learning to build a profile is to open the pilot's browser,
// so its button says it leaves the app, but the page it opens doesn't exist yet, so it's disabled
// until it does, and its tooltip says it's coming soon.
function UnsupportedAircraft() {
  const { Button, Tooltip, TooltipContent, TooltipTrigger } = useUI()
  const [picking, setPicking] = useState(false)
  const leadIn = (text: string) => <p className="text-sm text-muted-foreground">{text}</p>
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <TriangleAlert className="size-4 shrink-0 text-warning" />
          Dual Input has no profile for this aircraft yet
        </h3>
        {leadIn("You can still fly together and:")}
        <ul className="flex flex-col gap-2 pt-1 text-sm">
          {SHARED_UNSUPPORTED.map((what) => (
            <li key={what} className="flex items-center gap-3">
              <Check className="size-4 shrink-0 text-success" />
              {what}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col items-start gap-1.5">
        {leadIn("Other options:")}
        {/* A second list, anchored as the first is: an icon in the checks' column, and their
            rhythm, 8px between lines and 10px under the lead-in. Each link reaches 4px above and
            below its text, so for a VR pointer, which wavers, the two are 28px targets that meet. */}
        <div className="flex flex-col items-start">
          <Button variant="link" className="h-auto gap-3 border-0 px-0 py-1" onClick={() => setPicking(true)}>
            <ArrowRightLeft className="size-4" />
            Switch to a supported aircraft
          </Button>
          {/* Disabled until its page exists. A disabled button takes no pointer events, so the
              tooltip saying why hangs on a wrapper around it. */}
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button variant="link" disabled className="h-auto gap-3 border-0 px-0 py-1">
                <BookOpen className="size-4" />
                <span className="flex items-center gap-1.5">
                  Learn how to build a profile <ExternalLink className="size-3.5" />
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <AircraftPicker open={picking} onOpenChange={setPicking} />
    </section>
  )
}

// The welcome text's place on a pilot's first visit: three pages on how a session works, then the
// aircraft check. Done and Skip guide close it for good, leaving the start card alone, as home is
// on later visits. It says when it starts to leave, and when it's gone.
function WelcomeGuide({ supported, startAt = 0, onLeave, onClose }: { supported: boolean; startAt?: number; onLeave: () => void; onClose: () => void }) {
  const { Button, Card, CardContent } = useUI()
  const [page, setPage] = useState(startAt)
  const [back, setBack] = useState(false)
  // The card eases to the page's height. Coherent GT has no ResizeObserver, so the height is
  // measured after every render, which also catches a page whose content changes while it shows,
  // such as the aircraft check when the pilot loads another aircraft.
  const content = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const measured = content.current?.offsetHeight
    if (measured !== undefined && measured !== height) setHeight(measured)
  })
  const last = page === PAGES - 1
  // A turn hands over: the page it leaves stays a moment and fades out, then the new one fades in,
  // so the text never cuts, and never shows two pages at once, which read as trippy. Each drifts
  // 6px the way the turn goes. A timer clears the old page, as one ends the guide, and a quicker
  // turn takes the place of one still under way.
  const [from, setFrom] = useState<{ page: number; back: boolean } | null>(null)
  const turned = useRef<number>(undefined)
  const [hasTurned, setHasTurned] = useState(false)
  const go = (to: number) => {
    if (to === page) return
    setHasTurned(true)
    setFrom({ page, back: to < page })
    setBack(to < page)
    setPage(to)
    window.clearTimeout(turned.current)
    turned.current = window.setTimeout(() => setFrom(null), TURN.out)
  }
  useEffect(() => () => window.clearTimeout(turned.current), [])
  // What arrives with a turn waits, unseen, for the old page to go; the first page needs no wait.
  // The wait turns on whether the guide has turned at all, not on the old page still showing,
  // since changing a running animation's delay would jump it ahead.
  const turnIn: React.CSSProperties = { animationDuration: `${TURN.in}ms`, animationDelay: hasTurned ? `${TURN.out}ms` : "0ms", animationFillMode: "backwards" }
  const body = (p: number) =>
    p === PAGES - 1 ? (
      <AircraftCheck supported={supported} />
    ) : (
      <>
        <h3 className="text-base font-semibold">{GUIDE[p].title}</h3>
        <p className="text-sm text-muted-foreground">{GUIDE[p].body}</p>
      </>
    )
  // Closing, it sinks and fades the way it rose, and goes once that's over. A timer ends it rather
  // than the animation's end event, so it goes even where that event never comes.
  const [leaving, setLeaving] = useState(false)
  const close = () => {
    if (leaving) return
    setLeaving(true)
    onLeave()
    window.setTimeout(onClose, LEAVE_MS)
  }
  const title = (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold">Welcome to Dual Input</h2>
      {!last && (
        <Button variant="link" className="h-auto border-0 p-0 text-muted-foreground" onClick={close}>
          Skip guide
        </Button>
      )}
    </div>
  )
  const pageView = (
    <div className="overflow-hidden transition-[height] duration-300 ease-out" style={{ height }}>
      <div ref={content} className="relative">
        {/* Keyed by page, so each page drifts in from the side it comes from. Pages before the
            check share one height, the longest's, so the buttons stay put between them. The page
            being left lies over it, out of the flow, so the card eases to the new page's height. */}
        <div key={page} className={"flex min-h-28 animate-in flex-col gap-1.5 px-5 fade-in " + (back ? "slide-in-from-left-[6px]" : "slide-in-from-right-[6px]")} style={turnIn}>
          {body(page)}
        </div>
        {from && (
          <div
            key={`from-${from.page}`}
            aria-hidden
            className={"pointer-events-none absolute top-0 right-0 left-0 flex min-h-28 animate-out flex-col gap-1.5 px-5 fade-out " + (from.back ? "slide-out-to-right-[6px]" : "slide-out-to-left-[6px]")}
            style={{ animationDuration: `${TURN.out}ms`, animationFillMode: "forwards" }}
          >
            {body(from.page)}
          </div>
        )}
      </div>
    </div>
  )
  // The dots sit near the row's bottom edge, 24px from the bottom and 20px from the left.
  const controls = (
    <>
      <div className="mb-1 flex items-center gap-1.5">
        {Array.from({ length: PAGES }, (_, i) => (
          <button
            key={i}
            aria-label={`Page ${i + 1} of ${PAGES}`}
            onClick={() => go(i)}
            className={"h-1.5 rounded-full transition-all " + (i === page ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground")}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        {/* Back fades in with the second page, as the pages do. */}
        {page > 0 && (
          <Button variant="ghost" className="animate-in fade-in" style={turnIn} onClick={() => go(page - 1)}>
            Back
          </Button>
        )}
        <Button variant="secondary" onClick={() => (last ? close() : go(page + 1))}>
          {last ? "Done" : "Next"}
        </Button>
      </div>
    </>
  )
  return (
    // It rises in a beat after the page appears, so the eye lands on it once.
    <section
      className={"flex flex-col gap-3 " + (leaving ? "pointer-events-none animate-out fade-out slide-out-to-bottom-4" : "animate-in duration-500 fade-in slide-in-from-bottom-4")}
      style={leaving ? { animationDuration: `${LEAVE_MS}ms`, animationFillMode: "forwards" } : { animationDelay: "400ms", animationFillMode: "backwards" }}
    >
      {title}
      <Card className="relative [--card-spacing:--spacing(5)]">
        {/* A sky flap in the top-left corner, cut by the card's rounded corner, with a shadow along
            its fold. */}
        <span className="pointer-events-none absolute top-0 left-0 size-[22px]" style={{ background: "linear-gradient(135deg, var(--primary) 50%, transparent 50%)", filter: "drop-shadow(1px 1px 1px rgb(0 0 0 / 0.35))" }} />
        {pageView}
        <CardContent className="flex items-end justify-between gap-3">{controls}</CardContent>
      </Card>
    </section>
  )
}

// The profile authors' notes on the loaded aircraft, from the sketch, which a profile field after
// v1 carries; the page makes room for them now. The notes are examples. They look like something the
// authors slipped in: a slip of paper taped to the page, title included, written by hand.
const HAND: React.CSSProperties = { fontFamily: "Kalam, cursive", fontSize: 17, lineHeight: "28px" }
// Two inks: black for the notes and their dashes, and red pencil for the title and its underline.
const INK = { body: "#1c1b1a", title: "#a33a2c" }

const PAPER = "#cdc2a6"

// Example notes: a short set from the sketch, and a long one that runs past the page. Each is signed
// with the profile's `authors`, free text the profile format shows wherever it credits a profile,
// written as the authors wrote it; the names are hypothetical.
const NOTES = {
  short: {
    authors: "James Smith",
    lead: "Set the tablet's failure rate to 0 on every machine before you fly, since each sim rolls its own failures.",
    items: ["A pilot who joins late starts the ADF's elapsed timer at 0.", "The KNS-81's 10 waypoints don't sync, so enter them on each machine."],
  },
  long: {
    authors: "James Smith and Alex Doe",
    lead: "Set the tablet's failure rate to 0 on every machine before you fly, since each sim rolls its own failures. Start cold and dark on every machine, and let the pilot flying run the engine start.",
    items: [
      "A pilot who joins late starts the ADF's elapsed timer at 0.",
      "The KNS-81's 10 waypoints don't sync, so enter them on each machine.",
      "The GPS is a separate add-on, so every pilot needs the same version of it, and its flight plan doesn't sync: load the same plan on each machine.",
      "The cabin pressure controller follows the pilot flying's settings, so the other pilot's cabin altitude can lag by a second or two.",
      "The de-ice boots cycle on each machine's own timer, so their lights can blink out of step.",
      "The tablet's own pages don't sync, so each pilot sets up their own.",
    ],
  },
}

// The notes scroll inside the slip when they run past the page, under a title that stays put, and a
// fade at either end shows there's more that way.
function AuthorsNotes({ notes }: { notes: (typeof NOTES)["short"] }) {
  const { ref, onScroll, onMouseDown, onWheel, above, below, cursor } = useScroller()
  const fade = (to: "top" | "bottom", shown: boolean): React.CSSProperties => ({ background: `linear-gradient(to ${to === "top" ? "bottom" : "top"}, ${PAPER}, transparent)`, opacity: shown ? 1 : 0 })
  return (
    // Manila paper, turned a little off square, with a strip of tape at the top. It's darker than
    // white paper, so it doesn't outshine the dark page around it.
    <section className="relative mx-1 flex min-h-0 flex-col rounded-[2px] px-5 pt-3.5" style={{ ...HAND, background: PAPER, color: INK.body, transform: "rotate(-0.8deg)", boxShadow: "0 8px 18px rgb(0 0 0 / 0.4)" }}>
      <span className="absolute -top-2.5 left-1/2 h-5 w-20" style={{ background: "rgb(226 218 196 / 0.55)", transform: "translateX(-50%) rotate(2deg)", boxShadow: "0 1px 2px rgb(0 0 0 / 0.15)" }} />
      <h2 className="relative shrink-0 self-start font-bold" style={{ color: INK.title, fontSize: 19 }}>
        Notes from the profile authors
        {/* A quick, slightly uneven stroke under the title. */}
        <svg viewBox="0 0 100 6" preserveAspectRatio="none" fill="none" aria-hidden className="absolute bottom-0 left-0 h-1.5 w-full">
          <path d="M1 4C22 2.2 46 4.6 70 3C82 2.3 92 2.8 99 3.6" stroke={INK.title} strokeWidth={1.8} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </h2>
      {/* The 8px between the title and the notes, and the 16px under them, are the scroller's own
          padding, so they scroll away with the notes: the fades start right at the underline and
          the slip's bottom edge. */}
      <div className="relative flex min-h-0 flex-col">
        <div ref={ref} onScroll={onScroll} onMouseDown={onMouseDown} onWheel={onWheel} className={"min-h-0 overflow-y-auto pt-2 pb-4 select-none " + NO_SCROLLBAR + " " + cursor}>
          <p>{notes.lead}</p>
          <ul>
            {notes.items.map((note) => (
              <li key={note} className="relative pl-5">
                <span className="absolute left-0">–</span>
                {note}
              </li>
            ))}
          </ul>
          {/* The authors sign at the end, like a letter, and a profile with no authors leaves the
              line out. */}
          {notes.authors && <p className="mt-1 text-right">— {notes.authors}</p>}
        </div>
        <div className="pointer-events-none absolute top-0 right-0 left-0 h-12 transition-opacity duration-200" style={fade("top", above)} />
        <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-12 transition-opacity duration-200" style={fade("bottom", below)} />
      </div>
    </section>
  )
}

// A refusal from our servers, in the tinted box first-time setup's failures use, with the refusal's
// own action where it has one, which asks first, since restarting the sim ends the pilot's flight.
function Refused({ why }: { why: Refusal }) {
  const r: { title: string; detail: string; action?: { label: string; question: string; go: string } } = REFUSALS[why]
  return (
    <div className="flex animate-in flex-col gap-1 rounded-3xl border border-destructive/20 bg-destructive/10 px-5 py-4 duration-200 fade-in">
      <p className="text-sm font-medium text-destructive">{r.title}</p>
      <p className="text-sm text-foreground/75">{r.detail}</p>
      {r.action && (
        <div className="mt-2">
          <ConfirmButton
            label={r.action.label}
            question={r.action.question}
            align="start"
            go={r.action.go}
            onConfirm={() => toast("Restarting the sim to update")}
            className={RED_BUTTON}
          />
        </div>
      )}
    </div>
  )
}

// An attempt taking long: a line of text with Cancel at its end, and no box, since nothing has
// failed; the button that asked keeps its spinner.
function SlowLine({ text, onCancel }: { text: string; onCancel: (from: HTMLElement) => void }) {
  return (
    <p className="animate-in text-sm text-muted-foreground duration-200 fade-in">
      {text}{" "}
      <button className="font-medium text-primary underline-offset-4 hover:underline" onClick={(e) => onCancel(e.currentTarget)}>
        Cancel
      </button>
    </p>
  )
}

// A room that eases open for what comes and goes on a card: under a control for its refusal or slow
// line. It keeps 12px from what it follows while open. It opens nearly empty, easing to its content's
// height, and the content fades in as it finishes; to shut, the content fades out first, still
// showing what it had, and the room eases shut as it goes, so the room's edge doesn't cut across
// what it holds. The two overlap, since one after the other felt sluggish: the content starts when
// the room's ease-out has it about 80% open. Coherent GT has no ResizeObserver, so the height is
// measured after every render, as the guide's is, and an open room follows its content's height.
// A box around it that sets its own height from what it holds, as the session card's turning part
// does, would read the room's height mid-ease, so the room marks the height it's easing to and
// says when that changes (stillEasing).
// The room eases as long as the session card does (HALF_EASE), so a card growing around it keeps
// pace.
const ROOM = { ease: HALF_EASE, showAt: 160, in: 180, out: 120, shutAt: 80 }
function EaseRoom({ children }: { children?: React.ReactNode }) {
  const has = !!children
  const last = useRef(children)
  if (children) last.current = children
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  // A room that has its content from the start, as the differences' list in preflight, is open at
  // once: its own height first, unmarked for stillEasing, which the measure below then pins, the
  // same, so nothing eases.
  const [height, setHeight] = useState<number | undefined>(has ? undefined : 0)
  const [shown, setShown] = useState(has)
  useLayoutEffect(() => {
    if (!has) return
    const measured = inner.current?.offsetHeight ?? 0
    if (measured !== height) setHeight(measured)
  })
  useEffect(() => {
    if (has) {
      const t = window.setTimeout(() => setShown(true), ROOM.showAt)
      return () => clearTimeout(t)
    }
    setShown(false)
    const t = window.setTimeout(() => setHeight(0), ROOM.shutAt)
    return () => clearTimeout(t)
  }, [has])
  useLayoutEffect(() => {
    outer.current?.dispatchEvent(new CustomEvent(EASE_EVENT, { bubbles: true }))
  }, [height])
  return (
    <div ref={outer} data-ease-to={height} className="overflow-hidden transition-[height] ease-out" style={{ height, transitionDuration: `${ROOM.ease}ms` }}>
      <div ref={inner} className="pt-3">
        <div
          style={{
            opacity: shown ? 1 : 0,
            transform: shown ? "none" : "scale(0.97)",
            transition: shown ? `opacity ${ROOM.in}ms ease-out, transform ${ROOM.in}ms ease-out` : `opacity ${ROOM.out}ms ease-in, transform ${ROOM.out}ms ease-in`,
          }}
        >
          {last.current}
        </div>
      </div>
    </div>
  )
}
const EASE_EVENT = "ease-to"
// How much the rooms easing inside a box have still to grow, or to shrink where it's less than
// none, so the box can set the height it will have rather than the one it has mid-ease.
const stillEasing = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>("[data-ease-to]")].reduce((d, e) => d + Number(e.dataset.easeTo) - e.offsetHeight, 0)

// A supported aircraft whose profile has no notes leaves the page's rest to the pilot's figure,
// standing on the right, waiting for them to host; the guide and the start card's own words say
// how. The figure's color is an example.
function NoNotes() {
  const hex = FIGURE_COLORS.find((c) => c.name === "orange")!.hex
  return (
    <div className="relative flex min-h-0 flex-1 justify-end">
      {/* It runs through the page's bottom and right padding, to the tab bar and the window's edge,
          so the figure's legs leave the page at the tab bar rather than ending in the air, and what
          swings right as it falls leaves at the window's edge. */}
      <div className="relative -mr-5 -mb-5 w-[260px] shrink-0 self-stretch">
        <StandingFigure hex={hex} />
      </div>
    </div>
  )
}

// The start card for the loaded aircraft, and under it the page's rest; a frame's servers and play
// go to the card. A loaded aircraft with a maturity has a profile. The header shows what a frame
// says of our servers, the firewall, and an update, and a frame can open it.
function HomePage({ theme, aircraft, servers, play, header, headerOpen, core, session, next, opensFolded, children }: { theme: Theme; aircraft: Aircraft; servers?: Servers; play?: Action; header?: HeaderStatus; headerOpen?: boolean; core?: Core; session?: SessionKey; next?: NextSession; opensFolded?: boolean; children: React.ReactNode }) {
  return (
    <AppFrame
      theme={theme}
      status={header}
      headerOpen={headerOpen}
      core={core}
      fixed
    >
      {/* None on top, since the header leaves as much room under its pill as above it. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 p-5 pt-0" data-home-page>
        <StartCard aircraft={aircraft} servers={servers} play={play} session={session} next={next} opensFolded={opensFolded} />
        {children}
      </div>
    </AppFrame>
  )
}

// After the guide, whichever way it closed, a send-off on the page by itself, in the room the guide
// leaves: it fades in as the guide goes, from a little low, holds, and fades out as it rises on.
// Coherent GT has no @starting-style, so it mounts unseen and a transition brings it in two frames
// later; timers end it, as they end the guide. In milliseconds.
const FAREWELL = { delay: 150, in: 700, hold: 1500, out: 600 }
function Farewell({ onGone }: { onGone: () => void }) {
  const [phase, setPhase] = useState<"mounted" | "shown" | "going">("mounted")
  useEffect(() => {
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => setPhase("shown"))))
    const going = window.setTimeout(() => setPhase("going"), FAREWELL.delay + FAREWELL.in + FAREWELL.hold)
    const gone = window.setTimeout(onGone, FAREWELL.delay + FAREWELL.in + FAREWELL.hold + FAREWELL.out)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(going)
      clearTimeout(gone)
    }
    // It runs once, from its mounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const shown = phase === "shown"
  return (
    // Raised from the room's middle, where it would look low under the start card.
    <div className="pointer-events-none absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center pb-16">
      <p
        className="text-lg font-medium text-foreground/90 transition-[opacity,transform] ease-out"
        style={{
          opacity: shown ? 1 : 0,
          transform: `translateY(${phase === "mounted" ? 6 : phase === "shown" ? 0 : -4}px)`,
          transitionDuration: `${phase === "going" ? FAREWELL.out : FAREWELL.in}ms`,
          transitionDelay: shown ? `${FAREWELL.delay}ms` : "0ms",
        }}
      >
        Have a nice flight!
      </p>
    </div>
  )
}

// The aircraft a frame starts in, which it keeps for the aircraft picker: picking one on the world
// map, where home's frames are, loads it, and home follows.
function useLoaded(aircraft: "supported" | "unsupported") {
  const [loaded, setLoaded] = useState(aircraft === "supported" ? LOADED : LOADED_UNSUPPORTED)
  return { loaded, context: { at: "world-map" as const, pick: setLoaded, profiles: PROFILES } }
}

// A frame for the aircraft check opens the guide on its last page.
export function HomeFirstTimeFrame({ theme, aircraft, openOnCheck }: { theme: Theme; aircraft: "supported" | "unsupported"; openOnCheck?: boolean }) {
  const { loaded, context } = useLoaded(aircraft)
  const [guiding, setGuiding] = useState(true)
  const [farewell, setFarewell] = useState(false)
  return (
    <AircraftContext.Provider value={context}>
      <HomePage theme={theme} aircraft={loaded}>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {guiding && <WelcomeGuide supported={!!loaded.maturity} startAt={openOnCheck ? PAGES - 1 : 0} onLeave={() => setFarewell(true)} onClose={() => setGuiding(false)} />}
          {farewell && <Farewell onGone={() => setFarewell(false)} />}
        </div>
      </HomePage>
    </AircraftContext.Provider>
  )
}

// Home on a later visit: the authors' notes, or the figure when there are none, and in an aircraft
// Dual Input has no profile for, which has no notes to show, what a session there shares, with the
// aircraft picker a press away. A frame also says how our servers, faked, answer, and can play
// hosting or joining by itself, what the header shows and whether it opens out, how the link to
// the service stands, and whether it opens on a session, which one, with whom, whether a crewmate
// joins it a while later, and whether the checklist has the page.
export function HomeLaterFrame({ theme, aircraft, notes, servers, play, header, headerOpen, core, session, next, opensFolded }: { theme: Theme; aircraft: "supported" | "unsupported"; notes?: keyof typeof NOTES; servers?: Servers; play?: Action; header?: HeaderStatus; headerOpen?: boolean; core?: Core; session?: SessionKey; next?: NextSession; opensFolded?: boolean }) {
  const { loaded, context } = useLoaded(aircraft)
  return (
    <AircraftContext.Provider value={context}>
      <HomePage theme={theme} aircraft={loaded} servers={servers} play={play} header={header} headerOpen={headerOpen} core={core} session={session} next={next} opensFolded={opensFolded}>
        {/* A session's page ends at the card: the authors' notes are for before it (user,
            2026-10-29), and the figure leaps off the page when a session starts. */}
        {session ? null : !loaded.maturity ? (
          <UnsupportedAircraft />
        ) : notes ? (
          <AuthorsNotes notes={NOTES[notes]} />
        ) : (
          <NoNotes />
        )}
      </HomePage>
    </AircraftContext.Provider>
  )
}

// Home while the service restarts after a crash: the window dims under the line that it's
// reconnecting, and comes back as it was once the service does, here after this many milliseconds.
const RECONNECTS_AFTER = 5000
export function ReconnectingFrame({ theme }: { theme: Theme }) {
  const [core, setCore] = useState<Core>("reconnecting")
  useEffect(() => {
    const t = window.setTimeout(() => setCore("connected"), RECONNECTS_AFTER)
    return () => window.clearTimeout(t)
  }, [])
  return <HomeLaterFrame theme={theme} aircraft="supported" core={core} />
}

// Every refusal's message in a card like the start card, so each shows at the width and on the
// background it has there, under a line saying when it shows.
function RefusalsSheet() {
  const { Card, CardContent } = useUI()
  return (
    <div className="p-5">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-col gap-6">
          {(Object.keys(REFUSALS) as Refusal[]).map((why) => (
            <div key={why} className="flex flex-col gap-2">
              <Label>{REFUSED_WHEN[why]}</Label>
              <Refused why={why} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
// The sheet takes the kit from the frame's context, so it's drawn inside the frame.
export function RefusalsFrame({ theme }: { theme: Theme }) {
  return (
    <AppFrame theme={theme} header={false} tabs={false}>
      <RefusalsSheet />
    </AppFrame>
  )
}

// Every place a crewmate can be before preflight, as their row in the host's crew list, and every
// way a joiner can stand toward the pilot flying, as that pilot's row in theirs, each in a card
// like the session's under a line saying when it shows.
function SessionSheet({ children }: { children: React.ReactNode }) {
  const { Card, CardContent } = useUI()
  return (
    <div className="p-5">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-col gap-6">{children}</CardContent>
      </Card>
    </div>
  )
}
export function CrewmateStatesFrame({ theme }: { theme: Theme }) {
  return (
    <AppFrame theme={theme} header={false} tabs={false}>
      <SessionSheet>
        {(Object.keys(WHERE) as Whereabouts[]).map((at) => (
          <div key={at} className="flex flex-col gap-2">
            <Label>{WHERE[at].when}</Label>
            <ul>
              <CrewRow pilot={{ ...JAMES, at }} />
            </ul>
          </div>
        ))}
      </SessionSheet>
    </AppFrame>
  )
}
export function HeadsUpFrame({ theme }: { theme: Theme }) {
  return (
    <AppFrame theme={theme} header={false} tabs={false}>
      <SessionSheet>
        {HEADS_UP_CASES.map((c) => (
          <div key={c.when} className="flex flex-col gap-2">
            <Label>{c.when}</Label>
            <Differences differences={c.items} />
          </div>
        ))}
      </SessionSheet>
    </AppFrame>
  )
}
export function WaysFrame({ theme }: { theme: Theme }) {
  return (
    <AppFrame theme={theme} header={false} tabs={false}>
      <SessionSheet>
        {(Object.keys(WAYS) as Way[]).map((way) => (
          <div key={way} className="flex flex-col gap-2">
            <Label>{WAYS[way].when}</Label>
            <ul>
              <CrewRow pilot={{ ...JAMES, flying: true, way }} />
            </ul>
          </div>
        ))}
      </SessionSheet>
    </AppFrame>
  )
}
