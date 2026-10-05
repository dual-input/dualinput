/*
 * Catch-up's settle rule, as record/areas/sync/03-catch-up.md, "Settling after
 * a load", states it, applied to recorded change times. p01-guided-load.mjs
 * applies it as it records, and p01-markers.mjs to a run's NDJSON afterwards.
 */

export const RULE = { firstQuietFromMs: 15_000, quietMs: 15_000, capMs: 90_000, noisyChanges: 5 }

/*
 * When the rule calls the aircraft settled, timed from t0, over the entries
 * keep() accepts: { atMs, why, counted, excluded, late }. entries maps a key to
 * { name, first, last, before: { n, times }, after: { n, times } }, with
 * "before" and "after" the Ready moment t2, and each bucket keeping at most
 * keepTimes times. A change counts while its entry has changed at most
 * noisyChanges times since t0; the aircraft has settled once no counted change
 * came for quietMs, counted from firstQuietFromMs, or at capMs. late lists the
 * entries that never turned noisy and changed after the verdict. tEnd is when
 * recording stopped.
 */
export function settleVerdict({ entries, t0, t2, tEnd, keep, keepTimes }) {
  const changes = []
  const perEntry = new Map()
  for (const [key, e] of entries) {
    if (!keep(e)) continue
    const times = [...e.before.times, ...e.after.times].filter((t) => t > t0).sort((a, b) => a - b)
    if (!times.length) continue
    // Past keepTimes a bucket stops keeping times, so an overflowing value is
    // treated as noisy for every moment its lost changes could fall after.
    const overflow = (e.before.n > keepTimes && t0 < t2) || e.after.n > keepTimes
    perEntry.set(key, { e, times, overflow })
    times.forEach((t, i) => changes.push({ key, t, i }))
  }
  changes.sort((a, b) => a.t - b.t)
  let lastCounted = t0
  let settledAt = null
  for (const c of changes) {
    const candidate = Math.max(t0 + RULE.firstQuietFromMs, lastCounted) + RULE.quietMs
    if (c.t >= candidate) { settledAt = candidate; break }
    if (c.i < RULE.noisyChanges && !perEntry.get(c.key).overflow) lastCounted = c.t
  }
  if (settledAt === null) {
    const candidate = Math.max(t0 + RULE.firstQuietFromMs, lastCounted) + RULE.quietMs
    if (candidate <= tEnd) settledAt = candidate
  }
  let atMs = settledAt === null ? null : settledAt - t0
  let why = "quiet"
  if (atMs === null || atMs > RULE.capMs) { atMs = RULE.capMs; why = "cap" }
  const all = [...perEntry.values()]
  const noisy = (p) => p.times.length > RULE.noisyChanges || p.overflow
  const late = all
    .filter((p) => !noisy(p) && p.times.some((t) => t - t0 > atMs))
    .map((p) => ({ name: p.e.name, afterMs: p.times.filter((t) => t - t0 > atMs).map((t) => t - t0), first: p.e.first, last: p.e.last }))
  return { atMs, why, counted: all.filter((p) => !noisy(p)).length, excluded: all.filter(noisy).length, late }
}

/*
 * The sim's own markers of one load, from its system and flow events
 * ({ t, name }, name "FlightLoaded" or "flow RTC_END"): ready is the last
 * RTC_END, when Ready to fly was clicked, no later than readyBy, and fly is
 * the last FlightLoaded before it, when Fly was clicked for the load that
 * stuck. An aircraft or add-on that ends the flight and loads it again puts a
 * second FlightLoaded after the first RTC_END, and the last pair is the load
 * the pilot flies.
 */
export function markers(events, { from, readyBy }) {
  const inRange = events.filter((ev) => ev.t >= from && ev.t <= readyBy)
  const ready = inRange.filter((ev) => ev.name === "flow RTC_END").at(-1)?.t ?? null
  const fly = inRange.filter((ev) => ev.name === "FlightLoaded" && (ready === null || ev.t <= ready)).at(-1)?.t ?? null
  const reloads = Math.max(0, inRange.filter((ev) => ev.name === "FlightLoaded" && (ready === null || ev.t <= ready)).length - 1)
  return { fly, ready, reloads }
}
