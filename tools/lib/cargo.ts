// Building our programs with Cargo, and finding each by the path Cargo reports, so a tool never
// runs a program from another build: FS Copilot's exerciser ran whatever its checkout had
// compiled last, which cost two sessions (record/areas/build/02-testing.md, "Building what it
// runs").

import { spawnSync } from "node:child_process"

import { ROOT } from "./repo.ts"
import { Failed } from "./run.ts"

/**
 * Runs `cargo build` with `args`, such as `["-p", "dualinput-core"]`, and returns each of
 * `programs`' executables, by its target's name, as Cargo reported it. `cwd` is the
 * workspace's folder, the root's unless another, such as the desktop app's, is given.
 */
export function buildPrograms<const N extends string>(args: string[], programs: readonly N[], cwd = ROOT): Record<N, string> {
  const command = ["build", ...args]
  console.log(`> cargo ${command.join(" ")}`)
  const result = spawnSync("cargo", [...command, "--message-format", "json-render-diagnostics"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "inherit"],
  })
  if (result.status !== 0) throw new Failed(`cargo ${command.join(" ")} exited with ${result.status}`)
  const built = new Map<string, string>()
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue
    const message = JSON.parse(line) as { reason?: string; target?: { name?: string }; executable?: string | null }
    if (message.reason === "compiler-artifact" && message.target?.name && message.executable) {
      built.set(message.target.name, message.executable)
    }
  }
  const found = {} as Record<N, string>
  for (const name of programs) {
    const executable = built.get(name)
    if (!executable) throw new Failed(`cargo reported no ${name}.exe`)
    found[name] = executable
  }
  return found
}
