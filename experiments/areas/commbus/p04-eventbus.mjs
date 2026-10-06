/*
 * p04: can our own code listen on wt.eb.evt, the key that avionics built on
 * the MSFS Avionics Framework share their EventBus topics under, and can it
 * publish there? The plan's step 6 probe on the EventBus bridge
 * (record/areas/product/plan.md; record/areas/product/ideas.md, "EventBus
 * bridge"), and the Phenom 300E study's sim question 11.
 *
 *   node experiments/areas/commbus/p04-eventbus.mjs [--page <title or id>]
 *
 * A bus that can use the sim's generic data listener sends its synced topics
 * once a frame as one package, { busId, packagedId, data: [{ topic, data,
 * isCached }] }, with listener.send("wt.eb.evt", package), hears other buses'
 * with listener.onDataReceived("wt.eb.evt", ...), and skips its own busId; a
 * new bus publishes the topic event_bus with "resync_request", and every bus
 * then sends its cached topics again (read in synaptic-aircraft-a220 1.0.10,
 * DisplayUnits/instrument.js, the framework's EventBus and its generic data
 * sync; record/learn/foundations/06-01-the-engine-and-instruments.md).
 *
 * Through the inspector, p04 registers a generic data listener of its own in
 * three documents: one of the aircraft's avionics displays (the MFD unless
 * --page says otherwise), the EFB's, and the toolbar's, and counts what each
 * hears. The pilot, with the avionics on and the MFD in view:
 *   1. hands off, 10s;
 *   2. zooms the MFD's map in one step;
 *   3. zooms it back out one step;
 *   4. opens another page on the MFD;
 *   5. adds a waypoint to the flight plan, Page Down when done.
 * Then p04, by itself:
 *   6. sends a resync_request package from the display's listener, as a new
 *      bus does, and counts what arrives in the next 5s;
 *   7. sends again the topics that arrived in step 2 and not while idle, with
 *      their step 2 values, as a bridge would on the other machine, and takes
 *      a screenshot before and after: if the map zooms in, a package we send
 *      changes the avionics.
 * Everything it registers goes when it ends. It touches no input.
 *
 * Output: results/p04-eventbus-<time>.txt and .ndjson, and the screenshots in
 * a folder beside them.
 */

import { dirname, join } from "node:path"

import { Recorder, repoRelative, scrub, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { Inspector, listPages, selectPage } from "../../tools/inspector.mjs"
import { startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"
import { startShooter } from "../../tools/shot.mjs"

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null }

const rec = new Recorder("p04-eventbus", { area: "commbus" })
const findings = []
const find = (text) => { findings.push(text); rec.log("finding", text) }

// ---------------------------------------------------------------- in a document

// Runs in the document: Chrome 49's syntax, no optional chaining or ??.
// Keeps, per step, the package count, each topic's count, and each topic's
// last value, which step 7 sends again.
const INSTALL = `(function () {
  if (window.CROSSCHECK_P04) return { reused: true, registered: !!window.CROSSCHECK_P04.ready };
  var p = window.CROSSCHECK_P04 = { phase: "setup", busId: Math.floor(Math.random() * 2147483647), ready: false, phases: {}, own: 0, error: null };
  function slot(name) {
    var s = p.phases[name];
    if (!s) s = p.phases[name] = { packages: 0, bytes: 0, topics: {}, last: {}, buses: {} };
    return s;
  }
  if (typeof RegisterGenericDataListener === "undefined") { p.error = "no RegisterGenericDataListener"; return { registered: false, error: p.error }; }
  try {
    p.listener = RegisterGenericDataListener(function () {
      p.listener.onDataReceived("wt.eb.evt", function (pkg) {
        try {
          if (!pkg || pkg.busId === p.busId) { p.own++; return; }
          var s = slot(p.phase);
          s.packages++;
          s.buses[pkg.busId] = (s.buses[pkg.busId] || 0) + 1;
          var items = pkg.data || [];
          for (var i = 0; i < items.length; i++) {
            var t = items[i].topic;
            var text = JSON.stringify(items[i].data === undefined ? null : items[i].data);
            s.bytes += text ? text.length : 0;
            s.topics[t] = (s.topics[t] || 0) + 1;
            if (text && text.length < 20000) s.last[t] = { data: items[i].data, isCached: items[i].isCached };
          }
        } catch (e) { p.error = String(e); }
      });
      p.ready = true;
    });
  } catch (e) { p.error = String(e); return { registered: false, error: p.error }; }
  return { registered: true };
})()`

const SET_PHASE = (name) => `(function () { if (window.CROSSCHECK_P04) window.CROSSCHECK_P04.phase = ${JSON.stringify(name)}; return true; })()`

const SUMMARY = (name) => `(function () {
  var p = window.CROSSCHECK_P04;
  if (!p) return null;
  var s = p.phases[${JSON.stringify(name)}];
  if (!s) return { packages: 0, bytes: 0, topics: {}, buses: 0, ready: p.ready, error: p.error, own: p.own };
  return { packages: s.packages, bytes: s.bytes, topics: s.topics, buses: Object.keys(s.buses).length, ready: p.ready, error: p.error, own: p.own };
})()`

// Sends a package as a bus would, with our busId, so other buses take it.
const SEND = (items) => `(function () {
  var p = window.CROSSCHECK_P04;
  if (!p || !p.ready) return "not ready";
  try {
    p.listener.send("wt.eb.evt", { busId: p.busId, packagedId: Math.floor(Math.random() * 1e9), data: ${items} });
    return "sent";
  } catch (e) { return "threw: " + e; }
})()`

const LAST = (name, topics) => `(function () {
  var p = window.CROSSCHECK_P04;
  var s = p && p.phases[${JSON.stringify(name)}];
  if (!s) return [];
  var want = ${JSON.stringify(topics)};
  var out = [];
  for (var i = 0; i < want.length; i++) { var v = s.last[want[i]]; if (v) out.push({ topic: want[i], data: v.data, isCached: v.isCached }); }
  return out;
})()`

const CLEAN = `(function () {
  var p = window.CROSSCHECK_P04;
  if (!p) return "nothing";
  try { if (p.listener && p.listener.unregister) p.listener.unregister(); } catch (e) {}
  window.CROSSCHECK_P04 = undefined;
  return "cleaned";
})()`

// ---------------------------------------------------------------- main

const ALL_STEPS = [
  { name: "idle", say: "Hands off for ten seconds.", ms: 10_000, auto: true },
  { name: "zoom in", say: "Zoom the M F D's map in by one step, when you hear the beep.", ms: 8000 },
  { name: "zoom out", say: "Zoom the M F D's map back out by one step, when you hear the beep.", ms: 8000 },
  { name: "page", say: "Open another page on the M F D, when you hear the beep.", ms: 8000 },
  { name: "waypoint", say: "Add a waypoint to the flight plan. Press Page Down when you're done.", ms: 120_000, untilKey: true },
]
// --steps "idle,zoom in,zoom out" runs only those; idle and zoom in always run,
// since steps 6 and 7 need them.
const STEPS = opt("--steps") ? ALL_STEPS.filter((s) => s.auto || s.name === "zoom in" || opt("--steps").split(",").map((x) => x.trim()).includes(s.name)) : ALL_STEPS

// Where steps 6 and 7 send from. A listener hears no package sent from its own
// document: the MFD's heard 4 of the G3000's 5 buses and the EFB's all 5
// (measured on MSFS 2024, 2026-10-06, results/p04-eventbus-2026-10-06-18-24-26),
// and a zoom-in sent again from the MFD's document left the MFD's map as it was.
const SEND_FROM = opt("--send-from") ?? "display"

async function main() {
  rec.open()
  const keys = await startKeys()
  const beep = startBeeper()
  const say = startSpeaker()
  const shooter = startShooter(join(dirname(rec.files.txt), `p04-eventbus-${rec.when}`))
  let sim = null
  try { sim = await Sim.connect(rec, { name: "CROSSCHECK p04 eventbus" }) } catch (e) { rec.log("sim", `no SimConnect: ${e.message}`) }
  const title = sim ? (await sim.readStrings(["TITLE"])).get("TITLE") ?? null : null
  find(`Aircraft: ${title ?? "unknown"}.`)

  const pages = await listPages()
  rec.log("pages", pages.map((p) => `${p.id} ${p.title}`).join(" | "))
  let display
  try {
    display = selectPage(pages, opt("--page") ?? "MFD")
  } catch (e) {
    find(`No display to listen in: ${e.message.split("\n")[0]}. Run again with --page <title or id>.`)
    return finish(null, shooter, sim)
  }
  const docs = [{ role: "display", page: display }]
  const efb = pages.find((p) => p.title === "Electronic Flight Bag")
  if (efb) docs.push({ role: "EFB", page: efb })
  const toolbar = pages.find((p) => /tool ?bar/i.test(String(p.title)))
  if (toolbar) docs.push({ role: "toolbar", page: toolbar })

  for (const d of docs) {
    d.insp = new Inspector(d.page.id)
    await d.insp.open()
    d.install = await d.insp.evaluate(INSTALL)
    rec.log("install", `${d.role} (${d.page.title}): ${JSON.stringify(d.install)}`)
  }
  await sleep(1000)
  for (const d of docs) {
    const s = await d.insp.evaluate(SUMMARY("setup"))
    find(`${d.role} (${JSON.stringify(d.page.title)}): ${d.install.registered ? `listener ${s.ready ? "ready" : "not ready after 1s"}` : `no listener: ${d.install.error}`}.`)
  }

  const all = (expr) => Promise.all(docs.map((d) => d.insp.evaluate(expr).catch((e) => ({ error: e.message }))))
  const results = {}

  beep(880, 150)
  say("Avionics on, and the M F D in view. Keep the sim in front, and press Page Down.")
  rec.log("prompt", "Avionics on, MFD in view, sim in front, Page Down.")
  await keys.next()

  for (const step of STEPS) {
    if (!step.auto) {
      say(step.say)
      await sleep(Math.min(4000, 600 + step.say.length * 45))
      beep(1000, 120)
    } else {
      say(step.say)
    }
    await all(SET_PHASE(step.name))
    const t0 = Date.now()
    if (step.untilKey) {
      const k = await Promise.race([keys.next(), sleep(step.ms).then(() => null)])
      rec.log("key", k ? `${k.key} after ${((Date.now() - t0) / 1000).toFixed(1)}s` : "no key: the step timed out")
    } else {
      await sleep(step.ms)
    }
    await all(SET_PHASE("between"))
    const secs = (Date.now() - t0) / 1000
    results[step.name] = { secs, docs: await all(SUMMARY(step.name)) }
    beep(600, 120)
    const line = docs.map((d, i) => {
      const s = results[step.name].docs[i]
      return `${d.role} ${s ? `${s.packages} packages from ${s.buses} buses, ${Object.keys(s.topics).length} topics, ${(s.bytes / 1024).toFixed(1)} KB` : "nothing"}`
    }).join("; ")
    find(`${step.name}, ${secs.toFixed(1)}s: ${line}.`)
    rec.data("topics", step.name, { topics: results[step.name].docs.map((s, i) => ({ role: docs[i].role, topics: s?.topics ?? null })) })
  }

  // Topics that changed in a step and not while idle, as heard by the display.
  const idle = new Set(Object.keys(results.idle.docs[0]?.topics ?? {}))
  const fresh = (name) => Object.keys(results[name].docs[0]?.topics ?? {}).filter((t) => !idle.has(t))
  for (const name of ["zoom in", "zoom out", "page", "waypoint"].filter((n) => results[n])) {
    const f = fresh(name)
    find(`New in "${name}", heard by the display: ${f.length} topics${f.length ? `: ${f.slice(0, 25).join(", ")}${f.length > 25 ? ", ..." : ""}` : ""}.`)
  }

  const sender = docs.find((d) => d.role.toLowerCase() === SEND_FROM.toLowerCase()) ?? docs[0]

  // 6. A resync request from our listener.
  say("Hands off.")
  await all(SET_PHASE("resync"))
  const sent = await sender.insp.evaluate(SEND(JSON.stringify([{ topic: "event_bus", data: "resync_request", isCached: false }])))
  await sleep(5000)
  await all(SET_PHASE("after"))
  const resync = await all(SUMMARY("resync"))
  find(`resync_request sent from the ${sender.role}'s listener (${sent}): in 5s, ${docs.map((d, i) => `${d.role} heard ${resync[i]?.packages ?? 0} packages, ${Object.keys(resync[i]?.topics ?? {}).length} topics`).join("; ")}.`)

  // 7. The zoom-in topics, sent again after the pilot zoomed back out, with the
  // values the sender's own listener heard.
  // A setting arrives as { value, syncTime }, and a bus that keeps the newest
  // write would drop one older than the pilot's zoom out, so it goes with
  // syncTime set to now (results/p04-eventbus-2026-10-06-18-24-26.ndjson).
  const heard = await sender.insp.evaluate(LAST("zoom in", fresh("zoom in")))
  const items = heard.map((x) => (x.data && typeof x.data === "object" && "syncTime" in x.data ? { ...x, data: { ...x.data, syncTime: Date.now() } } : x))
  if (!items.length) {
    find("No topics from the zoom-in step to send again.")
  } else {
    const before = await shooter.shot("before-replay")
    rec.log("shot", before.error ?? `saved ${repoRelative(before.file)}`)
    const r = await sender.insp.evaluate(SEND(JSON.stringify(items)))
    await sleep(1500)
    const after = await shooter.shot("after-replay")
    rec.log("shot", after.error ?? `saved ${repoRelative(after.file)}`)
    rec.data("replay", "sent", { items })
    find(`Sent the zoom-in step's ${items.length} topics again from the ${sender.role}'s listener (${r}): ${items.map((x) => `${x.topic} ${JSON.stringify(x.data).slice(0, 60)}`).slice(0, 15).join(", ")}${items.length > 15 ? ", ..." : ""}. Compare the screenshots before and after.`)
  }

  return finish(docs, shooter, sim)
}

async function finish(docs, shooter, sim) {
  for (const d of docs ?? []) { try { await d.insp.evaluate(CLEAN) } catch { /* gone */ } d.insp.close() }
  startSpeaker()("Done.")
  const text = scrub([`p04-eventbus, started ${new Date(rec.started).toISOString()}`, "", ...findings.map((f) => `- ${f}`)].join("\n"))
  rec.writeReport(text)
  console.log("\n" + text)
  console.log(`saved ${repoRelative(rec.files.txt)}`)
  shooter.close()
  sim?.close()
  await rec.close()
  process.exit(0)
}

main().catch(async (e) => {
  rec.log("error", e.stack ?? String(e))
  await rec.close()
  process.exit(1)
})
