/*
 * Key presses sent to the sim the way a real keyboard sends them, for probes
 * that press the pilot's own bindings.
 *
 * SendInput by scan code moves the sim's cockpit camera as the pilot's keys do,
 * with the sim's window in front, and the sim ignores key messages posted to its
 * window (measured on MSFS 2024, 2026-10-04, record/areas/aircraft/log.md, "Key
 * presses a program sends move the cockpit eye"). So this presses a key only
 * while the sim's window is in front, checked before every press, and releases
 * every key it pressed in a finally block; it's in the pilot's input path, so
 * it fails open (CLAUDE.md, Before writing code that runs in a panel).
 *
 *   const keys = startKeySender()
 *   await keys.front()                 // "OK in front" or "NO not in front"
 *   await keys.focus()                 // tries to bring the sim to the front
 *   await keys.press([0xa0, 0x44], 500) // Shift+D for 500ms; "OK sent" or "SKIPPED …"
 *   await keys.releaseAll([0xa0, 0x44])
 *   keys.close()
 */

import { createInterface } from "node:readline"
import { powershell } from "./guide.mjs"

const KEYS_PS = `
$ProgressPreference = "SilentlyContinue"
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Threading;
public static class CrosscheckSendKeys {
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  const uint KEYEVENTF_KEYUP = 2, KEYEVENTF_SCANCODE = 8;
  static void Key(ushort vk, bool down) {
    INPUT[] i = new INPUT[1]; i[0].type = 1;
    i[0].ki.wScan = (ushort)MapVirtualKey(vk, 0); i[0].ki.dwFlags = KEYEVENTF_SCANCODE | (down ? 0 : KEYEVENTF_KEYUP);
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  public static string Press(IntPtr sim, ushort[] vks, int ms) {
    if (GetForegroundWindow() != sim) return "SKIPPED the sim isn't in front";
    int pressed = 0;
    try { foreach (ushort vk in vks) { Key(vk, true); pressed++; } Thread.Sleep(ms); }
    finally { for (int k = pressed - 1; k >= 0; k--) Key(vks[k], false); }
    return "OK sent";
  }
  public static void ReleaseAll(ushort[] vks) { foreach (ushort vk in vks) Key(vk, false); }
}
"@
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = Get-Process -Name FlightSimulator2024 -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if (-not $p) { [Console]::Out.WriteLine("ERR no sim window"); continue }
  $f = $line.Split(" ")
  try {
    if ($f[0] -eq "front") { [Console]::Out.WriteLine($(if ([CrosscheckSendKeys]::GetForegroundWindow() -eq $p.MainWindowHandle) { "OK in front" } else { "NO not in front" })) }
    elseif ($f[0] -eq "focus") { [void][CrosscheckSendKeys]::SetForegroundWindow($p.MainWindowHandle); Start-Sleep -Milliseconds 300; [Console]::Out.WriteLine($(if ([CrosscheckSendKeys]::GetForegroundWindow() -eq $p.MainWindowHandle) { "OK in front" } else { "NO not in front" })) }
    elseif ($f[0] -eq "release") { [CrosscheckSendKeys]::ReleaseAll([uint16[]]($f[1].Split(","))); [Console]::Out.WriteLine("OK released") }
    elseif ($f[0] -eq "press") { [Console]::Out.WriteLine([CrosscheckSendKeys]::Press($p.MainWindowHandle, [uint16[]]($f[1].Split(",")), [int]$f[2])) }
    else { [Console]::Out.WriteLine("ERR unknown command") }
  } catch { [Console]::Out.WriteLine("ERR " + $_.Exception.Message) }
}`

export function startKeySender() {
  const ps = powershell(KEYS_PS, ["pipe", "pipe", "ignore"])
  const replies = []
  createInterface({ input: ps.stdout }).on("line", (l) => replies.shift()?.(l))
  const ask = (cmd, timeoutMs = 5000) => Promise.race([
    new Promise((resolve) => { replies.push(resolve); ps.stdin.write(cmd + "\n") }),
    new Promise((resolve) => setTimeout(() => resolve(`ERR no reply in ${timeoutMs / 1000}s`), timeoutMs)),
  ])
  return {
    front: () => ask("front"),
    focus: () => ask("focus"),
    press: (vks, ms) => ask(`press ${vks.join(",")} ${Math.max(1, Math.round(ms))}`, ms + 5000),
    releaseAll: (vks) => ask(`release ${vks.join(",")}`),
    close() { try { ps.stdin.end(); ps.kill() } catch { /* gone */ } },
  }
}
