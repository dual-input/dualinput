import fs from "node:fs"
import path from "node:path"

import { ROOT } from "./repo.ts"
import { run } from "./run.ts"

/**
 * The folder ts-rs writes the messages' TypeScript types into. TS_RS_EXPORT_DIR in
 * .cargo/config.toml names the same folder, so change both together.
 */
export const TYPES = path.join(ROOT, "src", "engines", "messages", "ts")

/**
 * Writes the messages' TypeScript types and `stamp.ts` again, by running the message
 * crate's tests, where ts-rs generates them. It deletes the folder first, since ts-rs
 * never deletes a file it wrote, so a deleted message's type would stay behind (ts-rs
 * 12.0.1's source calls no `remove_file`).
 */
export function writeMessageTypes(): void {
  fs.rmSync(TYPES, { recursive: true, force: true })
  run("cargo", ["test", "-p", "messages", "--lib"])
}

/** Each file under `TYPES` and its text, keyed by its path from `TYPES`, such as `pointer-sync/press.ts`. */
export function readMessageTypes(): Map<string, string> {
  const files = new Map<string, string>()
  if (!fs.existsSync(TYPES)) return files
  for (const entry of fs.readdirSync(TYPES, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = path.join(entry.parentPath, entry.name)
    files.set(path.relative(TYPES, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8"))
  }
  return files
}
