// The development loop for our pages: builds a page with esbuild and Tailwind, runs it in Coherent GT
// with no sim, in a copy of the SDK's CoherentGT Debugger whose start page is replaced with a frame of
// the page, and reloads it after each edit. It matches the sim's EFB on 1,159 of 1,170 CSS items
// (measured on MSFS 2024, 2026-11-01, record/areas/interface/log.md, "The SDK's CoherentGT Debugger
// runs our pages in Coherent GT with no sim, and matches the sim's EFB on 1,159 of p14's 1,170 CSS
// items and on repeated work in a loaded page"). Leave it running in a terminal.
//
//   node tools/dev.ts [page]       the kit's page by default, or a page's own file
//
// While it runs, http://127.0.0.1:5190 serves the page to a browser too, though only the debugger's
// window draws what the sim's engine draws. A page that runs in a browser engine rather than the
// sim's, as the desktop app's and the profile panel's do, gets no debugger, and the browser alone
// draws it. These drive the debugger's window, from another shell:
//
//   POST /eval   { "code": "document.title" }      runs JavaScript in the page, and answers its result
//   POST /shot   { "file": "out.png" }             saves a picture of the window
//   POST /click  { "x": 100, "y": 100 }            clicks a point of the window's client area
//   POST /drag   { "x": 100, "y": 100, "toX": 100, "toY": 300, "steps": 8, "every": 16 }   presses, moves, and lets go
//   POST /hover  { "x": 100, "y": 100 }            moves the mouse there
//   POST /wheel  { "x": 100, "y": 100, "notches": 3 }   turns the wheel there
//   POST /type   { "text": "abc" }                 types into the field with the focus

import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"

import { checkFile, format } from "coherent-checks"
import * as esbuild from "esbuild"

import { DEV_PAGES as PAGES, scriptOptions, writeCss, writeShell } from "./lib/dev-pages.ts"
import { click, drag, hover, resize, shoot, type, wheel } from "./lib/dev-window.ts"
import { fromRoot, ROOT } from "./lib/repo.ts"
import { sdkFolder } from "./lib/sdk.ts"
import { EFB_RULES } from "./lib/sim-css.ts"

const PORT = 5190
const OUT = path.join(ROOT, "target", "dev")

// ---------------------------------------------------------------- what the page hears from here

/** Runs in the page, so it keeps to ES2017: it passes the page's errors here, and waits on what to do next. */
const DEV_CLIENT = `(function () {
  function post(path, body) { var x = new XMLHttpRequest(); x.open("POST", path); x.setRequestHeader("content-type", "text/plain"); x.send(JSON.stringify(body)); }
  window.addEventListener("error", function (e) { post("/log", { level: "error", text: e.message + " at " + e.filename + ":" + e.lineno }); });
  var error = console.error;
  console.error = function () { post("/log", { level: "error", text: Array.prototype.join.call(arguments, " ") }); error.apply(console, arguments); };
  var framed = window.parent !== window;
  function next() {
    var x = new XMLHttpRequest();
    x.open("GET", framed ? "/next?framed" : "/next");
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

/**
 * Each page waiting on `/next`, and whether it's the debugger's, which the debugger's start page frames. Another page
 * can wait here too, such as a browser tab left on this port by an earlier run, and when it takes an edit's reload, the
 * debugger's page stays on the old build. So a reload goes to every waiting page, and code to run goes only to the
 * debugger's, whose answer is the one asked for.
 */
let waiting: { res: http.ServerResponse; framed: boolean }[] = []
let orders: object[] = []
const answers = new Map<number, (out: unknown) => void>()
let nextOrder = 1

function flush(): void {
  while (orders.length > 0) {
    const body = orders[0]!
    const to = "reload" in body ? waiting : waiting.filter((one) => one.framed).slice(0, 1)
    if (to.length === 0) return
    orders.shift()
    waiting = waiting.filter((one) => !to.includes(one))
    for (const { res } of to) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(body))
    }
  }
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
const page = PAGES[asked] ?? (fs.existsSync(asked) ? { entry: asked, content: [`${path.dirname(asked).split(path.sep).join("/")}/**/*.{ts,tsx}`], simRules: EFB_RULES } : undefined)
if (!page) throw new Error(`no page or file called ${asked}: ${Object.keys(PAGES).join(", ")}`)
const name = PAGES[asked] ? asked : path.basename(path.dirname(asked))
const dir = path.join(OUT, name)
writeShell(page, dir, { scripts: `<script>${DEV_CLIENT}</script>` })

async function afterBuild(): Promise<void> {
  const started = Date.now()
  const css = path.join(dir, "app.css")
  await writeCss(name, page!, dir)
  // A page that runs in a browser engine never meets Coherent GT, so its findings would only be noise.
  if (page!.simRules === null) {
    console.log(`built in ${Date.now() - started}ms`)
    return order({ reload: true })
  }
  const findings = [path.join(dir, "app.js"), css].flatMap((file) => checkFile(file).map((f) => format(fromRoot(file), f)))
  for (const finding of findings) console.log(finding)
  console.log(`built in ${Date.now() - started}ms, ${findings.length ? `${findings.length} Coherent GT findings` : "no Coherent GT findings"}`)
  order({ reload: true })
}

const context = await esbuild.context({
  ...scriptOptions(page, path.join(dir, "app.js")),
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

/** The calls that drive the debugger's window, which a page that runs in a browser engine has none of. */
const WINDOW = new Set(["/shot", "/click", "/drag", "/hover", "/wheel", "/type"])

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x")
  if (req.method === "POST") {
    // These run script on this PC, and any web page can POST to a local port, so only the page we serve and a program, which sends no Origin, get through.
    if (req.headers.origin !== undefined && req.headers.origin !== `http://127.0.0.1:${PORT}`) {
      res.writeHead(403)
      return res.end()
    }
    const body = JSON.parse((await readBody(req)) || "{}")
    if (!host && WINDOW.has(url.pathname)) return answer(res, { error: `${name} runs in a browser, so no debugger's window draws it` })
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
        return answer(res, { saved: shoot(host!.pid!, path.resolve(body.file)) })
      case "/click":
        click(host!.pid!, body.x, body.y)
        return answer(res, {})
      case "/drag":
        drag(host!.pid!, body.x, body.y, body.toX, body.toY, body.steps ?? 8, body.every ?? 16)
        return answer(res, {})
      case "/hover":
        hover(host!.pid!, body.x, body.y)
        return answer(res, {})
      case "/wheel":
        wheel(host!.pid!, body.x, body.y, body.notches ?? 1)
        return answer(res, {})
      case "/type":
        type(host!.pid!, body.text)
        return answer(res, {})
      default:
        res.writeHead(404)
        return res.end()
    }
  }
  if (url.pathname === "/next") {
    const one = { res, framed: url.searchParams.has("framed") }
    // The debugger frames one page, so an earlier framed request is that page's before it reloaded, which Coherent GT
    // leaves open, and code sent there would wait out its 10s with nobody to run it.
    if (one.framed) {
      for (const old of waiting.filter((other) => other.framed)) old.res.end()
      waiting = waiting.filter((other) => !other.framed)
    }
    waiting.push(one)
    // A page that reloads or closes drops its request, and a reload sent to it would reach nobody.
    res.on("close", () => (waiting = waiting.filter((other) => other !== one)))
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

/** The debugger running the page, or null for a page that runs in a browser engine, which a browser alone draws. */
const host = page.simRules === null ? null : openDebugger()
console.log(host ? `${name}: http://127.0.0.1:${PORT}, and in the debugger's window` : `${name}: http://127.0.0.1:${PORT}`)

function openDebugger(): ChildProcess {
  // A copy, since its start page is what's replaced, and under target/, since its files are Microsoft's
  // and Coherent Labs'.
  const hostDir = path.join(OUT, "host")
  if (!fs.existsSync(hostDir)) fs.cpSync(path.join(sdkFolder(), "Tools", "CoherentGT Debugger"), hostDir, { recursive: true })
  fs.writeFileSync(path.join(hostDir, "html", "debugger.html"), `<html><body style="margin:0;background:#000"><iframe src="http://127.0.0.1:${PORT}/" style="position:absolute;left:0;top:0;width:100%;height:100%;border:0"></iframe></body></html>`)
  const opened = spawn(path.join(hostDir, "Debugger.exe"), [], { cwd: hostDir, stdio: "ignore" })
  opened.on("exit", () => {
    console.log("the debugger's window closed")
    process.exit(0)
  })
  process.on("exit", () => opened.kill())
  // Wide enough for the EFB app at its largest beside its navigator's four columns.
  setTimeout(() => resize(opened.pid!, 1540, 1000), 1500)
  return opened
}
