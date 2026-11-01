// The development loop for our pages: builds a page with esbuild and Tailwind, runs it in Coherent GT
// with no sim, in a copy of the SDK's CoherentGT Debugger whose start page is replaced with a frame of
// the page, and reloads it after each edit. It matches the sim's EFB on 1,159 of 1,170 CSS items
// (record/areas/interface/log.md, 2026-11-01). Leave it running in a terminal.
//
//   node tools/dev.ts [page]       the kit's page by default, or a page's own file
//
// While it runs, http://127.0.0.1:5190 serves the page to a browser too, though only the debugger's
// window draws what the sim's engine draws. These drive that window, from another shell:
//
//   POST /eval   { "code": "document.title" }      runs JavaScript in the page, and answers its result
//   POST /shot   { "file": "out.png" }             saves a picture of the window
//   POST /click  { "x": 100, "y": 100 }            clicks a point of the window's client area
//   POST /drag   { "x": 100, "y": 100, "toX": 100, "toY": 300, "steps": 8, "every": 16 }   presses, moves, and lets go
//   POST /hover  { "x": 100, "y": 100 }            moves the mouse there
//   POST /wheel  { "x": 100, "y": 100, "notches": 3 }   turns the wheel there
//   POST /type   { "text": "abc" }                 types into the field with the focus

import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"

import { checkFile, format } from "coherent-checks"
import * as esbuild from "esbuild"

import { buildCss, forceStates, KIT } from "./lib/css.ts"
import { click, drag, hover, resize, shoot, type, wheel } from "./lib/dev-window.ts"
import { fromRoot, ROOT } from "./lib/repo.ts"
import { sdkFolder } from "./lib/sdk.ts"

const PORT = 5190
const OUT = path.join(ROOT, "target", "dev")

/** Each page this can run: its entry, and the source files its classes come from, on top of the kit's. */
const PAGES: Record<string, { entry: string; content: string[] }> = {
  kit: { entry: "src/packages/ui/dev/main.tsx", content: ["src/packages/ui/dev/**/*.tsx"] },
  efb: { entry: "src/platform/efb-shell/dev/main.tsx", content: ["src/platform/efb-shell/src/**/*.{ts,tsx}", "src/platform/efb-shell/dev/**/*.{ts,tsx}", "src/packages/crew/src/**/*.{ts,tsx}"] },
  banner: { entry: "src/platform/banner/dev/main.tsx", content: ["src/platform/banner/src/**/*.{ts,tsx}", "src/platform/banner/dev/**/*.{ts,tsx}", "src/packages/crew/src/**/*.{ts,tsx}"] },
}

// ---------------------------------------------------------------- what the page hears from here

/** Runs in the page, so it keeps to ES2017: it passes the page's errors here, and waits on what to do next. */
const DEV_CLIENT = `(function () {
  function post(path, body) { var x = new XMLHttpRequest(); x.open("POST", path); x.setRequestHeader("content-type", "text/plain"); x.send(JSON.stringify(body)); }
  window.addEventListener("error", function (e) { post("/log", { level: "error", text: e.message + " at " + e.filename + ":" + e.lineno }); });
  var error = console.error;
  console.error = function () { post("/log", { level: "error", text: Array.prototype.join.call(arguments, " ") }); error.apply(console, arguments); };
  function next() {
    var x = new XMLHttpRequest();
    x.open("GET", "/next");
    x.onload = function () {
      var order = JSON.parse(x.responseText);
      if (order.reload) { location.reload(); return; }
      if (order.code) {
        var out;
        try { out = { result: (0, eval)(order.code) }; } catch (e) { out = { error: String(e) }; }
        try { post("/answer", { id: order.id, out: out }); } catch (e) { post("/answer", { id: order.id, out: { error: "the result isn't JSON: " + e } }); }
      }
      next();
    };
    x.onerror = function () { setTimeout(next, 1000); };
    x.send();
  }
  next();
})();`

let waiting: http.ServerResponse | null = null
let orders: object[] = []
const answers = new Map<number, (out: unknown) => void>()
let nextOrder = 1

function flush(): void {
  if (!waiting || orders.length === 0) return
  const res = waiting
  waiting = null
  res.writeHead(200, { "content-type": "application/json" })
  res.end(JSON.stringify(orders.shift()))
}

function order(body: object): void {
  orders.push(body)
  flush()
}

function evalInPage(code: string): Promise<unknown> {
  return new Promise((resolve) => {
    const id = nextOrder++
    answers.set(id, resolve)
    order({ id, code })
    setTimeout(() => {
      if (answers.delete(id)) resolve({ error: "the page didn't answer within 10s" })
    }, 10_000)
  })
}

// ---------------------------------------------------------------- the build

const asked = process.argv[2] ?? "kit"
// A path runs that file as the page, with its folder's classes, as a probe under experiments/ does.
const page = PAGES[asked] ?? (fs.existsSync(asked) ? { entry: asked, content: [`${path.dirname(asked).split(path.sep).join("/")}/**/*.{ts,tsx}`] } : undefined)
if (!page) throw new Error(`no page or file called ${asked}: ${Object.keys(PAGES).join(", ")}`)
const name = PAGES[asked] ? asked : path.basename(path.dirname(asked))
const dir = path.join(OUT, name)
fs.mkdirSync(dir, { recursive: true })
fs.cpSync(path.join(KIT, "fonts"), path.join(dir, "fonts"), { recursive: true })
fs.writeFileSync(
  path.join(dir, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body style="margin:0;background:#0a0a0a"><div id="page"></div><script>${DEV_CLIENT}</script><script src="/app.js"></script></body></html>`,
)

async function afterBuild(): Promise<void> {
  const started = Date.now()
  const css = path.join(dir, "app.css")
  fs.writeFileSync(css, await buildCss(page!.content, name === "kit" ? [forceStates()] : []))
  const findings = [path.join(dir, "app.js"), css].flatMap((file) => checkFile(file).map((f) => format(fromRoot(file), f)))
  for (const finding of findings) console.log(finding)
  console.log(`built in ${Date.now() - started}ms, ${findings.length ? `${findings.length} Coherent GT findings` : "no Coherent GT findings"}`)
  order({ reload: true })
}

const context = await esbuild.context({
  entryPoints: [path.join(ROOT, page.entry)],
  outfile: path.join(dir, "app.js"),
  bundle: true,
  format: "iife",
  target: "es2017",
  jsx: "automatic",
  sourcemap: "external",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  plugins: [
    {
      name: "dualinput-after-build",
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length === 0) await afterBuild()
        })
      },
    },
  ],
})
await context.watch()

// ---------------------------------------------------------------- the server

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf" }

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ""
    req.on("data", (d) => (body += d))
    req.on("end", () => resolve(body))
  })
}

function answer(res: http.ServerResponse, out: unknown): void {
  res.writeHead(200, { "content-type": "application/json" })
  res.end(JSON.stringify(out))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x")
  if (req.method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}")
    switch (url.pathname) {
      case "/log":
        console.log(`page ${body.level}: ${body.text}`)
        return answer(res, {})
      case "/answer":
        answers.get(body.id)?.(body.out)
        answers.delete(body.id)
        return answer(res, {})
      case "/eval":
        return answer(res, await evalInPage(body.code))
      case "/shot":
        return answer(res, { saved: shoot(host.pid!, path.resolve(body.file)) })
      case "/click":
        click(host.pid!, body.x, body.y)
        return answer(res, {})
      case "/drag":
        drag(host.pid!, body.x, body.y, body.toX, body.toY, body.steps ?? 8, body.every ?? 16)
        return answer(res, {})
      case "/hover":
        hover(host.pid!, body.x, body.y)
        return answer(res, {})
      case "/wheel":
        wheel(host.pid!, body.x, body.y, body.notches ?? 1)
        return answer(res, {})
      case "/type":
        type(host.pid!, body.text)
        return answer(res, {})
      default:
        res.writeHead(404)
        return res.end()
    }
  }
  if (url.pathname === "/next") {
    waiting = res
    return flush()
  }
  const file = path.join(dir, url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, ""))
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404)
    return res.end()
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" })
  res.end(fs.readFileSync(file))
})
await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve))

// ---------------------------------------------------------------- the debugger's copy

// A copy, since its start page is what's replaced, and under target/, since its files are Microsoft's
// and Coherent Labs'.
const hostDir = path.join(OUT, "host")
if (!fs.existsSync(hostDir)) fs.cpSync(path.join(sdkFolder(), "Tools", "CoherentGT Debugger"), hostDir, { recursive: true })
fs.writeFileSync(path.join(hostDir, "html", "debugger.html"), `<html><body style="margin:0;background:#000"><iframe src="http://127.0.0.1:${PORT}/" style="position:absolute;left:0;top:0;width:100%;height:100%;border:0"></iframe></body></html>`)
const host = spawn(path.join(hostDir, "Debugger.exe"), [], { cwd: hostDir, stdio: "ignore" })
host.on("exit", () => {
  console.log("the debugger's window closed")
  process.exit(0)
})
process.on("exit", () => host.kill())
setTimeout(() => resize(host.pid!, 1400, 1000), 1500)
console.log(`${name}: http://127.0.0.1:${PORT}, and in the debugger's window`)
