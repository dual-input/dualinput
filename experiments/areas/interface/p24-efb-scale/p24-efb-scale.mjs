/*
 * p24: how the EFB app should fit its view. The frames are drawn at 516 wide, and the EFB's view runs
 * from 456px to 632px wide with the tablet's size setting and more with the sim's window (p21), so one
 * number has to scale the whole app. This draws one card in the SDK's CoherentGT Debugger at four
 * scales, three ways: a transform on its root, the zoom property, and every size written as
 * calc(Npx * var(--s)), which is how efb_os.css sizes itself. The report reads back what the engine
 * laid out, and the screenshot shows whether text stays sharp.
 *
 *   node experiments/areas/interface/p24-efb-scale/p24-efb-scale.mjs
 */

import { execFileSync, spawn } from "node:child_process"
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { REPO, repoRelative, resultFile, saveResult, stamp } from "../../../tools/results.mjs"

const NAME = "p24-efb-scale"
const HERE = dirname(fileURLToPath(import.meta.url))
const HOST = join(HERE, "out", "host")
const SDK = join(process.env.APPDATA ?? "", "cargo-msfs", "data", "msfs2024")
const FONTS = join(REPO, "experiments", "areas", "interface", "p19-efb-input", "node_modules", "geist", "dist", "fonts")
const SCALES = [0.72, 0.884, 1.056, 1.225]
const WAYS = ["transform", "zoom", "calc"]

const encoded = (script) => Buffer.from(script, "utf16le").toString("base64")
const powershell = (script) => execFileSync("powershell", ["-NoProfile", "-EncodedCommand", encoded(script)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Runs in the engine, so it keeps to ES2017.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Geist"; font-weight: 400; src: url("/fonts/geist-sans/Geist-Regular.ttf") format("truetype"); }
@font-face { font-family: "Geist"; font-weight: 500; src: url("/fonts/geist-sans/Geist-Medium.ttf") format("truetype"); }
@font-face { font-family: "Geist Mono"; font-weight: 500; src: url("/fonts/geist-mono/GeistMono-Medium.ttf") format("truetype"); }
html, body { margin: 0; background: #0a0a0a; color: #fafafa; font-family: "Geist"; }
.way { position: absolute; left: 8px; color: #74d4ff; font: 500 12px "Geist"; }
.slot { position: absolute; overflow: visible; }
.card * { box-sizing: border-box; }
</style></head><body><div id="root"></div><script>
var SCALES = ${JSON.stringify(SCALES)};
var WAYS = ${JSON.stringify(WAYS)};
var CARD_W = 236;
function card(u) {
  return '<div class="card" data-card style="width:' + u(CARD_W) + ';background:#171717;border:1px solid #2a2a2a;border-radius:' + u(10) + ';padding:' + u(12) + '">' +
    '<div style="font-size:' + u(14) + ';font-weight:500;line-height:' + u(20) + '">James is sharing traffic</div>' +
    '<div style="font-size:' + u(13) + ';line-height:' + u(18) + ';color:#a1a1a1;margin-top:' + u(2) + '">Avoid unnecessary cockpit interactions until the flight starts, as some may not sync.</div>' +
    '<div style="font-size:' + u(12) + ';line-height:' + u(16) + ';color:#a1a1a1;margin-top:' + u(6) + '">Relay \\u00b7 120ms</div>' +
    '<div style="display:flex;align-items:center;margin-top:' + u(10) + '">' +
      '<div style="height:' + u(32) + ';padding:0 ' + u(12) + ';border-radius:' + u(10) + ';background:#74d4ff;color:#0a0a0a;font-size:' + u(13) + ';font-weight:500;line-height:' + u(32) + '">Ready</div>' +
      '<div style="margin-left:' + u(8) + ';font-family:\\'Geist Mono\\';font-weight:500;font-size:' + u(12) + '">XK4-92QF</div>' +
      '<svg viewBox="0 0 16 16" style="margin-left:' + u(8) + ';width:' + u(16) + ';height:' + u(16) + '"><circle cx="8" cy="8" r="7" fill="none" stroke="#6fd58d" stroke-width="1.5"/></svg>' +
    '</div></div>';
}
var html = "";
var report = [];
var y = 6;
WAYS.forEach(function (way) {
  html += '<div class="way" style="top:' + y + 'px">' + way + '</div>';
  y += 18;
  var x = 8;
  SCALES.forEach(function (s) {
    var u = way === "calc" ? function (n) { return "calc(" + n + "px * var(--s))"; } : function (n) { return n + "px"; };
    var outer = "left:" + x + "px;top:" + y + "px;";
    if (way === "transform") outer += "transform-origin:0 0;-webkit-transform-origin:0 0;transform:scale(" + s + ");-webkit-transform:scale(" + s + ");";
    if (way === "zoom") outer += "zoom:" + s + ";";
    if (way === "calc") outer += "--s:" + s + ";";
    html += '<div class="slot" data-way="' + way + '" data-s="' + s + '" style="' + outer + '">' + card(u) + '</div>';
    x += Math.ceil(CARD_W * s) + 10;
  });
  y += 212;
});
document.getElementById("root").innerHTML = html;
function done() {
  var cards = document.querySelectorAll("[data-way]");
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var inner = c.querySelector("[data-card]");
    var r = inner.getBoundingClientRect();
    report.push({ way: c.getAttribute("data-way"), s: Number(c.getAttribute("data-s")), rectW: r.width, rectH: r.height, offsetW: inner.offsetWidth, offsetH: inner.offsetHeight, zoom: getComputedStyle(c).zoom, innerW: innerWidth, innerH: innerHeight });
  }
  var x = new XMLHttpRequest();
  x.open("POST", "/report");
  x.setRequestHeader("content-type", "text/plain");
  x.send(JSON.stringify(report));
}
setTimeout(done, 1200);
</script></body></html>`

let reported
const got = new Promise((resolve) => (reported = resolve))
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x")
  if (req.method === "POST") {
    let body = ""
    req.on("data", (d) => (body += d))
    req.on("end", () => {
      res.writeHead(204)
      res.end()
      reported(JSON.parse(body))
    })
    return
  }
  if (url.pathname.startsWith("/fonts/")) {
    const file = join(FONTS, url.pathname.slice("/fonts/".length))
    if (!existsSync(file)) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { "content-type": "font/ttf" })
    return res.end(readFileSync(file))
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(PAGE)
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const { port } = server.address()

if (!existsSync(HOST)) cpSync(join(SDK, "Tools", "CoherentGT Debugger"), HOST, { recursive: true })
writeFileSync(join(HOST, "html", "debugger.html"), `<html><body style="margin:0;background:#000"><iframe src="http://127.0.0.1:${port}/" style="position:absolute;left:0;top:0;width:100%;height:100%;border:0"></iframe></body></html>`)
const host = spawn(join(HOST, "Debugger.exe"), [], { cwd: HOST, stdio: "ignore" })
process.on("exit", () => host.kill())

const result = await Promise.race([got, sleep(30000).then(() => null)])
await sleep(500)

const when = stamp()
const png = resultFile("interface", NAME, "png", when)
// PrintWindow's flag 2 asks for what the GPU drew, so the window can be covered.
const size = powershell(`
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Runtime.InteropServices;
public static class Cap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
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
[Cap]::Shot($p.MainWindowHandle, '${png}')`)

const lines = [`${NAME}, ${new Date().toISOString()}`, `Screenshot: ${repoRelative(png)}, ${size}`, ""]
if (!result) lines.push("no report within 30s")
for (const r of result ?? []) lines.push(`${r.way.padEnd(9)} scale ${String(r.s).padEnd(5)} rect ${r.rectW.toFixed(1)} x ${r.rectH.toFixed(1)}, offset ${r.offsetW} x ${r.offsetH}, zoom ${r.zoom}, window ${r.innerW} x ${r.innerH}`)
const text = lines.join("\n")
console.log(text)
console.log(`saved ${repoRelative(saveResult("interface", NAME, text))}`)
process.exit(0)
