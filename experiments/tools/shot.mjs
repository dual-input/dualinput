/*
 * Screenshots of the sim window's client area, for a probe to read afterward
 * instead of asking the pilot to watch.
 *
 * It copies the window's pixels from the screen with .NET's
 * Graphics.CopyFromScreen after SetProcessDPIAware, as p24 does (measured on
 * MSFS 2024, 2026-10-03, record/areas/avatars/log.md, "A probe can screenshot
 * the sim window"), so the sim must be in a window or borderless, in front and
 * uncovered. Each shot is saved as a JPEG 1,200 pixels wide with the top 100
 * pixels cut off, because Devmode's Project Editor shows the home folder's path
 * in its title bar there (CLAUDE.md, Nothing personal in the tree). Look at a
 * shot before committing it.
 *
 *   const shooter = startShooter(dir)
 *   const s = await shooter.shot("name")   // { file, width, height, brightness } or { error }
 *   shooter.close()
 */

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { powershell } from "./guide.mjs"

const CROP_TOP = 100
const WIDTH = 1200
const SHOT_PS = `
$ProgressPreference = "SilentlyContinue"
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Drawing.Drawing2D; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class CrosscheckShooter {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static string Take(IntPtr h, string file) {
    RECT r; GetClientRect(h, out r); POINT o = new POINT(); ClientToScreen(h, ref o);
    int w = r.R - r.L, hh = r.B - r.T;
    if (w <= 0 || hh <= 0) return "ERR no client area";
    using (Bitmap bmp = new Bitmap(w, hh, PixelFormat.Format24bppRgb)) {
      using (Graphics g = Graphics.FromImage(bmp)) g.CopyFromScreen(o.X, o.Y, 0, 0, new Size(w, hh));
      int top = Math.Min(${CROP_TOP}, hh - 1), ph = hh - top, pw = ${WIDTH}, phs = (int)Math.Round(ph * (double)pw / w);
      double sum = 0; long n = 0;
      using (Bitmap pv = new Bitmap(pw, phs)) {
        using (Graphics g = Graphics.FromImage(pv)) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(bmp, new Rectangle(0, 0, pw, phs), new Rectangle(0, top, w, ph), GraphicsUnit.Pixel); }
        for (int y = 0; y < phs; y += 4) for (int x = 0; x < pw; x += 4) { Color c = pv.GetPixel(x, y); sum += (c.R + c.G + c.B) / 3.0; n++; }
        ImageCodecInfo jpeg = null;
        foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.FormatID == ImageFormat.Jpeg.Guid) jpeg = c;
        EncoderParameters q = new EncoderParameters(1);
        q.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 82L);
        pv.Save(file, jpeg, q);
      }
      return String.Format(System.Globalization.CultureInfo.InvariantCulture, "OK {0} {1} {2:F1}", w, hh, sum / n);
    }
  }
}
"@
[void][CrosscheckShooter]::SetProcessDPIAware()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = Get-Process -Name FlightSimulator2024 -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if (-not $p) { [Console]::Out.WriteLine("ERR no sim window"); continue }
  try { [Console]::Out.WriteLine([CrosscheckShooter]::Take($p.MainWindowHandle, $line)) } catch { [Console]::Out.WriteLine("ERR " + $_.Exception.Message) }
}`

export function startShooter(dir) {
  mkdirSync(dir, { recursive: true })
  const ps = powershell(SHOT_PS, ["pipe", "pipe", "ignore"])
  const replies = []
  createInterface({ input: ps.stdout }).on("line", (l) => replies.shift()?.(l))
  let n = 0
  return {
    async shot(name) {
      const file = join(dir, `${String(++n).padStart(2, "0")}-${name}.jpg`)
      const line = await Promise.race([
        new Promise((resolve) => { replies.push(resolve); ps.stdin.write(`${file}\n`) }),
        new Promise((resolve) => setTimeout(() => resolve("ERR no reply in 8s"), 8000)),
      ])
      const [ok, w, h, bright] = line.split(" ")
      return ok === "OK" ? { file, width: +w, height: +h, brightness: +bright } : { file, error: line }
    },
    close() { try { ps.stdin.end(); ps.kill() } catch { /* gone */ } },
  }
}
