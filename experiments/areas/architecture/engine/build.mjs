/*
 * Compiles p04's TypeScript into one ES2020 script per bundle, in dist/.
 *
 *   node experiments/areas/architecture/engine/build.mjs
 *
 * Each bundle is an IIFE that leaves one global (pluginBundle, writersBundle,
 * runawayBundle), so the same file runs as a plain script in QuickJS, in V8, and
 * in Node's vm, and none of them needs a module loader.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { build, version } from "esbuild"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(HERE, "dist")

export const BUNDLES = [
  ["plugin", "pluginBundle"],
  ["writers", "writersBundle"],
  ["runaway", "runawayBundle"],
]

export async function buildBundles() {
  fs.mkdirSync(DIST, { recursive: true })
  for (const [name, globalName] of BUNDLES) {
    await build({
      entryPoints: [path.join(HERE, "ts", `${name}.ts`)],
      outfile: path.join(DIST, `${name}.js`),
      bundle: true,
      format: "iife",
      globalName,
      target: "es2020",
      logLevel: "warning",
    })
  }
  return { dist: DIST, esbuild: version }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { dist } = await buildBundles()
  for (const [name] of BUNDLES) console.log(`${name}.js ${fs.statSync(path.join(dist, `${name}.js`)).size} bytes`)
}
