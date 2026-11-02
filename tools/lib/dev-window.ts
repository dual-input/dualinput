// Drives the development host's window from outside it: a picture of what the GPU drew, and a click
// or a wheel posted to the window, which take neither the real cursor nor the focus. The picture
// comes back all white about half the time just after posted input, for any page, so a white one is
// taken again (experiments/areas/interface/p24-efb-scale).

import { execFileSync } from "node:child_process"

const PREAMBLE = `
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Runtime.InteropServices;
public static class DevWindow {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool repaint);
  public struct RECT { public int L, T, R, B; }
  public struct POINT { public int X, Y; }
  public static IntPtr At(int x, int y) { return (IntPtr)((y << 16) | (x & 0xFFFF)); }
  public static bool Shoot(IntPtr h, string file) {
    SetProcessDPIAware(); RECT r; GetWindowRect(h, out r);
    using (var bmp = new Bitmap(r.R - r.L, r.B - r.T)) {
      using (var g = Graphics.FromImage(bmp)) { var dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc); }
      var middle = bmp.GetPixel(bmp.Width / 2, bmp.Height / 2);
      var corner = bmp.GetPixel(20, bmp.Height - 20);
      if (middle.R > 240 && middle.G > 240 && middle.B > 240 && corner.R > 240 && corner.G > 240 && corner.B > 240) return false;
      bmp.Save(file, System.Drawing.Imaging.ImageFormat.Png);
      return true;
    }
  }
}
"@
`

function run(pid: number, body: string): string {
  const script = `${PREAMBLE}\n$p = Get-Process -Id ${pid}\n$p.Refresh()\n$h = $p.MainWindowHandle\n${body}`
  // Windows PowerShell writes its progress to stderr as XML when it isn't on a console.
  return execFileSync("powershell", ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

/** Saves a picture of the window as a PNG, taking it again while it comes back white. */
export function shoot(pid: number, file: string): boolean {
  return run(pid, `$ok = $false; for ($i = 0; $i -lt 12 -and -not $ok; $i++) { $ok = [DevWindow]::Shoot($h, '${file.replaceAll("'", "''")}'); if (-not $ok) { Start-Sleep -Milliseconds 250 } }; $ok`) === "True"
}

/** A click at a point of the window's client area. */
export function click(pid: number, x: number, y: number): void {
  run(pid, `$a = [DevWindow]::At(${x}, ${y}); [void][DevWindow]::PostMessage($h, 0x200, [IntPtr]0, $a); Start-Sleep -Milliseconds 40; [void][DevWindow]::PostMessage($h, 0x201, [IntPtr]1, $a); Start-Sleep -Milliseconds 40; [void][DevWindow]::PostMessage($h, 0x202, [IntPtr]0, $a)`)
}

/** A press at one point of the window's client area, moved in `steps` to another, and let go there, each step `every` milliseconds apart. */
export function drag(pid: number, x: number, y: number, toX: number, toY: number, steps: number, every: number): void {
  const moves = Array.from({ length: steps }, (_, step) => {
    const k = (step + 1) / steps
    return `[void][DevWindow]::PostMessage($h, 0x200, [IntPtr]1, [DevWindow]::At(${Math.round(x + (toX - x) * k)}, ${Math.round(y + (toY - y) * k)})); Start-Sleep -Milliseconds ${every}`
  })
  run(pid, `[void][DevWindow]::PostMessage($h, 0x200, [IntPtr]0, [DevWindow]::At(${x}, ${y})); Start-Sleep -Milliseconds 40; [void][DevWindow]::PostMessage($h, 0x201, [IntPtr]1, [DevWindow]::At(${x}, ${y})); Start-Sleep -Milliseconds 40; ${moves.join("; ")}; [void][DevWindow]::PostMessage($h, 0x202, [IntPtr]0, [DevWindow]::At(${toX}, ${toY}))`)
}

/** Moves the mouse over a point of the window's client area, so what sits there shows its hover. */
export function hover(pid: number, x: number, y: number): void {
  run(pid, `[void][DevWindow]::PostMessage($h, 0x200, [IntPtr]0, [DevWindow]::At(${x}, ${y}))`)
}

/** Types plain characters into whatever field has the focus. */
export function type(pid: number, text: string): void {
  const chars = [...text].map((c) => `[void][DevWindow]::PostMessage($h, 0x102, [IntPtr]${c.charCodeAt(0)}, [IntPtr]0); Start-Sleep -Milliseconds 30`)
  run(pid, chars.join("; "))
}

/** Wheel notches at a point of the window's client area, down when `notches` is positive. WM_MOUSEWHEEL's position is the screen's. */
export function wheel(pid: number, x: number, y: number, notches: number): void {
  run(pid, `$pt = New-Object DevWindow+POINT; $pt.X = ${x}; $pt.Y = ${y}; [void][DevWindow]::ClientToScreen($h, [ref]$pt); [void][DevWindow]::PostMessage($h, 0x20A, [IntPtr]([int](${-120 * notches} -shl 16)), [DevWindow]::At($pt.X, $pt.Y))`)
}

/** Sizes the window, keeping it where it is. */
export function resize(pid: number, width: number, height: number): void {
  run(pid, `$r = New-Object DevWindow+RECT; [void][DevWindow]::GetWindowRect($h, [ref]$r); [void][DevWindow]::MoveWindow($h, $r.L, $r.T, ${width}, ${height}, $true)`)
}
