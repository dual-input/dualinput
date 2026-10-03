/*
 * The pilot's mouse presses, drags, and wheel turns in the sim window, for a
 * probe:
 *
 *   const stop = await startMouse((m) => …)
 *     m: { kind, delta, x, y, width, height, foreground, dx, dy, t }
 *
 * kind is "left", "leftup", "right", "rightup", "middle", or "wheel"; "move",
 * at most every 16ms while the left button is held; or "size", when the sim
 * window's client area changes size, checked whenever the mouse does anything.
 * x and y are where the cursor was in the sim window's client area, from -1 to
 * 1, right and up; width and height are that area in pixels; foreground is
 * whether the sim had the focus. For "wheel", delta is in Windows' units, 120
 * a notch, positive away from the pilot; for "leftup" and "rightup", it's how
 * far the mouse travelled while that button was down, in the mouse's own
 * counts, which keep coming when an application holds the cursor still, as the
 * sim may while the right button turns the view. dx and dy are the mouse's own
 * movement since the last "move", in the same counts.
 *
 * It reads Raw Input with RIDEV_INPUTSINK, a copy Windows sends to any window
 * that registers for it, so it sits in nobody's input path: unlike a
 * WH_MOUSE_LL hook, nothing waits for it, and the sim gets every press and
 * wheel turn as before.
 */

import { createInterface } from "node:readline"

import { powershell } from "./guide.mjs"

const MOUSE_PS = `
$ProgressPreference = "SilentlyContinue"
Add-Type -ReferencedAssemblies System.Windows.Forms @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class CrosscheckMouse : NativeWindow {
  [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICE { public ushort UsagePage; public ushort Usage; public uint Flags; public IntPtr Target; }
  [StructLayout(LayoutKind.Sequential)] struct RAWINPUTHEADER { public uint Type; public uint Size; public IntPtr Device; public IntPtr WParam; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] d, uint n, uint size);
  [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr h, uint cmd, IntPtr data, ref uint size, uint header);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

  IntPtr sim = IntPtr.Zero;
  uint simPid = 0;
  bool leftDown = false, rightDown = false;
  double leftTravel = 0, rightTravel = 0;
  int dx = 0, dy = 0, lastW = -1, lastH = -1;
  Stopwatch sinceMove = Stopwatch.StartNew();

  public CrosscheckMouse() {
    CreateHandle(new CreateParams());
    // Usage page 1, usage 2: the mouse. 0x100 is RIDEV_INPUTSINK.
    var d = new RAWINPUTDEVICE[] { new RAWINPUTDEVICE { UsagePage = 1, Usage = 2, Flags = 0x100, Target = Handle } };
    if (!RegisterRawInputDevices(d, 1, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)))) Console.Out.WriteLine("ERROR register " + Marshal.GetLastWin32Error());
    else Console.Out.WriteLine("READY");
  }

  void FindSim() {
    if (sim != IntPtr.Zero) return;
    foreach (var p in Process.GetProcessesByName("FlightSimulator2024")) {
      if (p.MainWindowHandle != IntPtr.Zero) { sim = p.MainWindowHandle; simPid = (uint)p.Id; return; }
    }
  }

  void Emit(string kind, int delta) {
    FindSim();
    if (sim == IntPtr.Zero) { Console.Out.WriteLine("M " + kind + " " + delta + " 0 0 0 0 0 0 0"); return; }
    RECT r; GetClientRect(sim, out r);
    var o = new POINT(); ClientToScreen(sim, ref o);
    POINT c; GetCursorPos(out c);
    int w = r.R - r.L, h = r.B - r.T;
    uint fg; GetWindowThreadProcessId(GetForegroundWindow(), out fg);
    double x = w > 0 ? 2.0 * (c.X - o.X) / w - 1 : 0, y = h > 0 ? 1 - 2.0 * (c.Y - o.Y) / h : 0;
    Console.Out.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture, "M {0} {1} {2:F4} {3:F4} {4} {5} {6} {7} {8}", kind, delta, x, y, w, h, fg == simPid ? 1 : 0, dx, dy));
    lastW = w; lastH = h;
  }

  void CheckSize() {
    FindSim();
    if (sim == IntPtr.Zero) return;
    RECT r; GetClientRect(sim, out r);
    if (r.R - r.L != lastW || r.B - r.T != lastH) Emit("size", 0);
  }

  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x00FF) {
      uint hs = (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER)), size = 0;
      GetRawInputData(m.LParam, 0x10000003, IntPtr.Zero, ref size, hs);
      IntPtr buf = Marshal.AllocHGlobal((int)size);
      try {
        if (GetRawInputData(m.LParam, 0x10000003, buf, ref size, hs) == size && Marshal.ReadInt32(buf) == 0) {
          // RAWMOUSE after the header: usFlags at +0, usButtonFlags at +4,
          // usButtonData at +6, and lLastX and lLastY at +12 and +16, relative
          // unless usFlags has MOUSE_MOVE_ABSOLUTE (1).
          int moveFlags = (ushort)Marshal.ReadInt16(buf, (int)hs);
          int flags = (ushort)Marshal.ReadInt16(buf, (int)hs + 4);
          short data = Marshal.ReadInt16(buf, (int)hs + 6);
          int mx = 0, my = 0;
          if ((moveFlags & 1) == 0) { mx = Marshal.ReadInt32(buf, (int)hs + 12); my = Marshal.ReadInt32(buf, (int)hs + 16); dx += mx; dy += my; }
          double step = Math.Sqrt((double)mx * mx + (double)my * my);
          if (leftDown) leftTravel += step;
          if (rightDown) rightTravel += step;
          if ((flags & 0x0001) != 0) { leftDown = true; leftTravel = 0; dx = 0; dy = 0; Emit("left", 0); sinceMove.Restart(); }
          if ((flags & 0x0002) != 0) { leftDown = false; Emit("leftup", (int)Math.Round(leftTravel)); dx = 0; dy = 0; }
          if ((flags & 0x0004) != 0) { rightDown = true; rightTravel = 0; Emit("right", 0); }
          if ((flags & 0x0008) != 0) { rightDown = false; Emit("rightup", (int)Math.Round(rightTravel)); }
          if ((flags & 0x0010) != 0) Emit("middle", 0);
          if ((flags & 0x0400) != 0) Emit("wheel", data);
          if (leftDown && sinceMove.ElapsedMilliseconds >= 16) { Emit("move", 0); dx = 0; dy = 0; sinceMove.Restart(); }
          if (!leftDown) { dx = 0; dy = 0; }
          CheckSize();
        }
      } finally { Marshal.FreeHGlobal(buf); }
    }
    base.WndProc(ref m);
  }
}
"@
$m = New-Object CrosscheckMouse
[System.Windows.Forms.Application]::Run()
`

export function startMouse(onMouse) {
  const ps = powershell(MOUSE_PS, ["ignore", "pipe", "pipe"])
  const stop = () => { try { ps.kill() } catch { /* gone */ } }
  process.on("exit", stop)
  let err = ""
  ps.stderr.on("data", (d) => { err += d })
  return new Promise((ready, fail) => {
    ps.on("error", fail)
    ps.on("exit", (code) => fail(new Error(`the mouse reader stopped (${code}): ${err.trim().slice(0, 500)}`)))
    createInterface({ input: ps.stdout }).on("line", (l) => {
      if (l === "READY") return ready(stop)
      if (l.startsWith("ERROR")) return fail(new Error(`the mouse reader: ${l}`))
      if (!l.startsWith("M ")) return
      const [, kind, delta, x, y, width, height, fg, dx, dy] = l.split(" ")
      onMouse({ kind, delta: Number(delta), x: Number(x), y: Number(y), width: Number(width), height: Number(height), foreground: fg === "1", dx: Number(dx), dy: Number(dy), t: Date.now() })
    })
  })
}
