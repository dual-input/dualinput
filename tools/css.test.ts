import assert from "node:assert/strict"
import { test } from "node:test"

import { checkCss } from "coherent-checks"
import postcss from "postcss"

import { buildCss, remToPx, scopeDefaults, unwrapIs } from "./lib/css.ts"

const run = async (css: string, ...plugins: Parameters<typeof postcss>) => (await postcss(plugins).process(css, { from: undefined })).css

test("a rem becomes px, since the document's font size in the EFB is the EFB's", async () => {
  assert.equal(await run(".a { margin: 0.25rem -1.5rem; font-size: 0.875rem }", remToPx()), ".a { margin: 4px -24px; font-size: 14px }")
  assert.equal(await run(".a { width: 10px; content: 'rem' }", remToPx()), ".a { width: 10px; content: 'rem' }")
})

test("Tailwind's defaults on every element reach only our root and what's inside it", async () => {
  assert.equal(await run("*, ::before, ::after { --tw-x: 0 }", scopeDefaults("root")), ".root, .root *, .root ::before, .root ::after { --tw-x: 0 }")
  assert.equal(await run(".a * { color: red }", scopeDefaults("root")), ".a * { color: red }")
})

test("a selector Tailwind wraps in :is() comes out plain, since Coherent GT drops :is and its whole rule", async () => {
  assert.equal(await run(".root :is(.a > .b ~ .c) { margin: 0 }", unwrapIs()), ".root .a > .b ~ .c { margin: 0 }")
  assert.equal(await run(".root .a { margin: 0 }", unwrapIs()), ".root .a { margin: 0 }")
})

test("the kit's stylesheet passes the Coherent GT check, every rule of it under our root", async () => {
  const css = await buildCss([])
  assert.deepEqual(checkCss(css), [])
  const parsed = postcss.parse(css)
  parsed.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && (rule.parent as postcss.AtRule).name === "keyframes") return
    for (const selector of rule.selectors) assert.match(selector, /^\.dualinput-ui/, `${selector} would reach outside our root`)
  })
})
