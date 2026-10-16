/*
 * p01: whether GitHub Pages answers a repeat fetch of an unchanged file with
 * "not modified", and whether it compresses what it sends.
 *
 * The core fetches the profiles' index.json each time it starts
 * (record/areas/profiles/01-format-and-delivery.md, Delivery), which leaves
 * unverified whether Pages answers a fetch carrying the last ETag with a 304,
 * sending almost nothing. Needs no sim, and fetches two public Pages sites:
 * GitHub's own, and an organization's.
 *
 *   node experiments/areas/profiles/p01-pages-conditional.mjs
 *
 * For each site it fetches the page asking for gzip, then fetches it again
 * with If-None-Match set to the ETag it got, then with If-Modified-Since set
 * to the Last-Modified it got, then once without asking for gzip, and prints
 * each status, the headers that matter, and the bytes on the wire.
 *
 * Output: the report on the console and in
 * experiments/areas/profiles/results/p01-pages-conditional-<time>.txt.
 */

import https from "node:https"

import { repoRelative, saveResult } from "../../tools/results.mjs"

const SITES = ["https://pages.github.com/", "https://jekyll.github.io/minima/"]

const out = []
const note = (s = "") => {
  console.log(s)
  out.push(s)
}

// node:https rather than fetch, because fetch decompresses the body and hides
// how many bytes crossed the wire.
function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let bytes = 0
      res.on("data", (chunk) => (bytes += chunk.length))
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, bytes }))
    })
    req.on("error", reject)
  })
}

const show = (label, r) =>
  note(
    `  ${label.padEnd(24)} ${r.status}  bytes=${r.bytes}` +
      `  etag=${r.headers.etag ?? "-"}  cache-control=${r.headers["cache-control"] ?? "-"}` +
      `  content-encoding=${r.headers["content-encoding"] ?? "-"}  server=${r.headers.server ?? "-"}`,
  )

note(`p01-pages-conditional, ${new Date().toISOString()}, Node ${process.version}`)
for (const url of SITES) {
  note()
  note(url)
  const first = await get(url, { "accept-encoding": "gzip" })
  show("gzip", first)
  note(`  ${"".padEnd(24)} last-modified=${first.headers["last-modified"] ?? "-"}`)
  if (first.headers.etag) {
    show("If-None-Match", await get(url, { "accept-encoding": "gzip", "if-none-match": first.headers.etag }))
  }
  if (first.headers["last-modified"]) {
    show("If-Modified-Since", await get(url, { "accept-encoding": "gzip", "if-modified-since": first.headers["last-modified"] }))
  }
  show("no gzip asked", await get(url, {}))
}

note()
note(`saved ${repoRelative(saveResult("profiles", "p01-pages-conditional", out.join("\n")))}`)
