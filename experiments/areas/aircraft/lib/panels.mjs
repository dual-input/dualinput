/*
 * The panels, through the sim's inspector on 127.0.0.1:19999, which runs
 * JavaScript in any panel document (experiments/tools/inspector.mjs).
 *
 *   await panels.list()                         every inspectable document
 *   await panels.evaluate("VCockpit01", "1+1")  one expression in one panel
 *   await panels.inventory()                    each VCockpit document's gauges
 *
 * Code sent here runs in Coherent GT, whose engine is Chrome 49, so it's
 * written in ES5 (CLAUDE.md, "Before writing code that runs in a panel"). The
 * inventory only reads.
 */

import { Inspector, listPages, selectPage } from "../../../tools/inspector.mjs"

export { listPages }

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms))])

export async function list() {
  return listPages()
}

// sel is a page id or a title substring that matches one page.
export async function evaluate(sel, expression, { timeoutMs = 8000 } = {}) {
  const page = typeof sel === "object" ? sel : selectPage(await listPages(), sel)
  const insp = new Inspector(page.id)
  try {
    await withTimeout(insp.open(), timeoutMs, `inspector page ${page.id}`)
    return await withTimeout(insp.evaluate(expression), timeoutMs, `evaluate in ${page.title}`)
  } finally {
    insp.close()
  }
}

// Lists each child of the document's vcockpit-panel element: its tag, its
// attributes, and the instrument identifier BaseInstrument gives it, where the
// element has one.
const GAUGES = `(function () {
  var out = []
  var panel = document.querySelector("vcockpit-panel")
  var kids = panel ? panel.children : []
  for (var i = 0; i < kids.length; i++) {
    var el = kids[i]
    var attrs = {}
    for (var j = 0; j < el.attributes.length && j < 16; j++) attrs[el.attributes[j].name] = String(el.attributes[j].value).slice(0, 300)
    var ident = null
    try { ident = el.instrumentIdentifier || null } catch (e) {}
    out.push({ tag: el.tagName.toLowerCase(), id: el.id || null, ident: ident, attrs: attrs })
  }
  return JSON.stringify({ hasPanel: !!panel, url: String(location.href).slice(0, 400), gauges: out })
})()`

export async function inventory({ timeoutMs = 5000 } = {}) {
  const pages = await listPages()
  const out = []
  for (const p of pages) {
    const isPanel = /^VCockpit/i.test(String(p.title ?? ""))
    const entry = { id: p.id, title: p.title ?? "", url: p.url ?? "", panel: isPanel, gauges: null, error: null }
    if (isPanel) {
      try {
        const r = JSON.parse(await evaluate(p, GAUGES, { timeoutMs }))
        entry.gauges = r.gauges
        entry.hasPanel = r.hasPanel
      } catch (e) {
        entry.error = e.message.split("\n")[0]
      }
    }
    out.push(entry)
  }
  return out
}
