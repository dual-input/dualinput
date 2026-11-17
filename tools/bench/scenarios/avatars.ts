// Avatars: two cores on the stand-in sim, each with the stand-in core helper's mouse and the
// routine host built natively, flying our own bench aircraft through the bench's relay. A
// scenario moves the camera and the mouse, and reads what each core fed `Figure`, and what
// `Figure` wrote on each figure's object (record/areas/avatars/01-avatars.md, "Cases for the
// bench"; record/areas/build/plan.md, "17 Avatars"). The case that needs `Follow` comes with
// stage 16, and the 58P's budgets are measured by hand on the installed 58P.

import assert from "node:assert/strict"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { test, type TestContext } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { AvatarsSlice } from "../../../src/engines/messages/ts/avatars/AvatarsSlice.ts"
import type { FedFigure } from "../../../src/engines/messages/ts/bench/FedFigure.ts"
import type { FedHand } from "../../../src/engines/messages/ts/bench/FedHand.ts"
import type { MouseKind } from "../../../src/engines/messages/ts/core_helper/MouseKind.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import { CHOCK, cursorFor, FOV, LOCATED, PANEL_Z, PARKED, PLANE, SEATS, TITLE, userCfgText, type V3, worldCamera, worldOf, writePackage, writeProfiles } from "../aircraft.ts"
import { BenchRun, type Core, type Fed, type Stub } from "../cores.ts"
import { load as loadFlight, toMenu } from "../flights.ts"
import { StandInHelper } from "../helper.ts"
import { app, BenchNetwork, host, join } from "../network.ts"
import { FakeApp } from "../pages.ts"

/** The gray a slumped figure turns, `GRAY` in the message crate's avatars module. */
const GRAY = 8
/** A hand's center sits this far out from what it touches, `HAND_RADIUS` in avatars' hands.rs. */
const HAND_RADIUS = 0.038
/** How far `Figure`'s feed may run after the moment it follows: a pose's 33ms, a frame's 11ms, and a busy PC's turn. */
const LATE_MS = 120
/** A camera in the cabin, behind both seats and out of both radii. */
const AWAY: V3 = [0, 1.03, -1.5]

type Pilot = { core: Core; app: FakeApp; helper: StandInHelper; name: string; sim: Stub }

type Options = {
  /** What differs in Adam's copy of the aircraft. */
  adamsCopy?: { unreadable?: boolean; emptyCockpit?: boolean }
  /** Where each pilot's camera sits as the flight loads, James's then Adam's. */
  cameras?: [V3, V3]
  /** Whether the profile gives the aircraft its seats, which it does unless this is false. */
  seats?: boolean
}

async function pilot(run: BenchRun, bench: BenchNetwork, name: string, cfg: string, t: TestContext, settings: Record<string, unknown> = {}): Promise<Pilot> {
  const helper = await StandInHelper.start()
  t.after(() => helper.close())
  const options = helper.coreOptions({ ...bench.core().settings, "sim.user-cfg": cfg, ...settings })
  const core = await run.core(name, options)
  const p = { core, app: await app(core), helper, name, sim: run.stub() }
  core.act({ act: "watch", process: p.sim.id })
  await core.hear("stage Starting aircraft none")
  return p
}

function camera(p: Pilot, position: V3, { pitch = 0, yaw = 0 } = {}): void {
  p.core.act({ act: "camera", referential: 1, position, pitch, yaw, roll: 0, fov: FOV })
}

function slice(p: Pilot): SessionSlice {
  const s = p.app.slice<SessionSlice>("session")
  assert.ok(s, `${p.name} has no session slice yet`)
  return s
}

async function logged(core: Core, wanted: RegExp, ms = 15_000): Promise<void> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(50)) if (wanted.test(core.log())) return
  throw new Error(`the core for ${core.data} never logged ${wanted}`)
}

/** Waits until the profile has turned the mouse on, so the stand-in helper is running and heard. */
async function mouseOn(p: Pilot): Promise<void> {
  await p.helper.until(() => p.helper.latest?.wants().at(-1)?.mouse === true, `${p.name}'s mouse want`, 15_000)
}

/** One mouse event from the pilot's stand-in helper. */
function mouse(p: Pilot, kind: MouseKind, x = 0, y = 0): void {
  p.helper.latest!.act({ act: "mouse", kind, x, y })
}

/** The bench's network and two pilots, James hosting, in a flight with the aircraft's model taken unless it can't be read. */
async function flight(t: TestContext, name: string, options: Options = {}): Promise<{ run: BenchRun; bench: BenchNetwork; a: Pilot; b: Pilot }> {
  const bench = await BenchNetwork.start(1, { emptySite: true })
  t.after(() => bench.stop())
  const run = new BenchRun(`avatars-${name}`, t)
  bench.profiles.publish(writeProfiles(run.folder, { seats: options.seats ?? true }))
  const folder = (who: string): string => {
    const f = path.join(run.folder, `${who}-sim`)
    fs.mkdirSync(f, { recursive: true })
    return f
  }
  const a = await pilot(run, bench, "James", writePackage(folder("James")), t)
  const b = await pilot(run, bench, "Adam", writePackage(folder("Adam"), options.adamsCopy), t)
  const [atA, atB] = options.cameras ?? [SEATS.pilot.eye, SEATS.copilot.eye]
  camera(a, atA)
  camera(b, atB)
  const code = await host(a.core, a.name)
  await join(b.core, code, b.name)
  for (const p of [a, b]) await p.app.until(() => slice(p).members.length === 2, `${p.name}: both members`, 15_000)
  for (const p of [a, b]) await loadFlight(p.core, PLANE, { title: TITLE })
  await logged(a.core, /avatars took the aircraft's model/)
  const unread = options.adamsCopy?.unreadable || options.adamsCopy?.emptyCockpit
  await logged(b.core, unread ? /avatars couldn't read the aircraft's model/ : /avatars took the aircraft's model/)
  for (const p of [a, b]) await mouseOn(p)
  return { run, bench, a, b }
}

/** Both pilots Ready, through preflight's end, after which either may take control. */
async function pastPreflight(...pilots: Pilot[]): Promise<void> {
  for (const p of pilots) {
    await p.app.until(() => {
      const s = slice(p)
      return s.members.find((m) => m.pilot === s.me)?.in_flight === true && s.ready?.length === 0
    }, `${p.name}: Ready allowed`, 15_000)
    await p.app.ok("session.ready", { on: true })
  }
  for (const p of pilots) await p.app.until(() => slice(p).preflight.phase === "ended", `${p.name}: preflight's end`, 15_000)
}

/** This machine's own figure, which `Figure`'s slot carries first, and the crew's, once both are there. */
function both(fed: Fed): { own: FedFigure; other: FedFigure } | undefined {
  const [own, other] = fed.figures
  return own && other ? { own, other } : undefined
}

const untilBoth = (p: Pilot, ok: (figures: { own: FedFigure; other: FedFigure }, fed: Fed) => boolean, what: string, options?: { after?: number; ms?: number }): Promise<Fed> =>
  p.core.untilFed((fed) => {
    const figures = both(fed)
    return figures !== undefined && ok(figures, fed)
  }, `${p.name}: ${what}`, options)

function seatOf(figure: FedFigure): "pilot" | "copilot" | "head" | "on foot" {
  if (figure.body.body === "head") return "head"
  if (figure.body.body === "on-foot") return "on foot"
  return figure.hip[0] > 0 ? "pilot" : "copilot"
}

const GRIP_LEFT: FedHand = { hand: "grip", side: 0 }
const GRIP_RIGHT: FedHand = { hand: "grip", side: 1 }
const REST: FedHand = { hand: "rest" }
const isPoint = (hand: FedHand): hand is Extract<FedHand, { hand: "point" }> => hand.hand === "point"
const close = (a: number[], b: number[], within = 0.002): boolean => a.every((v, i) => Math.abs(v - b[i]!) < within)

/** The panel's point left or right of the pilot's wheel a click at `side` reaches, from the pilot's seat. */
function panelSpot(side: "left" | "right"): { cursor: { x: number; y: number }; hit: V3 } {
  const hit: V3 = [side === "left" ? 0.65 : -0.05, SEATS.pilot.eye[1], PANEL_Z]
  return { cursor: cursorFor(SEATS.pilot.eye, hit), hit }
}

/** A variable `Figure` wrote on the figure `object`, from the stand-in's report. */
async function figureVariable(p: Pilot, object: number, name: string): Promise<number | undefined> {
  const made = (await p.core.report()).objects.find((o) => o.id === object)
  const value = made?.variables.find(([n]) => n === `Z:DUALINPUT_FIGURE_${name}`)?.[1]
  return value === undefined ? undefined : Number(value)
}

/** Waits until `Figure` has written `name` on the figure `object` as `ok` looks for. */
async function untilVariable(p: Pilot, object: number, name: string, ok: (value: number) => boolean, what: string, ms = 5_000): Promise<number> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(25)) {
    const value = await figureVariable(p, object, name)
    if (value !== undefined && ok(value)) return value
  }
  throw new Error(`${p.name}: ${what}; ${name} is ${await figureVariable(p, object, name)}`)
}

test("both cameras take the pilot's seat within a trip: the pilot flying keeps it, the other's figure gives it up, and that pilot hears the seat is taken until they leave it", { timeout: 90_000 }, async (t) => {
  const { bench, a, b } = await flight(t, "two-in-one-seat", { cameras: [AWAY, AWAY] })
  for (const p of [a, b]) await untilBoth(p, ({ own, other }) => seatOf(own) === "head" && seatOf(other) === "head", "both figures heads, away from the seats")
  // Neither hears the other through a cut, so each takes the seat before the other's pose comes.
  await bench.relays[0]!.cut(0, 2_000)
  const [afterA, afterB] = [a.core.fed().length, b.core.fed().length]
  for (const p of [a, b]) camera(p, SEATS.pilot.eye)
  await untilBoth(a, ({ own }) => seatOf(own) === "pilot", "the seat, in the cut", { after: afterA })
  await untilBoth(b, ({ own }) => seatOf(own) === "pilot", "the same seat, in the cut", { after: afterB })

  await untilBoth(a, ({ own, other }) => seatOf(own) === "pilot" && seatOf(other) === "head", "its own figure seated, and the other's a head", { after: afterA, ms: 15_000 })
  await untilBoth(b, ({ own, other }) => seatOf(own) === "head" && seatOf(other) === "pilot" && other.shows === 0, "the seat's holder hidden around its camera", { after: afterB, ms: 15_000 })
  const holder = slice(a).me
  await b.app.until(() => b.app.notifications().some((n) => n.id === "avatars.seat" && n.text === "This seat is taken" && n.pilot === holder), "the seat's notification", 10_000)
  assert.ok(!a.app.notifications().some((n) => n.id === "avatars.seat"), "the pilot flying's seat isn't taken from them")

  // An outside view is no seat: the notification goes, and the holder shows again.
  camera(b, [0, 2, -8])
  await untilBoth(b, ({ other }) => other.shows !== 0, "the holder showing from an outside view")
  await b.app.until(() => !b.app.notifications().some((n) => n.id === "avatars.seat"), "the seat's notification gone in an outside view", 10_000)

  camera(b, SEATS.pilot.eye)
  await b.app.until(() => b.app.notifications().some((n) => n.id === "avatars.seat"), "the seat's notification back", 10_000)
  camera(b, SEATS.copilot.eye)
  await untilBoth(b, ({ own, other }) => seatOf(own) === "copilot" && other.shows !== 0, "a seat of its own, and the other's figure showing again")
  await untilBoth(a, ({ other }) => seatOf(other) === "copilot", "the other's figure in the copilot's seat")
  await b.app.until(() => !b.app.notifications().some((n) => n.id === "avatars.seat"), "the seat's notification gone", 10_000)
})

test("a camera moved between the two seats takes the nearer, and with the other seat held, nothing changes", { timeout: 90_000 }, async (t) => {
  const { a, b } = await flight(t, "between-seats", { cameras: [AWAY, SEATS.copilot.eye] })
  await untilBoth(a, ({ own, other }) => seatOf(own) === "head" && seatOf(other) === "copilot", "a head, away from the seats, with the copilot's held")
  const [y, z] = [SEATS.pilot.eye[1], SEATS.pilot.eye[2]]
  // 0.25m from the pilot's eye and 0.35m from the copilot's, both inside the 0.4m radius.
  camera(a, [0.05, y, z])
  await untilBoth(a, ({ own }) => seatOf(own) === "pilot", "the nearer seat")
  await untilBoth(b, ({ other }) => seatOf(other) === "pilot", "the other's figure taking that seat")

  // Now nearer the seat the other holds: its camera takes nothing, and it keeps the seat it had.
  const after = a.core.fed().length
  camera(a, [-0.05, y, z])
  await untilBoth(a, ({ other }) => other.shows === 0, "the holder of the nearer seat hidden", { after })
  await a.app.until(() => a.app.notifications().some((n) => n.id === "avatars.seat"), "the seat's notification", 10_000)
  await sleep(300)
  assert.ok(a.core.fed().slice(after).every((fed) => seatOf(fed.figures[0]!) === "pilot"), "the held seat took it from the seat it had")
})

test("a camera 0.9m behind the hip inside the cabin is a head, and a chase view behind the tail keeps the figure seated, looking forward", { timeout: 90_000 }, async (t) => {
  const { a, b } = await flight(t, "head-and-chase")
  await untilBoth(a, ({ own }) => seatOf(own) === "pilot", "the pilot's seat")
  camera(a, [0, 2, -8])
  const chased = await untilBoth(a, ({ own }) => own.body.body === "seated" && close(own.body.eye, SEATS.pilot.eye) && close(own.body.look, [0, 0, 1]), "the seat's eye, looking forward")
  assert.equal(seatOf(chased.figures[0]!), "pilot")
  await untilBoth(b, ({ other }) => other.body.body === "seated" && close(other.body.look, [0, 0, 1]), "the other's figure looking forward")

  const behind: V3 = [SEATS.pilot.hip[0], SEATS.pilot.eye[1], SEATS.pilot.hip[2] - 0.9]
  camera(a, behind)
  const head = await untilBoth(a, ({ own }) => seatOf(own) === "head", "a head at the camera")
  const body = head.figures[0]!.body
  assert.ok(body.body === "head" && close(body.eye, behind), "the head sits at the camera")
  await untilBoth(b, ({ other }) => seatOf(other) === "head", "the other's figure a head")
})

test("a left tap by the pilot flying moves their figure's hand on the other core's stand-in, the right takes the yoke at once, and the hands swap back at their times", { timeout: 90_000 }, async (t) => {
  const { a, b } = await flight(t, "left-tap")
  await untilBoth(a, ({ own }) => seatOf(own) === "pilot" && own.hands[0].hand === "grip" && own.hands[1].hand === "rest", "the pilot flying's left hand on the yoke")
  const onB = await untilBoth(b, ({ other }) => seatOf(other) === "pilot" && other.hands[0].hand === "grip", "the pilot flying's figure on the other machine")
  const object = both(onB)!.other.object
  const armBefore = await untilVariable(b, object, "ARM_L_LEN", () => true, "the arm's first write")

  const { cursor, hit } = panelSpot("left")
  const afterA = a.core.fed().length
  const afterB = b.core.fed().length
  a.helper.latest!.act({ act: "click", x: cursor.x, y: cursor.y })
  const reached = await untilBoth(a, ({ own }) => isPoint(own.hands[0]), "the left hand reaching", { after: afterA })
  const out = both(reached)!.own
  assert.deepEqual(out.hands[1], GRIP_LEFT, "the right takes the yoke at once")
  assert.ok(isPoint(out.hands[0]) && close(out.hands[0].point, [hit[0], hit[1], hit[2] - HAND_RADIUS]), "the hand's center sits a hand's radius off the panel")

  const crossed = await untilBoth(b, ({ other }) => isPoint(other.hands[0]), "the other's left hand reaching", { after: afterB })
  assert.deepEqual(both(crossed)!.other.hands[1], GRIP_LEFT)
  const armMoved = await untilVariable(b, object, "ARM_L_LEN", (v) => Math.abs(v - armBefore) > 0.05, "Figure moving the arm on the other core's stand-in")
  t.diagnostic(`the left arm's length on the other core's stand-in went from ${armBefore.toFixed(3)}m to ${armMoved.toFixed(3)}m`)

  const home = await untilBoth(a, ({ own }) => own.hands[0].hand === "grip" && own.hands[1].hand === "grip", "both hands on the yoke", { after: afterA })
  const letGo = await untilBoth(a, ({ own }) => own.hands[0].hand === "grip" && own.hands[1].hand === "rest", "the right letting go", { after: afterA })
  // The core's own stamps: the press and the release come together, 150ms on the spot, 500ms
  // hovering, then 0.3s for the left to arrive and 0.3s more for the right to let go.
  const toHome = (home.at - reached.at) / 1_000
  const toLetGo = (letGo.at - home.at) / 1_000
  t.diagnostic(`the left took the yoke ${toHome.toFixed(0)}ms after the tap, and the right let go ${toLetGo.toFixed(0)}ms after that`)
  assert.ok(toHome >= 650 - LATE_MS && toHome <= 650 + LATE_MS, `the left took the yoke ${toHome}ms after the tap`)
  assert.ok(toLetGo >= 600 - LATE_MS && toLetGo <= 600 + LATE_MS, `the right let go ${toLetGo}ms after that`)
  await untilBoth(b, ({ other }) => other.hands[0].hand === "grip" && other.hands[1].hand === "rest", "the same hands on the other machine", { after: afterB })
})

test("a tap on a chock on foot brings the hand on that side, and no hand goes to a yoke", { timeout: 90_000 }, async (t) => {
  const { a } = await flight(t, "chock")
  await untilBoth(a, ({ own }) => seatOf(own) === "pilot", "the pilot's seat")
  a.core.act({ act: "set", numbers: [["A:PLANE LATITUDE", PARKED.latitude], ["A:PLANE LONGITUDE", PARKED.longitude], ["A:PLANE ALTITUDE", PARKED.altitude], ["E:IS AVATAR", 1]], texts: [] })

  /** Stands to the chock's left side, facing the aircraft, heading 90 degrees from the nose, and `offset` meters forward of the chock. */
  const standAt = (offset: number): void => {
    const feet: V3 = [3, CHOCK[1], CHOCK[2] + offset]
    const place = worldOf(feet)
    a.core.act({ act: "set-avatar", numbers: [["A:PLANE LATITUDE", place.latitude], ["A:PLANE LONGITUDE", place.longitude], ["A:PLANE ALTITUDE", place.altitude], ["A:PLANE HEADING DEGREES TRUE", 90], ["A:IS CROUCH", 0]] })
    a.core.act({ act: "camera", ...worldCamera([feet[0], feet[1] + 1.6, feet[2]], CHOCK) })
  }

  for (const [offset, hand, what] of [
    [-0.5, 0, "left"],
    [0.5, 1, "right"],
  ] as const) {
    standAt(offset)
    await untilBoth(a, ({ own }) => own.body.body === "on-foot" && close([own.body.at[2]], [CHOCK[2] + offset]), `on foot, ${offset}m along the chock`)
    const after = a.core.fed().length
    a.helper.latest!.act({ act: "click", x: 0, y: 0 })
    const reached = await untilBoth(a, ({ own }) => isPoint(own.hands[hand]), `the ${what} hand reaching`, { after })
    const hands = both(reached)!.own.hands
    assert.deepEqual(hands[1 - hand], REST, "the other hand rests")
    const at = hands[hand]
    assert.ok(isPoint(at) && close(at.point, CHOCK, 0.3), `the hand reaches the chock: ${JSON.stringify(at)}`)
    await untilBoth(a, ({ own }) => own.hands[hand]!.hand === "rest", "the hand home", { after })
    assert.ok(a.core.fed().slice(after).every((fed) => fed.figures[0]!.hands.every((h) => h.hand !== "grip")), "no hand went to a yoke")
  }
})

test("a right press held 210ms with 34 counts brings no hand, and one up in 150ms with 4 counts does", { timeout: 90_000 }, async (t) => {
  const { a } = await flight(t, "right-press")
  await untilBoth(a, ({ own }) => seatOf(own) === "pilot" && own.hands[0].hand === "grip", "the pilot flying's hand on the yoke")
  const { cursor } = panelSpot("left")
  const after = a.core.fed().length
  mouse(a, "RightDown", cursor.x, cursor.y)
  await sleep(210)
  mouse(a, { RightUp: { travel: 34 } }, cursor.x, cursor.y)
  await sleep(500)
  assert.ok(a.core.fed().slice(after).every((fed) => !fed.figures[0]!.hands.some(isPoint)), "a view turned with the right button brought a hand")

  mouse(a, "RightDown", cursor.x, cursor.y)
  await sleep(150)
  mouse(a, { RightUp: { travel: 4 } }, cursor.x, cursor.y)
  await untilBoth(a, ({ own }) => isPoint(own.hands[0]), "the left hand reaching", { after })
})

test("three wheel notches 400ms apart are one tap held through them, home 1.5s after the last", { timeout: 90_000 }, async (t) => {
  const { a } = await flight(t, "wheel")
  await untilBoth(a, ({ own }) => seatOf(own) === "pilot" && own.hands[0].hand === "grip", "the pilot flying's hand on the yoke")
  const { cursor } = panelSpot("left")
  const after = a.core.fed().length
  for (let notch = 0; notch < 3; notch++) {
    mouse(a, { Wheel: { notches: 1 } }, cursor.x, cursor.y)
    if (notch < 2) await sleep(400)
  }
  const reached = await untilBoth(a, ({ own }) => isPoint(own.hands[0]), "the left hand reaching", { after })
  const home = await untilBoth(a, ({ own }) => own.hands[0].hand === "grip" && own.hands[1].hand === "grip", "the left hand home", { after, ms: 6_000 })
  const held = (home.at - reached.at) / 1_000
  t.diagnostic(`the hand went home ${held.toFixed(0)}ms after the first notch, where 800ms of notches and 1,500ms after the last make 2,300ms`)
  assert.ok(held >= 2_300 - LATE_MS && held <= 2_300 + 2 * LATE_MS, `home ${held}ms after the first notch`)
  const between = a.core.fed().slice(after).filter((fed) => fed.at >= reached.at && fed.at < home.at)
  const spots = new Set(between.map((fed) => JSON.stringify(fed.figures[0]!.hands[0])))
  // Its spot, then its hover 1.5cm off it, and no second reach.
  assert.equal(spots.size, 2, `one tap held through the notches: ${[...spots].join(" ")}`)
})

/** The moments the pilot's own figure's hands reached out, each a change from none out to one out. */
function reaches(fed: Fed[]): Fed[] {
  let out = false
  return fed.filter((f) => {
    const now = f.figures[0]!.hands.some(isPoint)
    const reached = now && !out
    out = now
    return reached
  })
}

async function sendEntry(p: Pilot, key: string, value: number): Promise<void> {
  const after = p.core.heard().length
  p.core.cockpit({ act: "send", kind: "held", key, value, count: 1, every_ms: 0 })
  await p.core.hear(`cockpit sent held ${key} ${value}`, { after })
}

test("a click on a located switch is one reach, the same switch moved by a key is one reach after 100ms, and three located switches in 50ms are none", { timeout: 120_000 }, async (t) => {
  const { a, b } = await flight(t, "located")
  await untilBoth(a, ({ own }) => seatOf(own) === "pilot" && own.hands[0].hand === "grip", "the pilot flying's hand on the yoke")
  await pastPreflight(a, b)
  const handsHome = (after: number): Promise<Fed> => untilBoth(a, ({ own }) => !own.hands.some(isPoint) && own.hands[1].hand === "rest", "the hands home", { after, ms: 6_000 })
  const battery = LOCATED.battery.at
  const eye = SEATS.pilot.eye

  // First, so no click has posed the model, which the hand's side still needs.
  const keyed = a.core.fed().length
  await sendEntry(a, "battery", 1)
  const sent = performance.now()
  const reached = await untilBoth(a, ({ own }) => own.hands.some(isPoint), "the key's reach", { after: keyed })
  const waited = performance.now() - sent
  t.diagnostic(`the hand reached ${waited.toFixed(0)}ms after the stream sent the change`)
  assert.ok(waited >= 100 - LATE_MS / 2 && waited <= 100 + 2 * LATE_MS, `the hand reached ${waited}ms after the stream sent the change`)
  // The hand's center sits a hand's radius from the location, toward the seat's eye. In the left
  // seat a point at the wheel's own x is in the band, so the free right hand reaches.
  const toward = eye.map((v, i) => v - battery[i]!)
  const length = Math.hypot(...toward)
  const expected = battery.map((v, i) => v + (toward[i]! / length) * HAND_RADIUS)
  const hand = both(reached)!.own.hands[1]
  assert.ok(isPoint(hand) && close(hand.point, expected), `the right hand at the switch: ${JSON.stringify(both(reached)!.own.hands)}`)
  await handsHome(keyed)
  assert.equal(reaches(a.core.fed().slice(keyed)).length, 1, "the key's change brings one reach")

  const clicked = a.core.fed().length
  const cursor = cursorFor(eye, battery)
  a.helper.latest!.act({ act: "click", x: cursor.x, y: cursor.y })
  await sendEntry(a, "battery", 0)
  await untilBoth(a, ({ own }) => own.hands.some(isPoint), "the click's reach", { after: clicked })
  await handsHome(clicked)
  assert.equal(reaches(a.core.fed().slice(clicked)).length, 1, "the click and its own change bring one reach")

  const panel = a.core.fed().length
  for (const key of ["battery", "alternator", "avionics"]) {
    a.core.cockpit({ act: "send", kind: "held", key, value: 2, count: 1, every_ms: 0 })
    await sleep(20)
  }
  await sleep(600)
  assert.equal(reaches(a.core.fed().slice(panel)).length, 0, "a panel's switches sent at once brought a hand")
})

test("a throttle with a deadband of 2 jittering by 0.5 brings no hand, and moved by 10 over a second, 50ms apart, brings one reach, home after the run ends", { timeout: 120_000 }, async (t) => {
  const { a, b } = await flight(t, "deadband")
  await untilBoth(a, ({ own }) => seatOf(own) === "pilot" && own.hands[0].hand === "grip", "the pilot flying's hand on the yoke")
  await pastPreflight(a, b)
  const handsHome = (after: number): Promise<Fed> => untilBoth(a, ({ own }) => !own.hands.some(isPoint), "the hands home", { after, ms: 6_000 })
  // Nothing has reached for the entry yet, so its first change does, which gives the deadband
  // its value to measure from.
  const first = a.core.fed().length
  await sendEntry(a, "throttle", 50)
  await untilBoth(a, ({ own }) => own.hands.some(isPoint), "the first change's reach", { after: first })
  await handsHome(first)

  const jitter = a.core.fed().length
  for (let i = 0; i < 20; i++) {
    a.core.cockpit({ act: "send", kind: "held", key: "throttle", value: i % 2 === 0 ? 50.5 : 50, count: 1, every_ms: 0 })
    await sleep(50)
  }
  await sleep(300)
  assert.equal(reaches(a.core.fed().slice(jitter)).length, 0, "a jitter under the deadband brought a hand")

  const ramp = a.core.fed().length
  for (let i = 1; i <= 20; i++) {
    a.core.cockpit({ act: "send", kind: "held", key: "throttle", value: 50 + i * 0.5, count: 1, every_ms: 0 })
    await sleep(50)
  }
  const ended = performance.now()
  assert.ok(a.core.fed().at(-1)!.figures[0]!.hands.some(isPoint), "the hand stayed out through the run")
  await handsHome(ramp)
  t.diagnostic(`the hand went home ${(performance.now() - ended).toFixed(0)}ms after the run's last change`)
  assert.equal(reaches(a.core.fed().slice(ramp)).length, 1, "the run is one reach")
})

test("two pilots who never picked a color wear the first two palette colors, by pilot ID, the same on both, and a color picked changes the figure at once", { timeout: 90_000 }, async (t) => {
  const { a, b } = await flight(t, "colors")
  const onA = both(await untilBoth(a, () => true, "both figures"))!
  const onB = both(await untilBoth(b, () => true, "both figures"))!
  const [idA, idB] = [slice(a).me!, slice(b).me!]
  const [firstA, firstB] = idA < idB ? [0, 1] : [1, 0]
  assert.deepEqual([onA.own.color, onA.other.color], [firstA, firstB], "James's machine")
  assert.deepEqual([onB.other.color, onB.own.color], [firstA, firstB], "Adam's machine")

  await a.app.ok("clients.set-setting", { key: "session.color", value: "teal" })
  await untilBoth(a, ({ own }) => own.color === 6, "its own figure in teal")
  const changed = both(await untilBoth(b, ({ other }) => other.color === 6, "the other's figure in teal"))!
  assert.equal(changed.own.color, 0, "the pilot who never picked takes the first color nobody picked")
  await untilBoth(a, ({ other }) => other.color === 0, "the other's figure in the first color")
})

test("when control passes, the new pilot flying's figure takes its yoke and the old one's lets go, on both machines", { timeout: 120_000 }, async (t) => {
  const { a, b } = await flight(t, "control")
  await untilBoth(a, ({ own, other }) => seatOf(own) === "pilot" && seatOf(other) === "copilot", "both seated")
  await pastPreflight(a, b)
  await untilBoth(a, ({ own, other }) => own.hands[0].hand === "grip" && other.hands[1].hand === "rest", "James on his yoke")
  const [afterA, afterB] = [a.core.fed().length, b.core.fed().length]
  b.core.cockpit({ act: "take-control" })
  await b.app.until(() => slice(b).pf === slice(b).me, "control", 10_000)
  await untilBoth(b, ({ own }) => own.hands[1].hand === "grip" && own.hands[0].hand === "rest", "its own figure on the yoke", { after: afterB })
  await untilBoth(a, ({ own, other }) => own.hands[0].hand === "rest" && other.hands[1].hand === "grip", "the old pilot flying's figure letting go, and the new one's taking its yoke", { after: afterA })
  // Either pilot's pose can come first, so this waits for the two together.
  const seen = await untilBoth(b, ({ own, other }) => other.hands[0].hand === "rest" && own.hands[1].hand === "grip", "the old pilot flying's figure letting go, with its own on the yoke", { after: afterB })
  assert.deepEqual(both(seen)!.own.hands, [REST, GRIP_RIGHT], "the copilot's yoke, on the right")
})

test("poses lost in a cut leave a later one carrying the whole figure, with nothing changing after them", { timeout: 120_000 }, async (t) => {
  const { bench, a, b } = await flight(t, "pose-lost")
  await untilBoth(b, ({ other }) => seatOf(other) === "pilot" && !other.hands.some(isPoint), "James seated with his hand home")
  const after = b.core.fed().length
  await bench.relays[0]!.cut(a.core.process.pid!, 500)
  // Two changes inside the cut, a held press and then the camera, and none after them, so what
  // brings the other machine the whole figure is the pose that goes at least every 1s.
  const { cursor } = panelSpot("left")
  mouse(a, "LeftDown", cursor.x, cursor.y)
  await sleep(100)
  const moved: V3 = [SEATS.pilot.eye[0], SEATS.pilot.eye[1], SEATS.pilot.eye[2] - 0.1]
  camera(a, moved)
  const started = performance.now()
  // The link back within 3s, and a pose at least every 1s.
  await untilBoth(b, ({ other }) => isPoint(other.hands[0]) && other.body.body === "seated" && close(other.body.eye, moved), "the press and the camera, after the cut", { after, ms: 4_000 })
  t.diagnostic(`the whole figure arrived ${(performance.now() - started).toFixed(0)}ms after the changes in a 500ms cut`)
  mouse(a, "LeftUp", cursor.x, cursor.y)
})

/** A local TCP forwarder for one core's way to the backend, which `cut` closes, as this PC going offline does. */
async function backendProxy(url: string): Promise<{ url: string; cut: () => void; stop: () => Promise<void> }> {
  const target = new URL(url)
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    const up = net.connect(Number(target.port), target.hostname)
    for (const s of [socket, up]) {
      sockets.add(s)
      s.on("error", () => {})
      s.on("close", () => sockets.delete(s))
    }
    socket.pipe(up).pipe(socket)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as net.AddressInfo).port
  const cut = (): void => {
    server.close()
    for (const socket of sockets) socket.destroy()
  }
  return { url: `http://127.0.0.1:${port}`, cut, stop: () => new Promise((resolve) => server.close(() => resolve())) }
}

test("a link lost: on a PC that reaches the internet the figure slumps and turns gray, and on one that doesn't, the other figures rest in their colors, the pilot flying's on its yoke, and the own figure turns gray", { timeout: 180_000 }, async (t) => {
  const bench = await BenchNetwork.start(1, { emptySite: true })
  t.after(() => bench.stop())
  const run = new BenchRun("avatars-link-lost", t)
  bench.profiles.publish(writeProfiles(run.folder))
  const proxy = await backendProxy(bench.backend.url)
  t.after(() => proxy.cut())
  const packages = (who: string): string => {
    const folder = path.join(run.folder, `${who}-sim`)
    fs.mkdirSync(folder, { recursive: true })
    return writePackage(folder)
  }
  // Adam flies, in the pilot's seat, and James's PC is the one that goes offline.
  const pf = await pilot(run, bench, "Adam", packages("Adam"), t)
  const offline = await pilot(run, bench, "James", packages("James"), t, { "network.backend": proxy.url })
  camera(pf, SEATS.pilot.eye)
  camera(offline, SEATS.copilot.eye)
  const code = await host(pf.core, pf.name)
  await join(offline.core, code, offline.name)
  for (const p of [pf, offline]) await p.app.until(() => slice(p).members.length === 2, `${p.name}: both members`, 15_000)
  for (const p of [pf, offline]) await loadFlight(p.core, PLANE, { title: TITLE })
  for (const p of [pf, offline]) await logged(p.core, /avatars took the aircraft's model/)
  for (const p of [pf, offline]) await mouseOn(p)
  await untilBoth(offline, ({ own, other }) => seatOf(own) === "copilot" && seatOf(other) === "pilot" && other.hands[0].hand === "grip", "both seated, the pilot flying on the yoke")
  const liveColors = both(await untilBoth(offline, () => true, "both figures"))!

  // A held press, which the figure on the PC gone offline lets go of.
  const { cursor } = panelSpot("left")
  mouse(pf, "LeftDown", cursor.x, cursor.y)
  await untilBoth(offline, ({ other }) => isPoint(other.hands[0]), "the pilot flying's press")

  const [afterPf, afterOffline] = [pf.core.fed().length, offline.core.fed().length]
  proxy.cut()
  await bench.relays[0]!.cut(offline.core.process.pid!, 40_000)
  // The link goes 4s to 5s in, and each dial asks what this PC reaches, which answers within 2s.
  const onOffline = await untilBoth(offline, ({ own, other }) => own.color === GRAY && !own.slumps && other.color !== GRAY && !other.slumps, "its own figure gray, and the other's in its color, not slumped", { after: afterOffline, ms: 30_000 })
  const figures = both(onOffline)!
  assert.equal(figures.other.color, liveColors.other.color, "the other figure keeps its color")
  assert.deepEqual(figures.other.hands, [GRIP_LEFT, REST], "the pilot flying's figure rests on its yoke, where its last pose held the panel")

  const onPf = await untilBoth(pf, ({ other }) => other.slumps && other.color === GRAY, "the lost member's figure slumped and gray", { after: afterPf, ms: 30_000 })
  assert.ok(!both(onPf)!.own.slumps && both(onPf)!.own.color !== GRAY, "its own figure, on a PC that reaches the internet, stays as it was")
  mouse(pf, "LeftUp", cursor.x, cursor.y)
})

test("the pilot flying's sim crashing with the link up slumps their figure, turns it gray, and lets go of its yoke at once", { timeout: 120_000 }, async (t) => {
  const { a, b } = await flight(t, "sim-crash")
  const onB = await untilBoth(b, ({ other }) => seatOf(other) === "pilot" && other.hands[0].hand === "grip", "the pilot flying on the yoke")
  const object = both(onB)!.other.object
  const held = await untilVariable(b, object, "ARM_L_LEN", () => true, "the arm's first write")
  const after = b.core.fed().length
  await a.sim.kill()
  await untilBoth(b, ({ other }) => other.slumps && other.color === GRAY, "the crashed pilot's figure slumped and gray", { after })
  const arm = await untilVariable(b, object, "ARM_L_LEN", (v) => Math.abs(v - held) > 0.05, "Figure letting go of the yoke")
  t.diagnostic(`the slumped figure's left arm went from ${held.toFixed(3)}m on the yoke to ${arm.toFixed(3)}m`)
})

test("a model a machine can't read brings no hand from a click and draws grips at rest there, says so in the tab and the match check, and leaves seats and heads as before", { timeout: 120_000 }, async (t) => {
  const { a, b } = await flight(t, "unreadable", { adamsCopy: { unreadable: true } })
  const watching = await FakeApp.open(b.core, ["avatars"])
  t.after(() => watching.close())
  await watching.until(() => watching.slice<AvatarsSlice>("avatars")?.note === "model", "the tab's note", 10_000)
  assert.ok(!b.app.notifications().some((n) => n.id.startsWith("avatars.")), "a model that can't be read shows in the tab, not as a notification")

  await a.app.until(() => slice(a).differences.some((d) => d.level === "info" && d.words === "Some figures won't be able to interact with the cockpit"), "the match check's item", 15_000)

  // The seat box stands in for the model's: Adam's figure sits, and the pilot flying's grip
  // draws at rest, since this machine has no yoke to put it on.
  const fed = await untilBoth(b, ({ own, other }, f) => seatOf(own) === "copilot" && seatOf(other) === "pilot" && other.hands[0].hand === "grip" && f.yokes === 0, "both seated, with no yokes")
  // `Figure` draws that grip at rest, so the left arm's as long as the right, which rests anyway.
  const object = both(fed)!.other.object
  const left = await untilVariable(b, object, "ARM_L_LEN", () => true, "the left arm's first write")
  const right = await untilVariable(b, object, "ARM_R_LEN", () => true, "the right arm's first write")
  assert.ok(Math.abs(left - right) < 0.002, `the arms' lengths at rest: ${left}, ${right}`)
  await untilBoth(a, ({ other }, f) => seatOf(other) === "copilot" && f.yokes === 2, "the other machine with its two yokes, as usual")

  const after = b.core.fed().length
  const cursor = cursorFor(SEATS.copilot.eye, [-0.6, SEATS.copilot.eye[1], PANEL_Z])
  b.helper.latest!.act({ act: "click", x: cursor.x, y: cursor.y })
  await sleep(500)
  assert.ok(b.core.fed().slice(after).every((f) => !f.figures[0]!.hands.some(isPoint)), "a click brought a hand on a machine with no model")

  camera(b, [-0.3, 1.03, -1.1])
  await untilBoth(b, ({ own }) => seatOf(own) === "head", "a head behind the seat, by the seats' box")
})

test("a cockpit with no triangles, as a modular aircraft's is when its cockpit is an attachment, says so as a model that can't be read, and seats figures by the seats' box", { timeout: 90_000 }, async (t) => {
  const { a, b } = await flight(t, "empty-cockpit", { adamsCopy: { emptyCockpit: true } })
  const watching = await FakeApp.open(b.core, ["avatars"])
  t.after(() => watching.close())
  await watching.until(() => watching.slice<AvatarsSlice>("avatars")?.note === "model", "the tab's note", 10_000)
  await a.app.until(() => slice(a).differences.some((d) => d.level === "info"), "the match check's item", 15_000)
  await untilBoth(b, ({ own, other }, f) => seatOf(own) === "copilot" && seatOf(other) === "pilot" && f.yokes === 0, "both seated, with no yokes")
  camera(b, [-0.3, 1.03, -1.1])
  await untilBoth(b, ({ own }) => seatOf(own) === "head", "a head behind the seat")
})

test("a profile with no seats says so in the tab, and each figure is a head", { timeout: 90_000 }, async (t) => {
  const { a, b } = await flight(t, "no-seats", { seats: false })
  const watching = await FakeApp.open(a.core, ["avatars"])
  t.after(() => watching.close())
  await watching.until(() => watching.slice<AvatarsSlice>("avatars")?.note === "seats", "the tab's note", 10_000)
  for (const p of [a, b]) await untilBoth(p, ({ own, other }) => seatOf(own) === "head" && seatOf(other) === "head", "both figures heads")
})

test("the profile loading before the aircraft's package folder is found starts the model's job once the folder arrives", { timeout: 90_000 }, async (t) => {
  const bench = await BenchNetwork.start(1, { emptySite: true })
  t.after(() => bench.stop())
  const run = new BenchRun("avatars-profile-first", t)
  bench.profiles.publish(writeProfiles(run.folder))
  writePackage(run.folder)
  // A named pipe in place of `UserCfg.opt`, whose read waits until the scenario answers, so the
  // search for the package can't finish before the profile loads.
  const pipe = String.raw`\\.\pipe\dualinput-bench-${process.pid}-user-cfg`
  const text = userCfgText(path.join(run.folder, "packages"))
  const held: net.Socket[] = []
  let released = false
  const server = net.createServer((socket) => {
    socket.on("error", () => {})
    if (released) {
      socket.end(text)
      return
    }
    // Each held read takes one of the core's 4 job threads, so holding every search's read left
    // none for the bundle's read, and the profile never loaded. The package search the model's
    // job waits on is the last to start, so the earlier ones go free.
    held.push(socket)
    if (held.length > 2) held.shift()!.end(text)
  })
  await new Promise<void>((resolve) => server.listen(pipe, resolve))
  t.after(() => server.close())
  const helper = await StandInHelper.start()
  t.after(() => helper.close())
  const core = await run.core("James", helper.coreOptions({ ...bench.core().settings, "sim.user-cfg": pipe }))
  const a: Pilot = { core, app: await app(core), helper, name: "James", sim: run.stub() }
  core.act({ act: "watch", process: a.sim.id })
  await core.hear("stage Starting aircraft none")
  camera(a, SEATS.pilot.eye)
  await host(core, a.name)
  await loadFlight(core, PLANE, { title: TITLE })
  await logged(core, /the profile loaded hash=/)
  await sleep(300)
  assert.doesNotMatch(core.log(), /avatars builds the aircraft's model/, "the model's job started before the package folder was found")

  released = true
  for (const socket of held.splice(0)) socket.end(text)
  await logged(core, /avatars builds the aircraft's model/)
  await logged(core, /avatars took the aircraft's model/)
})

test("after a reset of the sim's variables Figure's writes still land, and after a flight load the figures are created again and its writes land", { timeout: 120_000 }, async (t) => {
  const { a } = await flight(t, "reset")
  const first = both(await untilBoth(a, ({ own }) => seatOf(own) === "pilot", "the pilot's seat"))!
  const own = first.own.object
  const before = await untilVariable(a, own, "HEAD_YAW", () => true, "the head's first write")

  a.core.act({ act: "reset-vars" })
  camera(a, SEATS.pilot.eye, { yaw: 40 })
  const turned = await untilVariable(a, own, "HEAD_YAW", (v) => Math.abs(v - before) > 10, "Figure's write after the reset landing")
  t.diagnostic(`after the reset, the head turned from ${before.toFixed(1)} to ${turned.toFixed(1)} degrees`)

  // The sim loads the flight again, which unloads the profile, whose connection takes its
  // figures with it, and resets the variables as an aircraft change does.
  await toMenu(a.core)
  for (const started = Date.now(); (await a.core.report()).objects.some((o) => o.id === own); await sleep(50)) {
    assert.ok(Date.now() - started < 10_000, "the figures stayed after the profile unloaded")
  }
  a.core.act({ act: "reset-vars" })
  const after = a.core.fed().length
  await loadFlight(a.core, PLANE, { title: TITLE })
  const again = both(await untilBoth(a, ({ own: o }) => seatOf(o) === "pilot" && o.object !== own, "a new figure in the pilot's seat", { after, ms: 15_000 }))!
  const created = (await a.core.report()).objects.filter((o) => o.title === "DUALINPUT_FIGURE_PILOT")
  assert.ok(created.some((o) => o.id === again.own.object), "the new figure's object is in the sim")
  const head = await untilVariable(a, again.own.object, "HEAD_YAW", () => true, "Figure's first write on the new figure")
  camera(a, SEATS.pilot.eye, { yaw: -40 })
  await untilVariable(a, again.own.object, "HEAD_YAW", (v) => Math.abs(v - head) > 10, "Figure's writes on the new figure landing")
})

test("a following machine's yoke moved through Follow's events keeps the pilot flying's hand on its horn", { timeout: 120_000 }, async (t) => {
  const { a, b } = await flight(t, "following-yoke")
  await untilBoth(a, ({ own, other }) => seatOf(own) === "pilot" && seatOf(other) === "copilot", "both seated")
  await pastPreflight(a, b)
  const onB = await untilBoth(b, ({ other }) => seatOf(other) === "pilot" && other.hands[0].hand === "grip", "the pilot flying on the yoke")
  const object = both(onB)!.other.object
  // The aircraft's own code moves its yoke from the axis event, and the fixture's yoke reads it in percent, so a small value serves as both.
  b.core.act({ act: "rule", when: { when: "sent", name: "K:AXIS_ELEVATOR_SET" }, after_ms: 0, then: { then: "set", name: "A:YOKE Y POSITION WITH AP", value: null } })
  const held = await untilVariable(b, object, "ARM_L_LEN", () => true, "the arm on the yoke")
  // The pilot flying pulls: the following machine's Follow sends the elevator's axis event, its yoke moves, and the hand goes with it.
  a.core.act({ act: "set", numbers: [["A:ELEVATOR POSITION", -60]], texts: [] })
  const pulled = await untilVariable(b, object, "ARM_L_LEN", (v) => Math.abs(v - held) > 0.01, "the hand following the yoke")
  t.diagnostic(`the pilot flying's left arm on the following machine went from ${held.toFixed(3)}m to ${pulled.toFixed(3)}m with the yoke`)
  // Follow draws the elevator along a line between two samples, so the yoke passes through the values between on its way.
  let yoke: string | undefined
  for (const started = Date.now(); yoke !== "60" && Date.now() - started < 5_000; await sleep(50)) {
    yoke = new Map((await b.core.report()).variables).get("YOKE Y POSITION WITH AP")
  }
  assert.equal(yoke, "60", "the following machine's yoke moved by the axis event")
})

test("a pilot following in flight keeps their seat, their figure's eye at the seat's on the other machine, since the platform reads the camera before Follow moves the aircraft", { timeout: 120_000 }, async (t) => {
  const { a, b } = await flight(t, "following-camera")
  await untilBoth(a, ({ own, other }) => seatOf(own) === "pilot" && seatOf(other) === "copilot", "both seated")
  await pastPreflight(a, b)
  for (const speed of [40, 85]) {
    a.core.act({ act: "set", numbers: [["A:VELOCITY BODY Z", speed / 0.3048]], texts: [] })
    // Follow draws 400ms behind and eases a step over 3s, so the following aircraft flies at the speed well within 4s.
    await sleep(4_000)
    const moved = await groundSpeed(b)
    assert.ok(moved > speed * 0.8, `the following aircraft flies at ${moved.toFixed(1)} m/s, against ${speed} m/s`)
    // A camera a frame behind, 0.94m at 85 m/s in the stand-in's 11ms frames, can still sit in the seat's 0.8m, so the eye is what tells.
    const since = Math.max(0, a.core.fed().length - 1)
    await sleep(2_000)
    for (const fed of a.core.fed().slice(since)) {
      const other = both(fed)?.other
      assert.ok(other && seatOf(other) === "copilot", `at ${speed} m/s the following pilot is seated on the other machine: ${JSON.stringify(other?.body)}`)
      assert.ok(other.body.body === "seated" && close(other.body.eye, SEATS.copilot.eye, 0.05), `at ${speed} m/s the following pilot's eye stays at the seat's: ${JSON.stringify(other.body)}`)
    }
  }
})

test("the platform's Camera runs while a profile is loaded, and stops once it unloads", { timeout: 90_000 }, async (t) => {
  const { b } = await flight(t, "camera-routine")
  const first = await b.core.routineWrites("CAMERA")
  await sleep(1_000)
  const running = await b.core.routineWrites("CAMERA")
  assert.ok(first > 0 && running - first >= 4, `Camera's slot is written every 200ms while the profile is loaded: ${first}, then ${running} a second later`)
  await toMenu(b.core)
  await sleep(1_500)
  const ended = await b.core.routineWrites("CAMERA")
  await sleep(1_000)
  assert.equal(await b.core.routineWrites("CAMERA"), ended, "no more writes once the profile unloaded and its end mark went out")
})

/** The speed of `p`'s stand-in aircraft over the ground across one second, in m/s, from its latitude and longitude. */
async function groundSpeed(p: Pilot): Promise<number> {
  const where = async (): Promise<[number, number]> => {
    const variables = new Map((await p.core.report()).variables)
    return [Number(variables.get("PLANE LATITUDE")), Number(variables.get("PLANE LONGITUDE"))]
  }
  const [lat0, lon0] = await where()
  const started = Date.now()
  await sleep(1_000)
  const [lat1, lon1] = await where()
  const seconds = (Date.now() - started) / 1_000
  const north = (lat1 - lat0) * 111_195
  const east = (lon1 - lon0) * 111_195 * Math.cos((lat0 * Math.PI) / 180)
  return Math.hypot(north, east) / seconds
}