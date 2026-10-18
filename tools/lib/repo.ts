import path from "node:path"
import { fileURLToPath } from "node:url"

/** The repository's root, two folders above this file. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

/** A path from the root with `/` between folders, such as `tools/check.ts`, as the record writes paths. */
export function fromRoot(file: string, root = ROOT): string {
  return path.relative(root, file).split(path.sep).join("/")
}
