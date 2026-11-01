// After an agent edits code that runs in the sim, rebuilds our bundles with esbuild and checks
// them against what Coherent GT runs, and hands the findings back as context, at our
// TypeScript's line, as prose-lint's hook hands back its own
// (record/areas/build/01-the-build.md, "The Coherent GT check").
//
//   node tools/coherent-hook.ts      (Claude Code runs it, with the edit on stdin)

import path from "node:path"

import { isInSimCode } from "./lib/in-sim.ts"
import { fromRoot } from "./lib/repo.ts"
import { Failed } from "./lib/run.ts"

async function main(): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  // Windows PowerShell puts a byte order mark in front of what it pipes.
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "")) as { tool_input?: { file_path?: string } }
  const file = payload.tool_input?.file_path
  if (!file) return
  const rel = fromRoot(path.resolve(file))
  // An experiment's panel files are JavaScript as written, so each gets the check alone; its
  // Node probes are .mjs, which the check skips (record/areas/build/01-the-build.md, "The
  // Coherent GT check").
  if (rel.startsWith("experiments/") && rel.endsWith(".js")) {
    const { checkFile, format } = await import("coherent-checks")
    const findings = checkFile(path.resolve(file)).map((f) => format(rel, f))
    if (findings.length) say(`Coherent GT check:\n${findings.join("\n")}`)
    return
  }
  if (!isInSimCode(rel)) return
  // Loaded only for an edit in the sim's code, so every other edit's hook stays quick.
  const { buildPages, checkPages } = await import("./lib/pages.ts")
  let context: string | null = null
  try {
    checkPages(await buildPages())
  } catch (error) {
    // A broken build must not stop edits, but the agent should hear about it.
    context = error instanceof Failed ? `Coherent GT check: ${error.message}` : `the Coherent GT check failed and checked nothing: ${String(error)}`
  }
  if (context) say(context)
}

function say(context: string): void {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } }))
}

await main()
