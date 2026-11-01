/*
 * p24's second part: what the zoom property does to the things the frames lean on, in the SDK's
 * CoherentGT Debugger, since the first part found it draws text as sharply as calc() sizes. A page
 * with zoom on its root reads back offsets, rects, a translate, a scroller, sticky, and hit tests, and
 * takes a real click and wheel posted to the debugger's window. It also opens a WebSocket from the
 * page to this script, as a page would to a bench core.
 *
 *   node experiments/areas/interface/p24-efb-scale/zoom.mjs <zoom>
 */

import { execFileSync, spawn } from "node:child_process"
import { cpSync, existsSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { WebSocketServer } from "ws"

import { repoRelative, resultFile, saveResult, stamp } from "../../../tools/results.mjs"

const NAME = "p24-efb-scale-zoom"
const HERE = dirname(fileURLToPath(import.meta.url))
const HOST = join(HERE, "out", "host")
const SDK = join(process.env.APPDATA ?? "", "cargo-msfs", "data", "msfs2024")
const ZOOM = Number(process.argv[2] ?? 1)
const WITHOUT = (process.argv[3] ?? "").split(",").filter(Boolean)
// The control: "calc" draws the same page with every size but a 1px line as calc(Npx * var(--z)).
const SIZING = process.argv[4] ?? "zoom"
const asCalc = (html) =>
  html
    .replace(/zoom: [\d.]+;/, "")
    .replace("html, body {", `html { --z: ${ZOOM}; } html, body {`)
    .replace(/(?<![\w.#])(\d+)px/g, (written, n) => (n === "1" ? written : `calc(${n}px * var(--z))`))

const encoded = (script) => Buffer.from(script, "utf16le").toString("base64")
const powershell = (script) => execFileSync("powershell", ["-NoProfile", "-EncodedCommand", encoded(script)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Runs in the engine, so it keeps to ES2017. Frame units are the numbers written here.
const page = (zoom, wsPort) => `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; background: #0a0a0a; color: #fafafa; font: 13px sans-serif; }
#root { position: absolute; left: 0; top: 0; width: 700px; height: 480px; zoom: ${zoom}; }
#box { position: absolute; left: 100px; top: 100px; width: 50px; height: 40px; background: #74d4ff; }
#moved { position: absolute; left: 100px; top: 150px; width: 50px; height: 40px; background: #6fd58d; transform: translateX(50px); -webkit-transform: translateX(50px); }
#fixed { position: fixed; left: 100px; top: 200px; width: 50px; height: 40px; background: #f1be4d; }
#scroller { position: absolute; left: 300px; top: 100px; width: 120px; height: 100px; overflow: hidden; background: #171717; }
#tall { height: 300px; }
#stick { position: -webkit-sticky; top: 10px; height: 20px; background: #ea7977; }
#mask { position: absolute; left: 450px; top: 100px; width: 120px; height: 100px; background: #bdd7f5; -webkit-mask-image: -webkit-linear-gradient(top, rgba(0,0,0,1) 50%, rgba(0,0,0,0)); }
#shadow { position: absolute; left: 450px; top: 220px; width: 120px; height: 60px; border-radius: 10px; border: 1px solid #2a2a2a; box-shadow: 0 4px 12px rgba(116,212,255,0.5); }
#svg { position: absolute; left: 300px; top: 220px; width: 48px; height: 48px; }
#input { position: absolute; left: 100px; top: 260px; width: 150px; height: 28px; }
</style></head><body><style>${WITHOUT.map((id) => `#${id}{display:none}`).join("")}</style><div id="root">
<div id="box"></div><div id="moved"></div><div id="fixed"></div>
<div id="scroller"><div id="tall"><div style="height:40px">top</div><div id="stick"></div></div></div>
<div id="mask"></div><div id="shadow"></div>
<svg id="svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="none" stroke="#6fd58d" stroke-width="3" stroke-dasharray="60 200" stroke-dashoffset="20"/></svg>
<input id="input" value="input">
</div><script>
var results = { zoom: ${zoom}, events: [], ws: "not tried" };
function rect(el) { var r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(function (n) { return Math.round(n * 10) / 10; }); }
function hit(x, y) { var e = document.elementFromPoint(x, y); return e ? (e.id || e.nodeName) : null; }
function send(url, body) { var x = new XMLHttpRequest(); x.open("POST", url); x.setRequestHeader("content-type", "text/plain"); x.send(JSON.stringify(body)); }
function read() {
  var box = document.getElementById("box");
  var moved = document.getElementById("moved");
  var scroller = document.getElementById("scroller");
  var stick = document.getElementById("stick");
  var z = ${zoom};
  results.box = { offset: [box.offsetLeft, box.offsetTop, box.offsetWidth, box.offsetHeight], rect: rect(box) };
  results.moved = { offset: [moved.offsetLeft, moved.offsetTop], rect: rect(moved) };
  results.fixed = { rect: rect(document.getElementById("fixed")) };
  results.font = getComputedStyle(document.getElementById("input")).fontSize;
  results.computedLeft = getComputedStyle(box).left;
  results.window = [innerWidth, innerHeight];
  results.hits = {
    "box at its frame units": hit(125, 120),
    "box at frame units times zoom": hit(125 * z, 120 * z),
    "moved at 175 by 170 times zoom, where a zoomed translate lands": hit(175 * z, 170 * z),
    "moved at 125 + 50 by 170, where an unzoomed translate lands": hit(125 * z + 50, 170 * z),
    "fixed at frame units times zoom": hit(125 * z, 220 * z),
    "fixed at its frame units": hit(125, 220),
  };
  results.scroller = { client: scroller.clientHeight, scrollHeight: scroller.scrollHeight, offset: scroller.offsetHeight };
  scroller.scrollTop = 60;
  results.scroller.afterSet60 = scroller.scrollTop;
  results.stickyAfterScroll = rect(stick);
  results.scrollerRect = rect(scroller);
  results.childAfterScroll = rect(scroller.firstElementChild);
}
document.addEventListener("mousedown", function (e) { results.events.push({ type: "mousedown", id: e.target.id, clientX: e.clientX, clientY: e.clientY, pageX: e.pageX, offsetX: e.offsetX, screenX: e.screenX }); });
document.addEventListener("click", function (e) { results.events.push({ type: "click", id: e.target.id, clientX: e.clientX, clientY: e.clientY }); });
document.addEventListener("wheel", function (e) { results.events.push({ type: "wheel", id: e.target.id, deltaY: e.deltaY, deltaMode: e.deltaMode, clientX: e.clientX }); });
try {
  var ws = new WebSocket("ws://127.0.0.1:${wsPort}/");
  results.ws = "connecting";
  ws.onopen = function () { results.ws = "open"; ws.send("hello from the page"); };
  ws.onmessage = function (e) { results.ws = "echoed: " + e.data; };
  ws.onerror = function () { results.ws = "error"; };
} catch (e) { results.ws = "threw " + e; }
setTimeout(function () { read(); send("/ready", { zoom: ${zoom} }); }, 800);
window.report = function () { send("/report", results); };
var poll = setInterval(function () { var x = new XMLHttpRequest(); x.open("GET", "/should-report"); x.onload = function () { if (x.responseText === "yes") { clearInterval(poll); window.report(); } }; x.send(); }, 200);
</script></body></html>`

let wsSeen = 0
const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 })
wss.on("connection", (socket) => {
  wsSeen++
  socket.on("message", (m) => socket.send(`echo of ${m}`))
})
await new Promise((resolve) => wss.on("listening", resolve))
const wsPort = wss.address().port

let onReady = () => {}
let onReport = () => {}
const ready = new Promise((resolve) => (onReady = resolve))
const reported = new Promise((resolve) => (onReport = resolve))
let shouldReport = false
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x")
  if (req.method === "POST") {
    let body = ""
    req.on("data", (d) => (body += d))
    req.on("end", () => {
      res.writeHead(204)
      res.end()
      ;(url.pathname === "/ready" ? onReady : onReport)(JSON.parse(body))
    })
    return
  }
  if (url.pathname === "/should-report") {
    res.writeHead(200, { "content-type": "text/plain" })
    return res.end(shouldReport ? "yes" : "no")
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(SIZING === "calc" ? asCalc(page(ZOOM, wsPort)) : page(ZOOM, wsPort))
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const { port } = server.address()

if (!existsSync(HOST)) cpSync(join(SDK, "Tools", "CoherentGT Debugger"), HOST, { recursive: true })
writeFileSync(join(HOST, "html", "debugger.html"), `<html><body style="margin:0;background:#000"><iframe src="http://127.0.0.1:${port}/" style="position:absolute;left:0;top:0;width:100%;height:100%;border:0"></iframe></body></html>`)
const host = spawn(join(HOST, "Debugger.exe"), [], { cwd: HOST, stdio: "ignore" })
process.on("exit", () => host.kill())

// PostMessage reaches the window with no real cursor and no focus taken. Coordinates are the client area's.
function win32(body) {
  return powershell(`
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  public struct RECT { public int L, T, R, B; }
  public struct POINT { public int X, Y; }
  public static IntPtr LP(int x, int y) { return (IntPtr)((y << 16) | (x & 0xFFFF)); }
  public static string Shot(IntPtr h, string file) {
    SetProcessDPIAware(); RECT r; GetWindowRect(h, out r);
    var bmp = new Bitmap(r.R - r.L, r.B - r.T);
    using (var g = Graphics.FromImage(bmp)) { var dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc); }
    bmp.Save(file, System.Drawing.Imaging.ImageFormat.Png); return bmp.Width + "x" + bmp.Height;
  }
}
"@
$p = Get-Process -Id ${host.pid}
$p.Refresh()
$h = $p.MainWindowHandle
${body}`)
}
const click = (x, y) => `[void][W]::PostMessage($h, 0x200, [IntPtr]0, [W]::LP(${x}, ${y})); Start-Sleep -Milliseconds 60; [void][W]::PostMessage($h, 0x201, [IntPtr]1, [W]::LP(${x}, ${y})); Start-Sleep -Milliseconds 60; [void][W]::PostMessage($h, 0x202, [IntPtr]0, [W]::LP(${x}, ${y})); Start-Sleep -Milliseconds 60;`
// WM_MOUSEWHEEL's position is the screen's, and its delta sits in the high word of wParam: -120 is one notch down.
const wheel = (x, y) => `$pt = New-Object W+POINT; $pt.X = ${x}; $pt.Y = ${y}; [void][W]::ClientToScreen($h, [ref]$pt); [void][W]::PostMessage($h, 0x20A, [IntPtr]([int](-120 -shl 16)), [W]::LP($pt.X, $pt.Y)); Start-Sleep -Milliseconds 120;`

const when = stamp()
const lines = [`${NAME}, ${new Date().toISOString()}`, ""]
await Promise.race([ready, sleep(20000)])
await sleep(300)
win32(`${click(Math.round(125 * ZOOM), Math.round(120 * ZOOM))} ${wheel(Math.round(360 * ZOOM), Math.round(150 * ZOOM))}`)
await sleep(300)
const name = `${NAME}-${String(ZOOM).replace(".", "_")}${WITHOUT.length ? `-without-${WITHOUT.join("-")}` : ""}${SIZING === "calc" ? "-calc" : ""}`
const png = resultFile("interface", name, "png", when)
const size = win32(`[W]::Shot($h, '${png}')`)
shouldReport = true
const r = await Promise.race([reported, sleep(5000).then(() => null)])
lines.push(`zoom ${ZOOM}: screenshot ${repoRelative(png)}, ${size}`, r ? JSON.stringify(r, null, 1) : "no report", "", `WebSocket connections the server took: ${wsSeen}`)
const text = lines.join("\n")
console.log(text)
console.log(`saved ${repoRelative(saveResult("interface", name, text))}`)
process.exit(0)
