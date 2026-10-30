/*
 * p21: what an EFB app's page gets in the EFB's landscape orientation, at each
 * of its three sizes, beside portrait, since stage 11b's EFB app frames are
 * drawn at a fixed 516 by 716 (user, 2026-10-30).
 *
 *   node experiments/areas/interface/p21-efb-landscape.mjs
 *
 * Needs MSFS 2024 running, at the start screen, the home page, or Free flight's
 * world map: from the first two it presses Start and Free flight in mainUi with
 * mouse events, as p10's menu script does. Nobody needs to touch anything.
 *
 * The EFB keeps two settings, orientationMode (Vertical 0, Horizontal 1) and
 * efbSize (Small 0, Medium 1, Large 2), and hands each change to the sim with
 * Coherent.call("SET_ORIENTATION") or ("SET_SIZE"). It takes them from the sim
 * as SET_2D_ORIENTATION and SET_2D_SIZE, the orientation only while the EFB is
 * 2D and not popped out. Its sizeUpdate then calls the layout portrait when the
 * window is no wider than tall, sizes its borders from a 516 by 716 base or a
 * 716 by 516 one, and publishes the app area as window.PanelSize and the
 * orientation as window.PanelInfo.orientation (read in fs-base-efb 0.1.10,
 * efb_os.js). engine.trigger runs the document's own handlers before it reaches
 * the sim (record/areas/interface/log.md, 2026-10-06), so this sends the two
 * events from the EFB's document, as the sim would, and falls back to the
 * Coherent calls if the EFB doesn't take them.
 *
 * At each of the six layouts it reads the window, the EFB's size variables,
 * PanelInfo and PanelSize, which of efb_os.css's media queries match, and the
 * elements under the window's center with their boxes, with the Settings app
 * open, and screenshots the sim. It also counts the resize events and PanelInfo
 * changes an app would hear, and puts both settings back as it found them.
 */

import fs from "node:fs"
import path from "node:path"

import { Inspector, listPages } from "../../tools/inspector.mjs"
import { repoRelative, resultFile, stamp } from "../../tools/results.mjs"
import { startKeySender } from "../../tools/sendkeys.mjs"
import { startShooter } from "../../tools/shot.mjs"

const ORIENTATIONS = { Vertical: 0, Horizontal: 1 }
const SIZES = { Small: 0, Medium: 1, Large: 2 }
const SETTINGS_APP = "SettingsApp"

const when = stamp()
const lines = []
const note = (...texts) => { for (const t of texts) { lines.push(t); console.log(t) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- in mainUi

// The menu's screens by the names their components give them, and a press as
// mouse events at a button's center (record/areas/interface/log.md,
// 2026-10-06; experiments/areas/interface/menu/build.mjs). ES2017's syntax.
const MENU = `(function () {
  function named(name) {
    var els = document.querySelectorAll('[name="' + name + '"]');
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0) return els[i];
    }
    return null;
  }
  function exposed(path) {
    var el = named(path[0]);
    for (var i = 1; el && i < path.length; i++) el = typeof el.getExposedChild === "function" ? el.getExposedChild(path[i]) : null;
    return el || null;
  }
  window.DUALINPUT_P21_MENU = {
    screen: function () {
      return { start: !!named("Startpage"), home: !!named("Homepage"), worldMap: !!named("FreeFlightPage") };
    },
    press: function (path) {
      var el = exposed(path);
      if (!el) return { found: false };
      var r = el.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var target = document.elementFromPoint(x, y) || el;
      var types = ["mouseover", "mousedown", "mouseup", "click"];
      for (var i = 0; i < types.length; i++) {
        var ev = document.createEvent("MouseEvents");
        ev.initMouseEvent(types[i], true, true, window, 1, x, y, x, y, false, false, false, false, 0, null);
        target.dispatchEvent(ev);
      }
      return { found: true, x: Math.round(x), y: Math.round(y) };
    }
  };
  return window.DUALINPUT_P21_MENU.screen();
})()`

// ---------------------------------------------------------------- in the EFB's document

const INSTALL = `(function () {
  var p = window.DUALINPUT_P21;
  if (p) return "installed already";
  p = window.DUALINPUT_P21 = { events: [], subs: [], t0: Date.now() };
  var log = function (kind, v) { p.events.push({ ms: Date.now() - p.t0, kind: kind, v: v }); };
  p.onResize = function () { log("resize", [window.innerWidth, window.innerHeight]); };
  window.addEventListener("resize", p.onResize);
  try {
    p.subs.push(window.PanelInfo.orientation.sub(function (v) { log("orientation", v); }));
    p.subs.push(window.PanelSize.width.sub(function (v) { log("width", v); }));
    p.subs.push(window.PanelSize.height.sub(function (v) { log("height", v); }));
  } catch (e) { log("sub-error", String(e)); }
  return "installed";
})()`

const CLEAN = `(function () {
  var p = window.DUALINPUT_P21;
  if (!p) return "nothing";
  window.removeEventListener("resize", p.onResize);
  for (var i = 0; i < p.subs.length; i++) { try { p.subs[i].destroy(); } catch (e) {} }
  window.DUALINPUT_P21 = undefined;
  return "cleaned";
})()`

// The setting as the EFB saved it, through dataStorage.js's GetStoredData,
// under the save manager's key "efb-settings" (read in efb_os.js).
const STORED = `(function () {
  var out = {};
  var names = ["orientationMode", "efbSize", "mode"];
  for (var i = 0; i < names.length; i++) {
    try { out[names[i]] = typeof GetStoredData === "function" ? GetStoredData("efb-settings." + names[i]) : "no GetStoredData"; }
    catch (e) { out[names[i]] = "threw: " + e; }
  }
  return out;
})()`

const READ = `(function () {
  var cs = getComputedStyle(document.body);
  var v = function (n) { var s = cs.getPropertyValue(n); return s === "" ? null : s.trim(); };
  var g = function (s) { try { return s.get(); } catch (e) { return "unreadable"; } };
  var mq = function (q) { try { return window.matchMedia(q).matches; } catch (e) { return "unreadable"; } };
  var chain = [];
  var el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  for (var i = 0; el && el !== document.documentElement && i < 16; i++, el = el.parentElement) {
    var r = el.getBoundingClientRect();
    var cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
    chain.push(el.tagName.toLowerCase() + (cls ? "." + String(cls).trim().split(/\\s+/).join(".") : "") + " " + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height));
  }
  var actions = document.querySelector(".panel-ui-actions");
  return {
    window: [window.innerWidth, window.innerHeight],
    vars: { viewport: [v("--viewportWidth"), v("--viewportHeight")], panel: [v("--panel-width"), v("--panel-height")], border: [v("--border-width"), v("--border-height")], base: [v("--base-width"), v("--base-height")] },
    info: { orientation: g(window.PanelInfo.orientation), is2D: g(window.PanelInfo.is2D), externalized: g(window.PanelInfo.isExternalized), size: [g(window.PanelSize.width), g(window.PanelSize.height)] },
    media: { landscape: mq("(orientation: landscape)"), "max-width 516": mq("(max-width: 516px)"), "max-height 716": mq("(max-height: 716px)") },
    open: actions ? String(actions.className).indexOf("panel-ui-actions--hidden") < 0 : "no action bar",
    chain: chain
  };
})()`

// Lines of the Settings app's text that name the EFB's layout, so the log can
// say where a pilot changes it.
const SETTINGS_TEXT = `(function () {
  var text = String(document.body.innerText || "");
  var out = [];
  var rows = text.split(/\\n+/);
  for (var i = 0; i < rows.length && out.length < 24; i++) {
    var r = rows[i].trim();
    if (r && /orient|portrait|landscape|horizontal|vertical|size|small|medium|large|tablet/i.test(r)) out.push(r.slice(0, 80));
  }
  return out;
})()`

const trigger = (name, ...args) => `(function () { try { engine.trigger.apply(engine, ${JSON.stringify([name, ...args])}); return "sent"; } catch (e) { return "threw: " + e; } })()`
const call = (name, ...args) => `(function () { try { Coherent.call.apply(Coherent, ${JSON.stringify([name, ...args])}); return "called"; } catch (e) { return "threw: " + e; } })()`

// ---------------------------------------------------------------- the steps

async function pages() {
  const list = await listPages()
  return {
    menu: list.find((p) => /mainUi/i.test(String(p.title)) || /mainUI\.html/i.test(String(p.url))),
    efb: list.find((p) => String(p.title || "") === "Electronic Flight Bag"),
  }
}

async function toWorldMap() {
  const t0 = Date.now()
  let last = ""
  while (Date.now() - t0 < 180000) {
    const { menu: page } = await pages().catch(() => ({}))
    if (!page) { await sleep(3000); continue }
    const menu = new Inspector(page.id)
    try {
      await menu.open()
      const screen = await menu.evaluate(MENU)
      const now = JSON.stringify(screen)
      if (now !== last) { note(`  ${((Date.now() - t0) / 1000).toFixed(1)}s, the menu: ${now}`); last = now }
      if (screen.worldMap) return true
      if (screen.start) note(`  pressed Start: ${JSON.stringify(await menu.evaluate(`DUALINPUT_P21_MENU.press(["Startpage", "Button_Start"])`))}`)
      else if (screen.home) note(`  pressed Free flight: ${JSON.stringify(await menu.evaluate(`DUALINPUT_P21_MENU.press(["Homepage", "Tiles", "FreeflightButton"])`))}`)
    } catch (e) {
      note(`  the menu: ${e.message}`)
    } finally {
      menu.close()
    }
    await sleep(4000)
  }
  return false
}

const sameLayout = (r, o, w, h) => r.info.orientation === o && (w == null || (r.info.size[0] === w && r.info.size[1] === h))

// Sends one setting the way the sim does, and if the EFB's layout doesn't
// follow within 3s, the Coherent call the EFB itself makes.
async function set(efb, event, coherent, value, settled) {
  await efb.evaluate(trigger(event, value))
  for (let t = 0; t < 3000; t += 250) {
    await sleep(250)
    const r = await efb.evaluate(READ)
    if (settled(r)) return { how: event, r }
  }
  await efb.evaluate(call(coherent, value))
  for (let t = 0; t < 3000; t += 250) {
    await sleep(250)
    const r = await efb.evaluate(READ)
    if (settled(r)) return { how: coherent, r }
  }
  return { how: "neither", r: await efb.evaluate(READ) }
}

function describe(r) {
  return [
    `    window ${r.window.join(" x ")}; app area, PanelSize, ${r.info.size.join(" x ")}; orientation ${r.info.orientation === 1 ? "Horizontal" : r.info.orientation === 0 ? "Vertical" : r.info.orientation}; 2D ${r.info.is2D}; popped out ${r.info.externalized}; open ${r.open}`,
    `    --viewport ${r.vars.viewport.join(" x ")}; --panel ${r.vars.panel.join(" x ")}; --border ${r.vars.border.join(" x ")}; --base ${r.vars.base.join(" x ")}`,
    `    media: ${Object.entries(r.media).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    "    under the center, innermost first:",
    ...r.chain.map((c) => `      ${c}`),
  ]
}

async function main() {
  note(`p21-efb-landscape, ${new Date().toISOString()}`, "")
  note("To the world map:")
  if (!(await toWorldMap())) throw new Error("didn't reach Free flight's world map in 180s")
  await sleep(2000)

  const { efb: efbPage } = await pages()
  if (!efbPage) throw new Error("no EFB document at the world map")
  const efb = new Inspector(efbPage.id)
  await efb.open()
  const keys = startKeySender()
  const shooter = startShooter(path.join(path.dirname(resultFile("interface", "p21-efb-landscape", "txt", when)), `p21-efb-landscape-${when}`))
  let stored
  try {
    note("", `In the EFB's document: ${await efb.evaluate(INSTALL)}`)
    stored = await efb.evaluate(STORED)
    note(`Its stored settings: ${JSON.stringify(stored)}`)
    let r = await efb.evaluate(READ)
    note("Before:", ...describe(r))

    if (r.open !== true) {
      note(`The EFB is closed, so TOGGLE_EFB: ${await efb.evaluate(call("TOGGLE_EFB"))}`)
      await sleep(2000)
    }
    note(`OPEN_BY_KEY ${SETTINGS_APP}: ${await efb.evaluate(trigger("OPEN_BY_KEY", SETTINGS_APP, "", ""))}`)
    await sleep(1500)
    note(`The sim's window: ${await keys.focus()}`)

    for (const [oName, o] of Object.entries(ORIENTATIONS)) {
      for (const [sName, s] of Object.entries(SIZES)) {
        note("", `${oName}, ${sName}:`)
        const before = await efb.evaluate(READ)
        const or = await set(efb, "SET_2D_ORIENTATION", "SET_ORIENTATION", o, (x) => sameLayout(x, o))
        note(`  the orientation took ${or.how}`)
        // A size change shows as a new PanelSize; the first step may already be
        // at that size, so give it a moment and take what's there.
        const sz = await set(efb, "SET_2D_SIZE", "SET_SIZE", s, (x) => sameLayout(x, o) && (x.info.size[0] !== before.info.size[0] || x.info.size[1] !== before.info.size[1] || x.info.orientation !== before.info.orientation))
        note(`  the size took ${sz.how}`)
        await sleep(1200)
        r = await efb.evaluate(READ)
        note(...describe(r))
        const shot = await shooter.shot(`${oName.toLowerCase()}-${sName.toLowerCase()}`)
        note(`  screenshot: ${shot.error ? shot.error : `${repoRelative(shot.file)}, the sim's window ${shot.width} x ${shot.height}`}`)
      }
    }

    note("", `The Settings app's lines about the layout: ${JSON.stringify(await efb.evaluate(SETTINGS_TEXT))}`)
    const events = await efb.evaluate("window.DUALINPUT_P21.events")
    const counts = {}
    for (const e of events) counts[e.kind] = (counts[e.kind] || 0) + 1
    note(`What an app would have heard, by kind: ${JSON.stringify(counts)}`)
    note(...events.slice(0, 60).map((e) => `  ${String(e.ms).padStart(6)}ms ${e.kind} ${JSON.stringify(e.v)}`))
  } finally {
    // Back as the EFB had them, or its defaults, Vertical and Small.
    const o = Number.isInteger(Number(stored?.orientationMode)) && stored?.orientationMode !== "" ? Number(stored.orientationMode) : 0
    const s = Number.isInteger(Number(stored?.efbSize)) && stored?.efbSize !== "" ? Number(stored.efbSize) : 0
    try {
      await efb.evaluate(trigger("SET_2D_ORIENTATION", o))
      await efb.evaluate(trigger("SET_2D_SIZE", s))
      await sleep(1500)
      note("", `Put back to orientation ${o}, size ${s}; stored now: ${JSON.stringify(await efb.evaluate(STORED))}`)
      note(...describe(await efb.evaluate(READ)))
      note(`Cleanup: ${await efb.evaluate(CLEAN)}`)
    } catch (e) { note(`Putting back failed: ${e.message}`) }
    efb.close()
    keys.close()
    shooter.close()
  }
  const file = resultFile("interface", "p21-efb-landscape", "txt", when)
  fs.writeFileSync(file, lines.join("\n") + "\n")
  console.log(`saved ${repoRelative(file)}`)
}

main().catch((e) => {
  note(`p21 stopped: ${e.stack ?? String(e)}`)
  const file = resultFile("interface", "p21-efb-landscape", "txt", when)
  fs.writeFileSync(file, lines.join("\n") + "\n")
  console.log(`saved ${repoRelative(file)}`)
  process.exit(1)
})
