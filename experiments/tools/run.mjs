/*
 * Lists panels, runs a panel probe in one, or evaluates one expression there.
 *
 *   node experiments/tools/run.mjs pages [title filter]
 *   node experiments/tools/run.mjs probe <page> experiments/<area>/pNN-name.js [--settle ms]
 *   node experiments/tools/run.mjs eval <page> "<expression>"
 *
 * <page> is an id or a case-insensitive title substring.
 * A probe's report is echoed and saved to record/<area>/results/.
 */

import { readFileSync } from "node:fs"
import { basename, resolve } from "node:path"

import { listPages, selectPage, Inspector, runProbe, drain, CAPTURE_SHIM } from "./inspector.mjs"
import { saveResult, areaOf, slug } from "./results.mjs"

const argv = process.argv.slice(2)
const mode = argv[0]
const rest = argv.slice(1)

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = rest[i + 1]
  rest.splice(i, 2)
  return v
}

async function main() {
  if (mode === "pages") {
    const pages = await listPages()
    const filter = rest[0] ? String(rest[0]).toLowerCase() : null
    const shown = filter ? pages.filter((p) => String(p.title || "").toLowerCase().includes(filter)) : pages
    console.log(`${shown.length} of ${pages.length} inspectable documents\n`)
    for (const p of shown) {
      console.log(`  ${String(p.id).padStart(3)}  ${String(p.title || "(untitled)").padEnd(38)} ${p.url || ""}`)
    }
    return
  }

  const settle = Number(flag("settle", 2500))
  const target = rest[0]
  if (!target) throw new Error("give a page id or title substring")

  const page = selectPage(await listPages(), target)
  const insp = new Inspector(page.id)
  await insp.open()

  try {
    if (mode === "eval") {
      const expr = rest.slice(1).join(" ")
      if (!expr) throw new Error("give an expression to evaluate")
      // A probe's report() prints rather than returns, so capture the console too.
      await insp.evaluate(CAPTURE_SHIM)
      const value = await insp.evaluate(expr)
      const logged = await drain(insp)
      if (logged) console.log(logged)
      if (value !== undefined) console.log(typeof value === "string" ? value : JSON.stringify(value, null, 1))
      return
    }

    if (mode === "probe") {
      if (!rest[1]) throw new Error("give the probe's path, such as experiments/commbus/p02-listener-wrap.js")
      const path = resolve(rest[1])
      const source = readFileSync(path, "utf8")
      const header =
        `page  ${page.id}  ${page.title}\n` +
        `url   ${page.url}\n` +
        `probe ${basename(path)}, settle ${settle}ms\n` +
        `${new Date().toISOString()}\n` +
        "=".repeat(72) + "\n"
      const out = await runProbe(insp, source, { settle })
      const text = header + (out || "(the probe printed nothing)")
      console.log(text)
      console.log(`\nsaved ${saveResult(areaOf(path), `${basename(path, ".js")}-${slug(page.title)}`, text)}`)
      return
    }

    throw new Error(`unknown mode ${JSON.stringify(mode)}: use pages, probe, or eval`)
  } finally {
    insp.close()
  }
}

main().catch((e) => {
  console.error("\n" + e.message + "\n")
  process.exit(1)
})
