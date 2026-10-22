// Suspending and resuming a process, as an outage: a suspended core holds its sockets open
// and stops answering, where a killed one closes them (FS Copilot fork,
// record/pointer-forwarding/docs/14-test-bench.md, "Outages are made by suspending a process").

import { spawnSync } from "node:child_process"

/** ntdll's NtSuspendProcess and NtResumeProcess, which act on every thread of a process at once. */
const NTDLL = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DualInputNt { [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr p); [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr p); }'`

function nt(call: "NtSuspendProcess" | "NtResumeProcess", pid: number): void {
  const script = `${NTDLL}; $p = [System.Diagnostics.Process]::GetProcessById(${pid}); exit [DualInputNt]::${call}($p.Handle)`
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`${call} on ${pid} failed with ${result.status}: ${result.stderr}`)
}

export function suspend(pid: number): void {
  nt("NtSuspendProcess", pid)
}

export function resume(pid: number): void {
  nt("NtResumeProcess", pid)
}
