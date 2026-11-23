// Tests the Dual Input panel's page and the Content Security Policy it runs under
// (record/areas/profiles/04-the-extension-in-the-sim.md, "The Dual Input panel").
//
//   node --test src/apps/profile-extension/src/page.test.ts

import assert from "node:assert/strict"
import { test } from "node:test"

import { contentSecurityPolicy, panelPage } from "./page.ts"

/** A webview's `cspSource` and its files' addresses, in the shape VS Code gives them. */
const SOURCE = "https://*.vscode-cdn.net"
const FILES = {
  source: SOURCE,
  nonce: "q1w2e3r4t5y6u7i8o9p0aa==",
  script: "https://file+.vscode-resource.vscode-cdn.net/c%3A/extension/panel/panel.js",
  style: "https://file+.vscode-resource.vscode-cdn.net/c%3A/extension/panel/panel.css",
}

test("the policy shuts out everything but the extension's stylesheet and fonts, and the script with the page's nonce", () => {
  assert.equal(contentSecurityPolicy(SOURCE, "abc"), "default-src 'none'; style-src https://*.vscode-cdn.net; font-src https://*.vscode-cdn.net; script-src 'nonce-abc'")
  assert.doesNotMatch(contentSecurityPolicy(SOURCE, "abc"), /unsafe/)
})

test("the page carries the policy and loads the stylesheet and the script, with nothing inline", () => {
  const page = panelPage(FILES)
  assert.ok(page.includes(`<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(SOURCE, FILES.nonce)}">`))
  assert.ok(page.includes(`<link rel="stylesheet" href="${FILES.style}">`))
  assert.ok(page.includes(`<script nonce="${FILES.nonce}" src="${FILES.script}"></script>`))
  assert.ok(page.includes(`<div id="panel"></div>`))
  assert.doesNotMatch(page, /<style|style=|<script(?![^>]*\bsrc=)/)
})

test("the page escapes what it writes into an attribute", () => {
  const page = panelPage({ ...FILES, script: `https://example.com/a"b&c<d.js` })
  assert.ok(page.includes(`src="https://example.com/a&quot;b&amp;c&lt;d.js"`))
})
