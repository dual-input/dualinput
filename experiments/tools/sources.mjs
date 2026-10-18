/*
 * Reads the JavaScript a panel loaded, including the sim's own.
 *
 * Every panel document has the sim's scripts loaded, as the copies that won
 * the mount, and the inspector hands them over (FS Copilot fork,
 * record/pointer-forwarding/docs/09-environment.md). The stock VCockpit.js and
 * BaseInstrument.js are on disk in a Steam install too, in the
 * asobo-vcockpits-core and asobo-vcockpits-instruments packages
 * (record/areas/build/log.md, 2026-10-18).
 *
 *   node experiments/tools/sources.mjs <page> list              what the page loaded
 *   node experiments/tools/sources.mjs <page> grep <text>       search every loaded script
 *   node experiments/tools/sources.mjs <page> get <fragment>    print one, matched by url substring
 *   node experiments/tools/sources.mjs <page> dump              save every script to experiments/sim-sources/
 *
 * Nothing here writes into record/, because the output is Asobo's or an aircraft
 * developer's code.
 */

import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { listPages, selectPage, Inspector, flattenResources, resourceContent } from "./inspector.mjs"
import { simSourcesDir, slug } from "./results.mjs"

const [target, mode, ...rest] = process.argv.slice(2)
if (!target || !mode) {
  console.error("usage: node experiments/tools/sources.mjs <page> list|grep|get|dump [arg]")
  process.exit(1)
}

const page = selectPage(await listPages(), target)
const insp = new Inspector(page.id)
await insp.open()

try {
  await insp.send("Page.enable", {})
  const tree = await insp.send("Page.getResourceTree", {})
  const items = flattenResources(tree.result.frameTree)
  const scripts = items.filter((r) => /script/i.test(r.type) || /javascript/i.test(r.mimeType))

  console.log(`page ${page.id}  ${page.title}`)
  console.log(`${items.length} resources, ${scripts.length} scripts\n`)

  if (mode === "list") {
    for (const r of items) {
      console.log(`  ${"  ".repeat(r.depth)}${String(r.type).padEnd(10)} ${String(r.mimeType || "").padEnd(22)} ${r.url}`)
    }

  } else if (mode === "grep") {
    const text = rest.join(" ")
    if (!text) throw new Error("give something to search for")
    // The engine's search index can miss matches, so this scans each script itself
    // (FS Copilot fork, record/pointer-forwarding/docs/09-environment.md).
    const needle = text.toLowerCase()
    let found = 0
    for (const r of scripts) {
      const body = await resourceContent(insp, r)
      const lower = body.toLowerCase()
      let at = -1, n = 0
      while ((at = lower.indexOf(needle, at + 1)) !== -1 && n < 5) {
        if (!n) console.log(`\n  ${r.url}`)
        console.log(`      … ${body.slice(Math.max(0, at - 90), at + needle.length + 90).replace(/\s+/g, " ")} …`)
        n++; found++
      }
    }
    if (!found) console.log("  no loaded script contains it")

  } else if (mode === "get") {
    const frag = (rest[0] || "").toLowerCase()
    const hit = items.find((r) => r.url.toLowerCase().includes(frag))
    if (!hit) throw new Error(`no loaded resource whose url contains ${JSON.stringify(frag)}`)
    console.log(`// ${hit.url}\n`)
    console.log(await resourceContent(insp, hit))

  } else if (mode === "dump") {
    const dir = simSourcesDir(slug(page.title))
    let saved = 0, bytes = 0, empty = 0
    for (const r of scripts) {
      const body = await resourceContent(insp, r)
      if (!body) { empty++; continue }
      // The whole path goes into the filename, so two scripts never collide.
      const name = r.url.replace(/^[a-z]+:\/\//i, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120)
      writeFileSync(join(dir, name), body)
      saved++; bytes += body.length
    }
    console.log(`saved ${saved} scripts (${(bytes / 1024).toFixed(0)} KB) to ${dir}`)
    if (empty) console.log(`${empty} returned no content`)

  } else {
    throw new Error(`unknown mode ${JSON.stringify(mode)}`)
  }
} finally {
  insp.close()
}
