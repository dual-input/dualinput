/*
 * p11: every UI component mainUi has loaded on a given screen, for choosing
 * the one a package of ours copies to load our script (p10, 2026-10-06: a copy
 * of a component mainUi loads brings our script in, and it stays in mainUi
 * until the cockpit). The best one is loaded on the first screen, tiny, and
 * of no interest to anyone who mods the sim.
 *
 *   node experiments/areas/interface/p11-menu-components.mjs --screen start
 *   node experiments/areas/interface/p11-menu-components.mjs --screen home
 *   node experiments/areas/interface/p11-menu-components.mjs --report
 *
 * --screen lists, through the inspector, every element in mainUi that carries
 * a component's resource-id, and saves the list as
 * results/p11-menu-components-<screen>.json. --report joins the saved lists
 * with the sim's own copies of those components in fs-base-ui's cookedcomps/
 * (their size, what's inside them, and how many other components place them)
 * and with every Community package that ships a copy of one, and writes
 * results/p11-menu-components-<time>.txt, best candidates first. It reads
 * only.
 */

import fs from "node:fs"
import path from "node:path"

import { Inspector, listPages } from "../../tools/inspector.mjs"
import { REPO, repoRelative, stamp } from "../../tools/results.mjs"

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null }
const RESULTS = path.join(REPO, "experiments", "areas", "interface", "results")
const snapshot = (screen) => path.join(RESULTS, `p11-menu-components-${screen}.json`)

// ---------------------------------------------------------------- --screen

async function capture(screen) {
  const pages = await listPages()
  const page = pages.find((p) => p.title === "mainUi")
  if (!page) throw new Error("no mainUi document")
  const insp = new Inspector(page.id)
  await insp.open()
  const found = await insp.evaluate(`(function () {
    var out = {};
    var els = document.querySelectorAll("[resource-id]");
    for (var i = 0; i < els.length; i++) {
      var id = String(els[i].getAttribute("resource-id")).toUpperCase();
      var r = els[i].getBoundingClientRect();
      var e = out[id] || (out[id] = { instances: 0, visible: 0, names: [] });
      e.instances++;
      if (r.width > 1 && r.height > 1) e.visible++;
      var n = els[i].getAttribute("name");
      if (n && e.names.indexOf(n) < 0 && e.names.length < 6) e.names.push(n);
    }
    return { href: String(location.href), components: out, total: els.length };
  })()`)
  insp.close()
  fs.mkdirSync(RESULTS, { recursive: true })
  fs.writeFileSync(snapshot(screen), JSON.stringify({ screen, at: new Date().toISOString(), ...found }, null, 1) + "\n")
  console.log(`${screen}: ${Object.keys(found.components).length} components in ${found.total} elements; saved ${repoRelative(snapshot(screen))}`)
}

// ---------------------------------------------------------------- --report

function stockDir() {
  const vdf = "C:/Program Files (x86)/Steam/steamapps/libraryfolders.vdf"
  const libraries = fs.existsSync(vdf) ? [...fs.readFileSync(vdf, "utf8").matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, "/")) : []
  for (const lib of libraries) {
    const dir = path.join(lib, "steamapps", "common", "Limitless", "Packages", "fs-base-ui", "cookedcomps")
    if (fs.existsSync(dir)) return dir
  }
  throw new Error("no fs-base-ui/cookedcomps in any Steam library")
}

function community() {
  const cfg = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt")
  const line = fs.readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/i.test(l))
  return path.join(line.match(/"([^"]+)"/)[1], "Community")
}

function report() {
  const screens = fs.readdirSync(RESULTS).filter((f) => /^p11-menu-components-[a-z-]+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS, f), "utf8")))
  if (!screens.length) throw new Error("no snapshots: run --screen first")
  const dir = stockDir()

  // Every stock component: size, the components it places, and who places it.
  const stock = new Map()
  for (const f of fs.readdirSync(dir).filter((x) => /^\{[0-9A-F-]{36}\}\.html$/i.test(x))) {
    const id = f.slice(1, 37).toUpperCase()
    const html = fs.readFileSync(path.join(dir, f), "utf8")
    const jsonFile = path.join(dir, f.replace(/\.html$/i, ".json"))
    const json = fs.existsSync(jsonFile) ? fs.readFileSync(jsonFile, "utf8") : ""
    let meta = {}
    try { meta = JSON.parse(json) } catch { /* not every component has one */ }
    const children = [...html.matchAll(/resource-id="\{([0-9A-F-]{36})\}"/gi)].map((m) => m[1].toUpperCase()).filter((c) => c !== id)
    stock.set(id, {
      html: html.length, json: json.length, children: new Set(children).size,
      root: html.match(/^<[^>]*?name="([^"]+)"/)?.[1] ?? "",
      animations: (meta.animations ?? []).length, exposed: (meta.exposedChildren ?? []).length, states: (meta.visualStates ?? []).length,
      placedBy: new Set(),
    })
  }
  for (const [id, s] of stock) for (const m of fs.readFileSync(path.join(dir, `{${id}}.html`), "utf8").matchAll(/resource-id="\{([0-9A-F-]{36})\}"/gi)) {
    const child = m[1].toUpperCase()
    if (child !== id && stock.has(child)) stock.get(child).placedBy.add(id)
  }

  // Every Community package's copies of components.
  const copied = new Map()
  for (const pkg of fs.readdirSync(community(), { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const cc = path.join(community(), pkg.name, "cookedcomps")
    if (!fs.existsSync(cc)) continue
    for (const f of fs.readdirSync(cc).filter((x) => /\.html$/i.test(x))) {
      const id = f.replace(/[{}]|\.html$/gi, "").toUpperCase()
      copied.set(id, [...(copied.get(id) ?? []), pkg.name])
    }
  }

  const rows = []
  const ids = new Set(screens.flatMap((s) => Object.keys(s.components).map((k) => k.replace(/[{}]/g, ""))))
  for (const id of ids) {
    const s = stock.get(id)
    const on = screens.filter((x) => x.components[`{${id}}`] ?? x.components[id])
    const first = on.map((x) => x.components[`{${id}}`] ?? x.components[id])
    rows.push({
      id, name: s?.root || first[0]?.names?.[0] || "?",
      screens: on.map((x) => x.screen).join("+"),
      instances: first.map((c) => c.instances).join("/"), visible: first.map((c) => c.visible).join("/"),
      html: s?.html ?? null, json: s?.json ?? null, children: s?.children ?? null,
      animations: s?.animations ?? null, exposed: s?.exposed ?? null, states: s?.states ?? null,
      placedBy: s ? s.placedBy.size : null, copiedBy: (copied.get(id) ?? []).filter((p) => !/^crosscheck-/.test(p)),
    })
  }
  // Leaves first, then fewest bytes; components on every screen ahead of the rest.
  const all = screens.map((s) => s.screen)
  rows.sort((a, b) => (b.screens.split("+").length - a.screens.split("+").length) || ((a.children ?? 99) === 0 ? 0 : 1) - ((b.children ?? 99) === 0 ? 0 : 1) || (a.html ?? 1e9) + (a.json ?? 0) - (b.html ?? 1e9) - (b.json ?? 0))
  const head = "GUID                                  name                                 screens       inst  vis   html  json  kids anim exp  st  placed  copied by"
  const lines = rows.map((r) => [
    r.id.padEnd(37), String(r.name).slice(0, 36).padEnd(37), r.screens.padEnd(13), String(r.instances).padEnd(5), String(r.visible).padEnd(5),
    String(r.html ?? "-").padStart(5), String(r.json ?? "-").padStart(6), String(r.children ?? "-").padStart(5), String(r.animations ?? "-").padStart(4),
    String(r.exposed ?? "-").padStart(4), String(r.states ?? "-").padStart(4), String(r.placedBy ?? "-").padStart(7), "  " + (r.copiedBy.join(", ") || "-"),
  ].join(""))
  const text = [
    `p11-menu-components, ${new Date().toISOString()}`,
    `Screens: ${screens.map((s) => `${s.screen} (${Object.keys(s.components).length} components, ${s.at})`).join("; ")}`,
    `Stock: fs-base-ui cookedcomps, ${stock.size} components. Community copies found: ${copied.size}.`,
    "Columns: instances and visible ones per screen; bytes of the stock .html and .json; kids, the components it places; anim, exp, st: its animations, exposed children, and visual states; placed, how many stock components place it; copied by, Community packages that ship a copy.",
    `Sorted: on all of ${all.join(", ")} first, then leaves (no kids), then smallest.`,
    "",
    head,
    ...lines,
  ].join("\n")
  const out = path.join(RESULTS, `p11-menu-components-${stamp()}.txt`)
  fs.writeFileSync(out, text + "\n")
  console.log(text)
  console.log(`\nsaved ${repoRelative(out)}`)
}

if (argv.includes("--report")) report()
else await capture(opt("--screen") ?? "start")
process.exit(0)
