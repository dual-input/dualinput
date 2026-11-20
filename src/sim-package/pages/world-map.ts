// The world map's requests, which the menu script makes in the sim's menu document, mainUi, as the
// world map's own code makes them: the airport search's view listener events, and the store's
// requests through `engine.call("requestData", path, arg)`, with its lists read through
// `requestArrayElements` (record/areas/interface/log.md, 2026-10-05 and 2026-10-06, which p07,
// p08, and p10 measured; record/areas/session/02-units.md, "The menu script"). Each request answers
// once the store reads back what it set, or says why not, and decides nothing beyond which list
// entry matches.
//
// Each awaited value goes into a const before anything else reads it. Coherent GT rejects
// `if (!await x)` as a syntax error, which takes out the whole menu script, and esbuild drops the
// parentheses that `!(await x)` is written with (measured on MSFS 2024, 2026-11-17, in mainUi's
// console: "SyntaxError: Unexpected identifier 'request'. Expected ')' to end an 'if' condition.").

import type { WorldMapOutcome } from "../../engines/messages/ts/sim/WorldMapOutcome.ts"
import type { WorldMapRequest } from "../../engines/messages/ts/sim/WorldMapRequest.ts"

/** The menu document's bridge to the sim and its store, which the world map's own code uses. */
declare const engine: {
  call(name: string, ...args: unknown[]): Promise<unknown>
  trigger(name: string, ...args: unknown[]): void
  on(name: string, f: (...args: never[]) => void): unknown
}

declare global {
  interface Window {
    _globalDataLoader?: { getData(path: string): { value: unknown } | undefined }
  }
}

declare function RegisterViewListener(name: string): unknown

/** A stand or runway of the departure's airport, as the store lists it. */
export type Place = { ID: number; name: string }

/** An entry of `game/aircraft/aircraftList`, by the fields the menu script reads (p08's keys). */
export type ListedAircraft = { aircraftId: number; variationIndex: number; variation?: string; thumbnailPath?: string; isUsable?: boolean }

const DONE: WorldMapOutcome = { as: "done" }
const NO_MATCH: WorldMapOutcome = { as: "no-match" }
const failed = (why: string): WorldMapOutcome => ({ as: "failed", why })

/** Under this identifier the airport search's results come back to us, rather than to the world map's own search box. */
const SEARCH_UID = "DUALINPUT_MENU_SEARCH"

/** How long each step waits for the store to read back what it set, in milliseconds, past p07's 553ms for an airport and p08's 1s for an aircraft. */
const SEARCH_MS = 4000
const READ_BACK_MS = 5000
/** How long Ready to fly waits for its button, which came 0.6s before p10 pressed it, after a load whose end the core already waited for. */
const READY_MS = 20_000
/** The most aircraft or liveries read from a list: p08's list held 138 aircraft, and its A220 12 liveries. */
const MOST = 1000

/**
 * The stand whose list name is the flight file's stand name and number, followed by ` --` or
 * nothing, as "PARKING 140 -- RAMP CARGO" is for `GateName=PARKING; GateNumber=140`, so PARKING 14
 * never takes PARKING 140. `standMatches` in tools/sim/go-to.ts holds the same rule, so change both
 * together.
 */
export function standFor(taxis: Place[], name: string, number: number): Place | undefined {
  // The flight file writes a gate's letter after an underscore, `GateName=GATE_N`, where the list
  // writes a space, "GATE N 17 -- GATE MEDIUM" (measured on MSFS 2024, 2026-11-17,
  // record/areas/session/log.md).
  const wanted = `${name.replace(/_/g, " ")} ${number}`.toUpperCase()
  return taxis.find((taxi) => {
    const listed = taxi.name.toUpperCase()
    return listed === wanted || listed.indexOf(`${wanted} --`) === 0
  })
}

/** The `SimObjects\Airplanes\` folder in an aircraft's thumbnail's path, such as `inibuilds-a380` (p08's entries), or undefined. */
export function folderOf(thumbnailPath: string | undefined): string | undefined {
  const found = /\/SimObjects\/Airplanes\/([^/]+)\//i.exec(thumbnailPath ?? "")
  return found ? found[1] : undefined
}

/**
 * The aircraft list's entry for the aircraft in `folder`: the one whose variation is `title`,
 * `A:TITLE`, or else the folder's first. p08's A380 had an entry for each preset, whose variation was
 * its `A:TITLE`, while the Baron 58P's folder held one entry, whose variation was its selected
 * livery's (measured on MSFS 2024, 2026-11-17, record/areas/session/log.md). That `isUsable`
 * marks an aircraft a pilot owns is unverified.
 */
export function aircraftFor(list: ListedAircraft[], folder: string, title: string | null): ListedAircraft | undefined {
  const inFolder = list.filter((entry) => entry.isUsable !== false && folderOf(entry.thumbnailPath)?.toLowerCase() === folder.toLowerCase())
  const wanted = title?.toLowerCase()
  return inFolder.find((entry) => wanted !== undefined && entry.variation?.toLowerCase() === wanted) ?? inFolder[0]
}

/** An entry of `game/aircraft/configurator/liveries`, by the fields the menu script reads. */
export type ListedLivery = { id: string; title?: string }

/**
 * The livery list's entry for the pilot flying's livery: the one whose title is their `A:LIVERY NAME`, or, for an
 * aircraft that leaves it empty, the one whose title ends their `A:TITLE`. The Baron 58P read no `A:LIVERY NAME`,
 * and its liveries' titles, such as `N515MR`, end its `A:TITLE`, `Black Square Baron 58P Professional N515MR`
 * (measured on MSFS 2024, 2026-11-17, record/areas/session/log.md).
 */
export function liveryFor(list: ListedLivery[], livery: string | null, title: string): ListedLivery | undefined {
  const named = (entry: ListedLivery) => (entry.title ?? "").toLowerCase()
  if (livery) return list.find((entry) => named(entry) === livery.toLowerCase())
  const full = title.toLowerCase()
  return list.find((entry) => named(entry) !== "" && full.endsWith(` ${named(entry)}`))
}

function get<T>(path: string): T | null {
  const data = window._globalDataLoader?.getData(path)
  // A plain copy, since the store's value is the engine's own object.
  return data ? (JSON.parse(JSON.stringify(data.value)) as T) : null
}

function until<T>(test: () => T | null | undefined, ms: number, every = 150): Promise<T | null> {
  const started = Date.now()
  return new Promise((resolve) => {
    const look = () => {
      const found = test()
      if (found) resolve(found)
      else if (Date.now() - started > ms) resolve(null)
      else setTimeout(look, every)
    }
    look()
  })
}

/**
 * How long a call into the store may take before its step fails, in milliseconds, so every request answers and Join
 * never waits for good: every call p07, p08, and p10 made settled, and whether one can hang is unverified.
 */
const CALL_MS = 10_000

function call(name: string, ...args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the store's ${name} didn't answer in ${CALL_MS / 1000}s`)), CALL_MS)
    engine.call(name, ...args).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** A store request, which answers whether the engine took it. */
async function request(path: string, arg: string): Promise<boolean> {
  try {
    await call("requestData", path, arg)
    return true
  } catch (error) {
    console.error(`Dual Input: the menu script's ${path} was refused: ${error}`)
    return false
  }
}

async function readList<T>(path: string): Promise<T[]> {
  const length = await call("requestArrayElements", path, 0, MOST)
  const n = typeof length === "number" ? Math.min(length, MOST) : 0
  const list: T[] = []
  for (let i = 0; i < n; i++) {
    const entry = get<T>(`${path}/${i}`)
    if (entry) list.push(entry)
  }
  return list
}

type Departure = { taxiIndex?: number; runwayIndex?: number; worldLocation?: { airportInfos?: { taxis?: Place[]; runways?: Place[] } } }

function departure(): Departure | null {
  return get<Departure>("game/currentFlight/gameFlight/departure")
}

/** The departure, once it's the airport `icao` and lists its stands or runways. */
function departureAt(icao: string): Departure | null {
  const at = departure()
  const infos = at?.worldLocation?.airportInfos
  const listed = (infos?.taxis ?? []).length + (infos?.runways ?? []).length > 0
  return at && listed && JSON.stringify(at.worldLocation).indexOf(`"${icao}"`) >= 0 ? at : null
}

type Hit = { ICAO: string; index: number; database: number }

/** The airport search's results, which come back on either of two events (p07). */
const results: Hit[][] = []
let listening = false
function listen(): void {
  if (listening) return
  listening = true
  const heard = (uid: string, list: Hit[]) => {
    if (uid === SEARCH_UID) results.push(list)
  }
  engine.on("ResultsUpdated", heard)
  engine.on("EVENT_FROM_VIEW_LISTENER", (_name: string, event: string, uid: string, list: Hit[]) => {
    if (event === "ResultsUpdated") heard(uid, list)
  })
}

function search(icao: string): Promise<Hit | null> {
  results.length = 0
  engine.trigger("EVENT_TO_VIEW_LISTENER", "JS_LISTENER_AIRPORT_SEARCH", "AIRPORT_INPUT_TEXT", SEARCH_UID, icao, "ON_DEPARTURE_AIRPORT_SELECTED")
  return until(() => (results[results.length - 1] ?? []).find((hit) => hit.ICAO === icao), SEARCH_MS)
}

async function airport(icao: string): Promise<WorldMapOutcome> {
  listen()
  let hit = await search(icao)
  // Once in p10 the search answered nothing, for a reason we didn't find, so it tries again with
  // the search's listener registered in this document, as the world map's own is.
  if (!hit && typeof RegisterViewListener === "function") {
    RegisterViewListener("JS_LISTENER_AIRPORT_SEARCH")
    hit = await until(() => null, 1000).then(() => search(icao))
  }
  if (!hit) return failed(`the airport search found no ${icao}`)
  engine.trigger("EVENT_TO_VIEW_LISTENER", "JS_LISTENER_AIRPORT_SEARCH", "ON_DEPARTURE_AIRPORT_SELECTED", hit.index, hit.database)
  const at = await until(() => departureAt(icao), READ_BACK_MS)
  return at ? DONE : failed(`the departure didn't become ${icao}`)
}

/** Selects a stand or runway by its `ID`, as the world map's own list does, and reads it back. */
async function place(path: string, read: (at: Departure) => number | undefined, wanted: Place): Promise<WorldMapOutcome> {
  const took = await request(path, String(wanted.ID))
  if (!took) return failed(`the store refused ${path}`)
  const at = await until(() => {
    const now = departure()
    return now && read(now) === wanted.ID ? now : null
  }, READ_BACK_MS)
  return at ? DONE : failed(`the departure didn't take ${wanted.name}`)
}

async function stand(name: string, number: number): Promise<WorldMapOutcome> {
  const found = standFor(departure()?.worldLocation?.airportInfos?.taxis ?? [], name, number)
  if (!found) return NO_MATCH
  return place("game/currentFlight/setDepartureTaxiIndex", (at) => at.taxiIndex, found)
}

/**
 * The runway takes its `ID`, as the stand does, since the world map's list passes each entry's
 * `ID` to `SetDepartureRunwayIndex` (read in fs-base-ui 0.1.10, html_ui/Global/pkg/base.bundle.js,
 * FreeflightPlanCombobox._updateDropdown), and Join selected a runway by its `ID` in the sim
 * (measured on MSFS 2024, 2026-11-17, record/areas/session/log.md, "In the sim, Join set the world
 * map and started the flight within 0.9s, and active pause followed from our EFB app's code in
 * 264ms, once the menu script parsed").
 */
async function runway(): Promise<WorldMapOutcome> {
  const first = (departure()?.worldLocation?.airportInfos?.runways ?? [])[0]
  if (!first) return NO_MATCH
  return place("game/currentFlight/setDepartureRunwayIndex", (at) => at.runwayIndex, first)
}

async function findAircraft(folder: string, title: string | null): Promise<ListedAircraft | undefined> {
  await request("game/aircraft/updateAircraftList", "")
  const list = await readList<ListedAircraft>("game/aircraft/aircraftList")
  return aircraftFor(list, folder, title)
}

async function aircraft(folder: string, title: string | null): Promise<WorldMapOutcome> {
  const found = await findAircraft(folder, title)
  if (!found) return NO_MATCH
  const took = await request("game/aircraft/configurator/setAircraftForConfigurator", `${found.aircraftId}||${found.variationIndex}`)
  if (!took) return failed("the store refused the aircraft")
  const now = await until(() => {
    const current = get<ListedAircraft>("game/aircraft/currentAircraft")
    return current && current.aircraftId === found.aircraftId ? current : null
  }, READ_BACK_MS)
  return now ? DONE : failed("the world map didn't take the aircraft")
}

async function livery(name: string | null, title: string): Promise<WorldMapOutcome> {
  const list = await readList<ListedLivery>("game/aircraft/configurator/liveries")
  const found = liveryFor(list, name, title)
  if (!found) return NO_MATCH
  const took = await request("game/aircraft/configurator/saveVariationId", String(found.id))
  return took ? DONE : failed("the store refused the livery")
}

/** A visible element by the `name` the menu's components give it, as the menu's own code finds its buttons. */
function named(name: string): HTMLElement | null {
  const elements = document.querySelectorAll<HTMLElement>(`[name="${name}"]`)
  for (let i = 0; i < elements.length; i++) {
    const r = elements[i]!.getBoundingClientRect()
    if (r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0) return elements[i]!
  }
  return null
}

type Exposing = HTMLElement & { getExposedChild?(name: string): HTMLElement | null }

/**
 * Ready to fly, by the names `Career_ConfirmationPage` exposes, the career page free flight
 * reuses, pressed with mouse events at its center on whatever is on top there, as p10 pressed it.
 */
async function ready(): Promise<WorldMapOutcome> {
  const button = await until(() => {
    const page = named("Career_ConfirmationPage") as Exposing | null
    return page && typeof page.getExposedChild === "function" ? page.getExposedChild("ReadyButton") : null
  }, READY_MS)
  if (!button) return failed("Ready to fly's button didn't come up")
  const r = button.getBoundingClientRect()
  const x = r.left + r.width / 2
  const y = r.top + r.height / 2
  const target = document.elementFromPoint(x, y) ?? button
  // The events as p10 made them, through `createEvent`, which the menu's document took.
  for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
    const event = document.createEvent("MouseEvents")
    event.initMouseEvent(type, true, true, window, 1, x, y, x, y, false, false, false, false, 0, null)
    target.dispatchEvent(event)
  }
  return DONE
}

/** Runs one request, answering a throw as its failure. */
export async function run(asked: WorldMapRequest): Promise<WorldMapOutcome> {
  try {
    switch (asked.do) {
      case "departure-airport":
        return await airport(asked.icao)
      case "departure-stand":
        return await stand(asked.name, asked.number)
      case "departure-runway":
        return await runway()
      case "find-aircraft": {
        const found = await findAircraft(asked.folder, asked.title)
        return found ? DONE : NO_MATCH
      }
      case "aircraft":
        return await aircraft(asked.folder, asked.title)
      case "livery":
        return await livery(asked.name, asked.title)
      case "launch-flight": {
        const took = await request("game/currentFlight/launchFlight", "")
        return took ? DONE : failed("the store refused the flight's start")
      }
      case "ready-to-fly":
        return await ready()
    }
  } catch (error) {
    return failed(String(error))
  }
}
