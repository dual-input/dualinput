/*
 * p12: can code in mainUi tell which page of the menu is up, and bring the
 * menu back to its home page from any page? A Join that starts wherever the
 * pilot is would read the page, take the next step from there, and on a page
 * it doesn't know, first try to get home.
 *
 *   node experiments/areas/interface/p12-menu-navigate.mjs --where
 *   node experiments/areas/interface/p12-menu-navigate.mjs --home <label>
 *
 * The page is the large page components on screen in mainUi, by the names
 * their components give them, such as Startpage, Homepage, FreeFlightPage,
 * and Career_ConfirmationPage for Ready to fly (p10 and p11, 2026-10-06).
 * --home sends SHOW_WORLDMAP_HOMEPAGE, the flow event the start screen's Start
 * button sends (read in fs-base-ui 0.1.10, html_ui/Global/pkg/base.bundle.js,
 * StartPageManipulator.setButtons), as LaunchFlowEvent does it:
 * engine.trigger("LAUNCH_FLOW_EVENT_FROM_VIEW", ...) (read in
 * html_ui/Global/lib.js). The menu bar has no Home button, and none of the
 * 147 flow events the bundle sends is a plain back. It watches the page for
 * 10s and appends the result, with <label> naming the page it started from,
 * to results/p12-menu-navigate.ndjson.
 *
 * It goes through the inspector, standing in for our script, which runs in
 * the same document (p10, 2026-10-06).
 */

import fs from "node:fs"
import path from "node:path"

import { Inspector, listPages } from "../../tools/inspector.mjs"
import { REPO, repoRelative } from "../../tools/results.mjs"

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null }
const OUT = path.join(REPO, "experiments", "areas", "interface", "results", "p12-menu-navigate.ndjson")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Runs in mainUi: Chrome 49's syntax. Layers that are always there and say
// nothing about the page are left out.
const WHERE = `(function () {
  var skip = { MasterPage: 1, BlurPage: 1, MenuBarPage: 1, TitlePage: 1 };
  var out = [];
  var els = document.querySelectorAll("ui-resource-element[name]");
  for (var i = 0; i < els.length; i++) {
    var n = els[i].getAttribute("name");
    if (skip[n] || !/page/i.test(n)) continue;
    var r = els[i].getBoundingClientRect();
    if (r.width < window.innerWidth * 0.25 || r.height < window.innerHeight * 0.25) continue;
    var cs = window.getComputedStyle(els[i]);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) continue;
    out.push(n);
  }
  return out;
})()`

async function mainUi() {
  const page = (await listPages()).find((p) => p.title === "mainUi")
  if (!page) throw new Error("no mainUi document")
  const insp = new Inspector(page.id)
  await insp.open()
  return insp
}

if (argv.includes("--where")) {
  const insp = await mainUi()
  console.log(JSON.stringify(await insp.evaluate(WHERE)))
  insp.close()
} else {
  const label = opt("--home") ?? "unlabeled"
  const insp = await mainUi()
  const before = await insp.evaluate(WHERE)
  const t0 = Date.now()
  await insp.evaluate(`(function () { engine.trigger("LAUNCH_FLOW_EVENT_FROM_VIEW", "SHOW_WORLDMAP_HOMEPAGE", "StartPageManipulator"); return true; })()`)
  const seen = []
  let home = null
  while (Date.now() - t0 < 10_000) {
    await sleep(250)
    const now = await insp.evaluate(WHERE)
    const key = now.join(",")
    if (!seen.length || seen[seen.length - 1].pages !== key) seen.push({ ms: Date.now() - t0, pages: key })
    if (now.includes("Homepage") && !home) home = Date.now() - t0
  }
  insp.close()
  const r = { at: new Date().toISOString(), label, before, home, seen }
  fs.appendFileSync(OUT, JSON.stringify(r) + "\n")
  console.log(`${label}: before ${JSON.stringify(before)}; ${home !== null ? `home after ${home}ms` : "never home in 10s"}; pages seen: ${seen.map((s) => `${s.ms}ms [${s.pages}]`).join(" → ")}`)
  console.log(`appended to ${repoRelative(OUT)}`)
}
process.exit(0)
