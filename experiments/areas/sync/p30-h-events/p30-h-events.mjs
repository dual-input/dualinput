/*
 * p30: which way of firing an H: event from a module reaches the cockpit's JavaScript. Our
 * module's way reached no panel in stage 14's session (record/areas/sync/log.md, 2026-11-09).
 * p30's module (module/src/lib.rs) fires DUALINPUT_P30_TEST_<n> in five ways; this sets
 * L:DUALINPUT_P30_FIRE to each way through the inspector, listens for every H: event in every
 * cockpit panel beside the stock handlers, and reports, for each way, the ID and the error the
 * SDK's calls gave, and how many panels heard its event. Any flight with cockpit panels does;
 * the test events touch nothing of the aircraft.
 *
 *   node experiments/areas/sync/p30-h-events/build.mjs --install    with the sim closed
 *   node experiments/areas/sync/p30-h-events/p30-h-events.mjs       with a flight loaded
 */

import { Inspector, listPages } from "../../../tools/inspector.mjs"
import { saveResult, repoRelative } from "../../../tools/results.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const WAYS = {
  1: "fsEventsHEventCall, size 0, a null array (our module's way)",
  2: "fsEventsHEventCall, size 0, an array that points at a value",
  3: "fsEventsHEventCall, one integer value, 0",
  4: "fsEventsRegisterHEvent of the name with its H:",
  5: "execute_calculator_code(\"(>H:...)\"), FS Copilot's way",
}

const pages = (await listPages()).filter((p) => /^VCockpit/i.test(p.title))
if (pages.length === 0) throw new Error("no cockpit panel answers on the inspector; load a flight first")
const panels = []
for (const page of pages) {
  try {
    panels.push({ page, insp: await new Inspector(page.id).open() })
  } catch (e) {
    console.log(`${page.title}: ${e.message}`)
  }
}
const lines = [`p30 H: events, ${new Date().toISOString()}, ${panels.length} cockpit panels listening`]
const say = (line) => {
  console.log(line)
  lines.push(line)
}

// A handler beside the stock ones in every panel, which keeps each H: event's name.
for (const { insp } of panels) {
  await insp.evaluate(`(function () {
    window.DUALINPUT_P30_HEARD = [];
    if (!window.DUALINPUT_P30_HANDLER) {
      window.DUALINPUT_P30_HANDLER = Coherent.on("OnInteractionEvent", function (t, a) { window.DUALINPUT_P30_HEARD.push(String(a && a[0])); });
    }
    return 0;
  })()`)
}
const first = panels[0].insp
const read = (name) => first.evaluate(`SimVar.GetSimVarValue(${JSON.stringify(`L:DUALINPUT_P30_${name}`)}, "number")`)
const frames = await read("FRAMES")
await sleep(1_500)
const later = await read("FRAMES")
say(`the module's frame count went from ${frames} to ${later} in 1.5s${later > frames ? "" : ", so the module isn't running"}`)

for (const [way, what] of Object.entries(WAYS)) {
  await first.evaluate(`SimVar.SetSimVarValue("L:DUALINPUT_P30_FIRE", "number", ${way}); 0`)
  await sleep(1_500)
  const left = await read("FIRE")
  const id = await read(`ID_${way}`)
  const error = await read(`ERROR_${way}`)
  const heardIn = []
  for (const { page, insp } of panels) {
    const heard = await insp.evaluate("window.DUALINPUT_P30_HEARD || []")
    if (heard.some((n) => n === `DUALINPUT_P30_TEST_${way}` || n === `H:DUALINPUT_P30_TEST_${way}`)) heardIn.push(page.title)
  }
  say(`way ${way}, ${what}: ${left === 0 ? "fired" : "never taken"}, id ${id}, returned ${error}, heard in ${heardIn.length} of ${panels.length} panels${heardIn.length ? ` (${heardIn.join(", ")})` : ""}`)
}

// Every name any panel heard, so a test event under an unexpected spelling still shows.
const all = new Set()
for (const { insp } of panels) for (const n of await insp.evaluate("window.DUALINPUT_P30_HEARD || []")) all.add(n)
say(`every H: event the panels heard: ${[...all].join(", ") || "none"}`)
for (const { insp } of panels) insp.close()
const file = saveResult("sync", "p30-h-events", lines.join("\n"))
console.log(`\nsaved ${repoRelative(file)}`)
