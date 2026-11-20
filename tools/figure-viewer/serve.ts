// The figure viewer: a page that draws avatars' figure from its source in the Baron 58P's
// cockpit, posed by `Figure`'s own code over scripted looks, reaches, grips, walks, runs,
// crouches, and a slump, so the figure's look and its levels of detail are tuned by eye before
// it's compiled (record/areas/architecture/02-code-map.md, "Apps, the sim package, and tools").
//
//   node tools/figure-viewer/serve.ts
//
// It finds the 58P where the sim installed it, builds and runs this folder's program, which
// writes what the page draws into target/figure-viewer/, then serves the page on
// http://127.0.0.1:5182 and opens it. The page builds the figure in the browser from
// model.ts and figure.json at each level of detail, as `node tools/figure.ts generate` does.
// `Figure` compiles figure.json's sizes in, so applying the page's sliders writes figure.json
// and builds and runs the program again.

import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import { stripTypeScriptTypes } from "node:module"
import path from "node:path"

import { buildPrograms } from "../lib/cargo.ts"
import { BUDGET, FIGURE } from "../lib/figure.ts"
import { packagesFolders, userCfgs } from "../lib/install.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main, run } from "../lib/run.ts"
import { setNumbers } from "./spec.ts"

const PORT = 5182
const ADDRESS = `http://127.0.0.1:${PORT}/`
const OUT = path.join(ROOT, "target", "figure-viewer")
const SPEC = path.join(FIGURE, "figure.json")
/** The 58P's package folder in Community, as aircraft-model's tests/installed.rs names it. */
const PACKAGE = "bksq-aircraft-baronpro"
/** What the page reads from the tree, by its path from the root, and nothing else. */
const SERVED = [/^tools\/figure-viewer\/page\/[\w-]+\.(html|js|ts|css)$/, /^src\/features\/avatars\/figure\/model\.ts$/]

function baron(): string {
  const folders = packagesFolders(userCfgs())
  const found = folders.map((f) => path.join(f, "Community", PACKAGE)).find((p) => fs.existsSync(p))
  if (!found) {
    throw new Failed(`no Community\\${PACKAGE} in ${folders.join(" or ") || "any packages folder a UserCfg.opt names"}; install the Black Square Baron Professional`)
  }
  return found
}

/** Builds the program with figure.json as it stands, and runs it on the 58P. */
function record(pkg: string): void {
  const built = buildPrograms(["--profile", "release-with-checks", "-p", "figure-viewer"], ["figure-viewer"])
  run(built["figure-viewer"], [pkg, OUT])
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".bin": "application/octet-stream",
}

function send(res: http.ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" }).end(body)
}

/** A file from the tree, its types stripped when it's TypeScript, which the browser runs as JavaScript. */
function source(res: http.ServerResponse, rel: string): void {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8")
  const body = rel.endsWith(".ts") ? stripTypeScriptTypes(text, { mode: "strip" }) : text
  send(res, 200, TYPES[path.extname(rel)] ?? "text/plain", body)
}

type Apply = { changes?: Record<string, number>; seat?: unknown }

function serve(pkg: string): void {
  let busy = false
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url ?? "/", ADDRESS).pathname)
    try {
      if (req.method === "POST" && url === "/apply") {
        let body = ""
        req.on("data", (c: Buffer) => (body += c.toString("utf8")))
        req.on("end", () => {
          if (busy) return send(res, 409, "application/json", JSON.stringify({ error: "a run is already going" }))
          busy = true
          try {
            const { changes = {}, seat } = JSON.parse(body) as Apply
            if (Object.keys(changes).length) {
              fs.writeFileSync(SPEC, setNumbers(fs.readFileSync(SPEC, "utf8"), changes))
              console.log(`figure.json: ${Object.entries(changes).map(([k, v]) => `${k} ${v}`).join(", ")}`)
            }
            const seatFile = path.join(OUT, "seat.json")
            if (seat === null) fs.rmSync(seatFile, { force: true })
            else if (seat !== undefined) fs.writeFileSync(seatFile, JSON.stringify(seat))
            record(pkg)
            send(res, 200, "application/json", JSON.stringify({ ok: true }))
          } catch (e) {
            console.error(e)
            send(res, 500, "application/json", JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          } finally {
            busy = false
          }
        })
        return
      }
      if (url === "/") return source(res, "tools/figure-viewer/page/index.html")
      const rel = url.slice(1)
      if (SERVED.some((r) => r.test(rel))) return source(res, rel)
      if (url === "/figure.json") return send(res, 200, TYPES[".json"]!, fs.readFileSync(SPEC))
      if (url === "/budget.json") return send(res, 200, TYPES[".json"]!, JSON.stringify(BUDGET))
      // A name such as grip.parts.bin, which can't climb out of OUT, since it has no slash.
      const data = /^\/data\/(\w[\w.-]*\.(json|bin))$/.exec(url)
      if (data && fs.existsSync(path.join(OUT, data[1]!))) {
        res.writeHead(200, { "content-type": TYPES[path.extname(data[1]!)]!, "cache-control": "no-store" })
        fs.createReadStream(path.join(OUT, data[1]!)).pipe(res)
        return
      }
      send(res, 404, "text/plain", "not found")
    } catch (e) {
      console.error(e)
      send(res, 500, "text/plain", String(e))
    }
  })
  server.on("error", (e: NodeJS.ErrnoException) => {
    console.error(e.code === "EADDRINUSE" ? `port ${PORT} is taken, perhaps by a viewer already running at ${ADDRESS}` : e.message)
    process.exit(1)
  })
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`figure viewer: ${ADDRESS}`)
    const opener = process.platform === "win32" ? ["cmd", "/c", "start", ""] : [process.platform === "darwin" ? "open" : "xdg-open"]
    spawn(opener[0]!, [...opener.slice(1), ADDRESS], { detached: true, stdio: "ignore" }).unref()
  })
}

main(() => {
  const pkg = baron()
  record(pkg)
  serve(pkg)
})
