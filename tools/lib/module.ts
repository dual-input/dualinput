import fs from "node:fs"
import path from "node:path"

import { ROOT } from "./repo.ts"
import { run } from "./run.ts"
import { sdkFolder } from "./sdk.ts"

/** Where cargo-msfs writes our WASM module, which the package then copies. */
export const MODULE = path.join(ROOT, "target", "sim-package", "dualinput.wasm")

/**
 * What the sim calls in a standalone module, which p03 checked each of our builds for:
 * `module_init`, `module_deinit`, and `Update_StandAlone`, and the allocator's functions
 * that cargo-msfs exports from the SDK's C library (measured on MSFS 2024, 2026-10-08,
 * record/areas/architecture/log.md, the entry on the standalone module built from Rust).
 */
export const REQUIRED_EXPORTS = [
  "module_init",
  "module_deinit",
  "Update_StandAlone",
  "malloc",
  "free",
  "mallinfo",
  "mchunkit_begin",
  "mchunkit_next",
  "get_pages_state",
  "mark_decommit_pages",
  "__wasm_call_ctors",
]

// Node runs WebAssembly, but TypeScript declares its types only with the DOM's, which the
// tools' tsconfig leaves out, so this declares the two calls the check makes.
declare const WebAssembly: {
  Module: { new (bytes: Uint8Array): object; exports(module: object): { name: string }[] }
}

/**
 * Builds our WASM module with cargo-msfs, which sets what the module's build script reads,
 * so the module builds only this way, and returns the file it wrote.
 */
export function buildModule(): string {
  fs.mkdirSync(path.dirname(MODULE), { recursive: true })
  run("cargo-msfs", ["build", "msfs2024", "-i", "src/sim-package/wasm-module", "-o", MODULE])
  return MODULE
}

/**
 * Runs Clippy on our WASM module, for wasm32, which the default members' Clippy leaves out,
 * since the module's build script reads the two variables cargo-msfs sets: the SDK's folder,
 * and the WASI sysroot inside it. A panic in the module stops every routine in the sim, so
 * the module and every crate built into it deny the commonest panics, and only this run
 * holds the module to that (record/areas/architecture/02-code-map.md, "When the module
 * stops").
 */
export function clippyModule(): void {
  const sdk = sdkFolder()
  const env = { ...process.env, MSFS_SDK: sdk, WASI_SYSROOT: path.join(sdk, "WASM", "wasi-sysroot") }
  run("cargo", ["clippy", "-p", "wasm-module", "--target", "wasm32-wasip1", "--", "-D", "warnings"], { env })
}

/** Each of `REQUIRED_EXPORTS` the module in `wasm` lacks, read without running the module. */
export function missingExports(wasm: Uint8Array): string[] {
  const exports = new Set(WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map((e) => e.name))
  return REQUIRED_EXPORTS.filter((name) => !exports.has(name))
}
