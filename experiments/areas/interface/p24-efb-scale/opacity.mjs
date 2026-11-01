/*
 * p24's third part: whether text inside a faded layer loses its edge at a fraction of a pixel, and
 * whether that belongs to the zoom property or to the engine. Rows of faded text at 12 positions a
 * tenth of a pixel apart, side by side under zoom, under calc() sizes at the same scale, and at 1:1 for
 * comparison, in the SDK's CoherentGT Debugger, at each scale given.
 *
 *   node experiments/areas/interface/p24-efb-scale/opacity.mjs 0.72 0.75 0.8 0.884 1.056 1.225
 */

import { execFileSync, spawn } from "node:child_process"
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { REPO, repoRelative, resultFile, stamp } from "../../../tools/results.mjs"

const NAME = "p24-efb-scale-opacity"
const HERE = dirname(fileURLToPath(import.meta.url))
const HOST = join(HERE, "out", "host")
const SDK = join(process.env.APPDATA ?? "", "cargo-msfs", "data", "msfs2024")
const FONT = join(REPO, "src", "packages", "ui", "fonts", "Geist-Medium.ttf")
const SCALES = process.argv.slice(2).map(Number)

const encoded = (script) => Buffer.from(script, "utf16le").toString("base64")
const powershell = (script) => execFileSync("powershell", ["-NoProfile", "-EncodedCommand", encoded(script)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const row = (u, i, shift) =>
  `<div style="position:absolute;left:${u(6)};top:calc(${u(6 + i * 36)} + ${shift}px);width:${u(170)};height:${u(36)};display:flex;align-items:center;padding-left:${u(12)};opacity:0.5;font-size:${u(14)};line-height:${u(20)}"><span>Disabled ${i}</span></div>`
const column = (u, left, scale, wrap) => `<div style="position:absolute;left:${left}px;top:8px;${wrap}">${Array.from({ length: 12 }, (_, i) => row(u, i, (i * 0.1).toFixed(1))).join("")}</div>`

const page = (scale) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Geist"; font-weight: 500; src: url("/font.ttf") format("truetype"); }
html, body { margin: 0; background: #171717; color: #fafafa; font: 500 14px "Geist"; }
</style></head><body>
${column((n) => `${n}px`, 8, scale, `zoom:${scale};width:190px;height:450px`)}
${column((n) => `calc(${n}px * ${scale})`, 240, scale, "width:190px;height:450px")}
${column((n) => `${n}px`, 470, 1, "width:190px;height:450px")}
<script>setTimeout(function () { var x = new XMLHttpRequest(); x.open("POST", "/ready"); x.send("1"); }, 900);</script>
</body></html>`

let scale = 1
let onReady = () => {}
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x")
  if (req.method === "POST") {
    req.resume()
    req.on("end", () => {
      res.writeHead(204)
      res.end()
      onReady()
    })
    return
  }
  if (url.pathname === "/font.ttf") {
    res.writeHead(200, { "content-type": "font/ttf" })
    return res.end(readFileSync(FONT))
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(page(scale))
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const { port } = server.address()
if (!existsSync(HOST)) cpSync(join(SDK, "Tools", "CoherentGT Debugger"), HOST, { recursive: true })
writeFileSync(join(HOST, "html", "debugger.html"), `<html><body style="margin:0;background:#000"><iframe src="http://127.0.0.1:${port}/" style="position:absolute;left:0;top:0;width:100%;height:100%;border:0"></iframe></body></html>`)

const when = stamp()
for (const s of SCALES) {
  scale = s
  const ready = new Promise((resolve) => (onReady = resolve))
  const host = spawn(join(HOST, "Debugger.exe"), [], { cwd: HOST, stdio: "ignore" })
  await Promise.race([ready, sleep(20000)])
  await sleep(300)
  const png = resultFile("interface", `${NAME}-${String(s).replace(".", "_")}`, "png", when)
  const saved = powershell(`
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Runtime.InteropServices;
public static class Cap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
  public static bool Shot(IntPtr h, string file) {
    SetProcessDPIAware(); RECT r; GetWindowRect(h, out r);
    using (var bmp = new Bitmap(r.R - r.L, r.B - r.T)) {
      using (var g = Graphics.FromImage(bmp)) { var dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc); }
      var c = bmp.GetPixel(bmp.Width - 40, bmp.Height - 40);
      if (c.R > 240) return false;
      bmp.Save(file, System.Drawing.Imaging.ImageFormat.Png); return true;
    }
  }
}
"@
$p = Get-Process -Id ${host.pid}
$p.Refresh()
$ok = $false; for ($i = 0; $i -lt 12 -and -not $ok; $i++) { $ok = [Cap]::Shot($p.MainWindowHandle, '${png}'); if (-not $ok) { Start-Sleep -Milliseconds 250 } }; $ok`)
  console.log(`scale ${s}: ${saved === "True" ? repoRelative(png) : "no picture"}`)
  host.kill()
  await sleep(500)
}
process.exit(0)
