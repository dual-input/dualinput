/*
 * p24's last part: how zoom behaves in the sim's own EFB, at each of the tablet's sizes. Install
 * build-efb.mjs's package first, and start the sim.
 *
 *   node experiments/areas/interface/p24-efb-scale/efb.mjs
 *
 * It goes to Free flight's world map, opens the EFB onto our app, and at Small, Medium, and Large reads
 * the root's zoom and sizes, and where hit testing finds a button, against the two places it could be,
 * then saves a picture. It puts the tablet's size back as the EFB had it, and leaves the EFB open on the
 * app for a pilot to press.
 */

import fs from "node:fs"
import path from "node:path"

import { startBeeper } from "../../../tools/guide.mjs"
import { Inspector, listPages } from "../../../tools/inspector.mjs"
import { repoRelative, resultFile, stamp } from "../../../tools/results.mjs"
import { startKeySender } from "../../../tools/sendkeys.mjs"
import { startShooter } from "../../../tools/shot.mjs"

const APP = "DualInputP24"
const SIZES = { Small: 0, Medium: 1, Large: 2 }
const when = stamp()
const lines = []
const note = (...texts) => { for (const t of texts) { lines.push(t); console.log(t) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const save = () => {
  const file = resultFile("interface", "p24-efb-scale-efb", "txt", when)
  fs.writeFileSync(file, lines.join("\n") + "\n")
  console.log(`saved ${repoRelative(file)}`)
}

// The menu's screens by the names their components give them, and a press as mouse events at a button's
// center, as p21 does. ES2017's syntax.
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
  window.DUALINPUT_P24_MENU = {
    screen: function () { return { start: !!named("Startpage"), home: !!named("Homepage"), worldMap: !!named("FreeFlightPage") }; },
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
      return { found: true };
    }
  };
  return window.DUALINPUT_P24_MENU.screen();
})()`

const trigger = (name, ...args) => `(function () { try { engine.trigger.apply(engine, ${JSON.stringify([name, ...args])}); return "sent"; } catch (e) { return "threw: " + e; } })()`
const call = (name, ...args) => `(function () { try { Coherent.call.apply(Coherent, ${JSON.stringify([name, ...args])}); return "called"; } catch (e) { return "threw: " + e; } })()`

// What the page does under zoom. Where a rect says a box is can read two ways with the root away from
// the document's corner, so hit testing is asked at each.
const READ = `(function () {
  var root = document.querySelector(".dualinput-ui");
  var out = { registered: !!window.DUALINPUT_EFB_REGISTERED, found: !!root };
  var open = document.querySelector(".panel-ui-actions");
  out.efbOpen = open ? String(open.className).indexOf("panel-ui-actions--hidden") < 0 : "no action bar";
  try { out.panel = [window.PanelSize.width.get(), window.PanelSize.height.get()]; } catch (e) { out.panel = String(e); }
  out.window = [window.innerWidth, window.innerHeight];
  if (!root) return out;
  var host = root.parentNode;
  var cs = getComputedStyle(root);
  var z = parseFloat(cs.zoom);
  var rr = root.getBoundingClientRect();
  var hr = host.getBoundingClientRect();
  out.zoom = z;
  out.hair = cs.getPropertyValue("--hair");
  out.host = { offset: [host.offsetWidth, host.offsetHeight], rect: [hr.left, hr.top, hr.width, hr.height] };
  out.root = { offset: [root.offsetWidth, root.offsetHeight], rect: [rr.left, rr.top, rr.width, rr.height] };
  out.font = cs.fontFamily;
  var button = null;
  var all = root.querySelectorAll("button");
  for (var i = 0; i < all.length; i++) { if (all[i].textContent.trim() === "Host a session") { button = all[i]; break; } }
  if (button) {
    var b = button.getBoundingClientRect();
    var name = function (x, y) { var h = document.elementFromPoint(x, y); if (!h) return "nothing"; return (h === button || button.contains(h)) ? "the button" : (h.nodeName + "." + String(h.className).slice(0, 24)); };
    var cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    out.button = {
      offset: [button.offsetWidth, button.offsetHeight], rect: [b.left, b.top, b.width, b.height],
      "hit at the rect": name(cx, cy),
      "hit at the rect times zoom": name(cx * z, cy * z),
      "hit from the host's corner": name(hr.left + (cx - rr.left) * z, hr.top + (cy - rr.top) * z)
    };
  }
  var serif = document.createElement("span");
  serif.style.cssText = "position:absolute;visibility:hidden;font-family:serif;font-size:40px";
  serif.textContent = "Fly together";
  root.appendChild(serif);
  var geist = serif.cloneNode(true);
  geist.style.fontFamily = '"DualInput Geist"';
  root.appendChild(geist);
  out.geistWidth = [geist.offsetWidth, "serif", serif.offsetWidth];
  root.removeChild(serif);
  root.removeChild(geist);
  return out;
})()`

async function pages() {
  const list = await listPages()
  return {
    menu: list.find((p) => /mainUi/i.test(String(p.title)) || /mainUI\.html/i.test(String(p.url))),
    efb: list.find((p) => String(p.title || "") === "Electronic Flight Bag"),
  }
}

async function toWorldMap() {
  const t0 = Date.now()
  while (Date.now() - t0 < 240000) {
    const { menu: page } = await pages().catch(() => ({}))
    if (!page) { await sleep(3000); continue }
    const menu = new Inspector(page.id)
    try {
      await menu.open()
      const screen = await menu.evaluate(MENU)
      if (screen.worldMap) return true
      if (screen.start) await menu.evaluate(`DUALINPUT_P24_MENU.press(["Startpage", "Button_Start"])`)
      else if (screen.home) await menu.evaluate(`DUALINPUT_P24_MENU.press(["Homepage", "Tiles", "FreeflightButton"])`)
    } catch (e) {
      note(`  the menu: ${e.message}`)
    } finally {
      menu.close()
    }
    await sleep(4000)
  }
  return false
}

async function main() {
  note(`p24-efb-scale efb, ${new Date().toISOString()}`, "")
  if (!(await toWorldMap())) throw new Error("didn't reach Free flight's world map in 240s")
  await sleep(2000)
  const { efb: page } = await pages()
  if (!page) throw new Error("no EFB document at the world map")
  const efb = new Inspector(page.id)
  await efb.open()
  const keys = startKeySender()
  const beep = startBeeper()
  const shooter = startShooter(path.join(path.dirname(resultFile("interface", "p24-efb-scale-efb", "txt", when)), `p24-efb-scale-efb-${when}`))
  // The size as the EFB saved it, under its save manager's key (read in efb_os.js), or its default, Small.
  const stored = await efb.evaluate(`(function () { try { return GetStoredData("efb-settings.efbSize"); } catch (e) { return ""; } })()`)
  const before = Number.isInteger(Number(stored)) && stored !== "" ? Number(stored) : SIZES.Small
  note(`The tablet's size as saved: ${JSON.stringify(stored)}`)
  try {
    let r = await efb.evaluate(READ)
    note(`Before: ${JSON.stringify(r)}`)
    if (r.efbOpen !== true) {
      note(`TOGGLE_EFB: ${await efb.evaluate(call("TOGGLE_EFB"))}`)
      await sleep(2000)
    }
    note(`OPEN_BY_KEY ${APP}: ${await efb.evaluate(trigger("OPEN_BY_KEY", APP, "", ""))}`)
    await sleep(2000)
    // A picture taken with the sim behind another window comes out with the EFB's colors washed out,
    // so this waits for the pilot to bring it to the front, up to 3 minutes.
    let front = await keys.focus()
    for (let t = 0; /^NO/.test(front) && t < 180; t++) {
      if (t === 0) note("Bring the sim to the front. A beep says it's seen, and another says it's done.")
      await sleep(1000)
      front = await keys.focus()
    }
    note(`The sim's window: ${front}`)
    beep(1000, 150)
    await sleep(1000)
    for (const [name, value] of Object.entries(SIZES)) {
      note("", `${name}: ${await efb.evaluate(trigger("SET_2D_SIZE", value))}`)
      await sleep(2000)
      r = await efb.evaluate(READ)
      note(JSON.stringify(r, null, 1))
      const shot = await shooter.shot(name.toLowerCase())
      note(`screenshot: ${shot.error ? shot.error : `${repoRelative(shot.file)}, ${shot.width} x ${shot.height}`}`)
    }
  } finally {
    note("", `Back to size ${before}: ${await efb.evaluate(trigger("SET_2D_SIZE", before))}`)
    beep(1400, 150)
    await sleep(300)
    efb.close()
    keys.close()
    shooter.close()
  }
  save()
  // The beeper's process would keep this one open.
  process.exit(0)
}

main().catch((e) => {
  note(`p24 stopped: ${e.stack ?? String(e)}`)
  save()
  process.exit(1)
})
