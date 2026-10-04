/*
 * Mouse clicks sent to the sim's window the way a real mouse sends them, for
 * driving the sim's own tools, such as the Project Editor's Build and Mount,
 * with nobody at the machine.
 *
 * It clicks only while the sim's window is in front, checked before every
 * click, at a point in the window's client area in pixels. A point read off a
 * screenshot from shot.mjs, which cuts the top 100 pixels off and scales the
 * rest to 1,200 wide, comes back to the window's pixels through fromShot. It
 * moves the cursor there with SetCursorPos and sends the press and release
 * through SendInput, after SetProcessDPIAware, as shot.mjs reads the window.
 *
 *   const clicker = startClicker()
 *   await clicker.focus()                         // "OK in front" or "NO not in front"
 *   await clicker.clickVisible(1980, 440)         // a left click that brings the sim forward, only where it shows
 *   await clicker.click(1830, 252, "right")       // "OK clicked" or "SKIPPED …"
 *   const [x, y] = fromShot(915, 76, 2401)        // a screenshot's point, in window pixels
 *   clicker.close()
 */

import { createInterface } from "node:readline"
import { powershell } from "./guide.mjs"

// shot.mjs: the top 100 pixels cut off, the rest scaled to 1,200 wide.
const SHOT_CROP_TOP = 100
const SHOT_WIDTH = 1200
export const fromShot = (x, y, windowWidth) => {
  const k = windowWidth / SHOT_WIDTH
  return [Math.round(x * k), Math.round(y * k + SHOT_CROP_TOP)]
}

const CLICK_PS = `
$ProgressPreference = "SilentlyContinue"
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Threading;
public static class CrosscheckClicker {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public MOUSEINPUT mi; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  static void Button(uint flag) {
    INPUT[] i = new INPUT[1]; i[0].type = 0; i[0].mi.dwFlags = flag;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  // A click where the sim's window shows on screen, whether or not it's in
  // front: Windows won't let a background program bring a window forward,
  // but a click on it does. Refused unless the window under the point is the
  // sim's, so it can't land in another program.
  public static string ClickVisible(IntPtr sim, int x, int y) {
    POINT p = new POINT(); p.X = x; p.Y = y; ClientToScreen(sim, ref p);
    if (GetAncestor(WindowFromPoint(p), 2) != sim) return "SKIPPED another window covers that point";
    SetCursorPos(p.X, p.Y); Thread.Sleep(120);
    Button(0x0002u); Thread.Sleep(60); Button(0x0004u);
    return "OK clicked at screen " + p.X + "," + p.Y;
  }
  public static string Click(IntPtr sim, int x, int y, bool right) {
    if (GetForegroundWindow() != sim) return "SKIPPED the sim isn't in front";
    POINT p = new POINT(); p.X = x; p.Y = y; ClientToScreen(sim, ref p);
    SetCursorPos(p.X, p.Y); Thread.Sleep(120);
    Button(right ? 0x0008u : 0x0002u); Thread.Sleep(60); Button(right ? 0x0010u : 0x0004u);
    return "OK clicked at screen " + p.X + "," + p.Y;
  }
}
"@
[void][CrosscheckClicker]::SetProcessDPIAware()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = Get-Process -Name FlightSimulator2024 -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if (-not $p) { [Console]::Out.WriteLine("ERR no sim window"); continue }
  $f = $line.Split(" ")
  try {
    if ($f[0] -eq "focus") { [void][CrosscheckClicker]::SetForegroundWindow($p.MainWindowHandle); Start-Sleep -Milliseconds 300; [Console]::Out.WriteLine($(if ([CrosscheckClicker]::GetForegroundWindow() -eq $p.MainWindowHandle) { "OK in front" } else { "NO not in front" })) }
    elseif ($f[0] -eq "click") { [Console]::Out.WriteLine([CrosscheckClicker]::Click($p.MainWindowHandle, [int]$f[1], [int]$f[2], $f[3] -eq "right")) }
    elseif ($f[0] -eq "clickvisible") { [Console]::Out.WriteLine([CrosscheckClicker]::ClickVisible($p.MainWindowHandle, [int]$f[1], [int]$f[2])) }
    else { [Console]::Out.WriteLine("ERR unknown command") }
  } catch { [Console]::Out.WriteLine("ERR " + $_.Exception.Message) }
}`

export function startClicker() {
  const ps = powershell(CLICK_PS, ["pipe", "pipe", "ignore"])
  const replies = []
  createInterface({ input: ps.stdout }).on("line", (l) => replies.shift()?.(l))
  const ask = (cmd, timeoutMs = 5000) => Promise.race([
    new Promise((resolve) => { replies.push(resolve); ps.stdin.write(cmd + "\n") }),
    new Promise((resolve) => setTimeout(() => resolve(`ERR no reply in ${timeoutMs / 1000}s`), timeoutMs)),
  ])
  return {
    focus: () => ask("focus"),
    click: (x, y, button = "left") => ask(`click ${Math.round(x)} ${Math.round(y)} ${button}`),
    clickVisible: (x, y) => ask(`clickvisible ${Math.round(x)} ${Math.round(y)}`),
    close() { try { ps.stdin.end(); ps.kill() } catch { /* gone */ } },
  }
}
