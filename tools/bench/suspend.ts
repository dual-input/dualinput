// Suspending and resuming a process, as an outage: a suspended core holds its sockets open
// and stops answering, where a killed one closes them (FS Copilot fork,
// record/pointer-forwarding/docs/14-test-bench.md, "Outages are made by suspending a process").

import { spawn } from "node:child_process"

/** ntdll's NtSuspendProcess and NtResumeProcess, which act on every thread of a process at once. */
const NTDLL = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DualInputNt { [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr p); [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr p); }'`

/**
 * Runs the call in a PowerShell of its own without blocking the bench, whose fake pages keep
 * sending to the core while PowerShell starts and compiles the call: on a GitHub runner that
 * took over 8s, and a core that hears nothing from a page for 8s closes its socket.
 */
function nt(call: "NtSuspendProcess" | "NtResumeProcess", pid: number): Promise<void> {
  const script = `${NTDLL}; $p = [System.Diagnostics.Process]::GetProcessById(${pid}); exit [DualInputNt]::${call}($p.Handle)`
  const child = spawn("powershell", ["-NoProfile", "-Command", script], { stdio: ["ignore", "ignore", "pipe"] })
  let stderr = ""
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()))
  return new Promise((resolve, reject) => {
    child.on("error", reject)
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${call} on ${pid} failed with ${code}: ${stderr}`))))
  })
}

export function suspend(pid: number): Promise<void> {
  return nt("NtSuspendProcess", pid)
}

export function resume(pid: number): Promise<void> {
  return nt("NtResumeProcess", pid)
}
