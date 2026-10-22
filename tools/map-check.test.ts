// Tests of the map check: each case writes a small tree into the system's temp folder,
// one that keeps every rule and one for each rule broken, and checks that the map check
// finds exactly the rules that tree breaks.
//
//   node --test tools/map-check.test.ts

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { checkMap, type Rule } from "./map-check.ts"

type Tree = Record<string, string>
type Crate = { dir: string; name: string; deps?: string[]; source?: string; procMacro?: boolean }

/**
 * A Cargo workspace of `members`, each depending on the crates its `deps` name, and of
 * crates in `outside/` that the workspace leaves out, as a crate from crates.io would be.
 */
function rust(members: Crate[], outside: Crate[] = []): Tree {
  const all = [...members, ...outside]
  const tree: Tree = {
    "Cargo.toml": `[workspace]\nmembers = [${members.map((c) => `"${c.dir}"`).join(", ")}]\nexclude = ["outside"]\nresolver = "3"\n`,
  }
  for (const c of all) {
    const deps = (c.deps ?? []).map((name) => {
      const dep = all.find((d) => d.name === name)
      if (!dep) throw new Error(`no crate ${name} in the tree`)
      return `${name} = { path = "${path.posix.relative(c.dir, dep.dir)}" }`
    })
    const lib = c.procMacro ? `[lib]\nproc-macro = true\n\n` : ""
    tree[`${c.dir}/Cargo.toml`] = `[package]\nname = "${c.name}"\nversion = "0.1.0"\nedition = "2024"\n\n${lib}[dependencies]\n${deps.join("\n")}\n`
    tree[`${c.dir}/src/lib.rs`] = c.source ?? ""
  }
  return tree
}

/** A tsconfig whose program takes every TypeScript file in the tree. */
const TS: Tree = {
  "tools/tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, module: "nodenext", moduleResolution: "nodenext", allowImportingTsExtensions: true, types: [] },
    include: ["../**/*.ts"],
  }),
  "package.json": `{ "type": "module" }`,
}

function findings(tree: Tree): Rule[] {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dualinput-map-check-"))
  try {
    for (const [file, text] of Object.entries(tree)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), text)
    }
    return [...new Set(checkMap(root).map((f) => f.rule))].sort()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test("a tree that keeps every rule passes", () => {
  const tree: Tree = {
    ...rust(
      [
        // A derive macro runs in the compiler, so what it reaches is no loop crate's I/O.
        { dir: "src/engines/messages", name: "messages", deps: ["derive"] },
        { dir: "src/engines/sim-client", name: "sim-client", deps: ["messages"] },
        { dir: "src/engines/object-mirror", name: "object-mirror" },
        { dir: "src/platform/kernel", name: "kernel", deps: ["messages"] },
        { dir: "src/platform/clients", name: "clients", deps: ["kernel", "messages"] },
        { dir: "src/platform/routine-host", name: "routine-host", deps: ["messages"] },
        { dir: "src/features/pointer-sync/core", name: "pointer-sync", deps: ["clients", "messages"], source: "use messages::pointer_sync::Press;\n" },
        { dir: "src/features/traffic/routines", name: "traffic-routines", deps: ["messages", "routine-host", "object-mirror"] },
        { dir: "src/sim-package/routines", name: "routines", deps: ["traffic-routines", "routine-host"] },
        {
          dir: "src/apps/core",
          name: "dualinput-core",
          deps: ["pointer-sync", "kernel", "routines"],
          source: `unsafe extern "C" {\n    fn _set_FMA3_enable(flag: i32) -> i32;\n}\n`,
        },
        { dir: "tools/thing", name: "thing", deps: ["messages"] },
      ],
      [
        { dir: "outside/derive", name: "derive", deps: ["windows-sys"], procMacro: true },
        { dir: "outside/windows-sys", name: "windows-sys" },
      ],
    ),
    ...TS,
    "src/engines/messages/ts/stamp.ts": `export const HASH = "0";\n`,
    "src/engines/messages/ts/pointer-sync/press.ts": `export type Press = { x: number };\n`,
    "src/engines/page-client/index.ts": `import { HASH } from "../messages/ts/stamp.ts";\nexport const hash = HASH;\n`,
    "src/platform/panel-bridge/index.ts": `import { hash } from "../../engines/page-client/index.ts";\nexport const bridge = hash;\n`,
    "src/features/pointer-sync/panel/index.ts":
      `import { bridge } from "../../../platform/panel-bridge/index.ts";\n` +
      `import type { Press } from "../../../engines/messages/ts/pointer-sync/press.ts";\n` +
      `export const press = (p: Press) => bridge + p.x;\n`,
  }
  assert.deepEqual(findings(tree), [])
})

// Each case breaks the rules it names, and keeps the others. When you add a rule to the
// map check, add a case that breaks it.
const cases: { name: string; rules: Rule[]; tree: Tree }[] = [
  {
    name: "an engine on the platform",
    rules: ["down-the-tiers"],
    tree: rust([
      { dir: "src/engines/messages", name: "messages", deps: ["kernel"] },
      { dir: "src/platform/kernel", name: "kernel" },
    ]),
  },
  {
    name: "a platform crate on a line above its own",
    rules: ["lines-below"],
    tree: rust([
      { dir: "src/platform/kernel", name: "kernel", deps: ["clients"] },
      { dir: "src/platform/clients", name: "clients" },
    ]),
  },
  {
    name: "an engine on another engine of its own line",
    rules: ["lines-below"],
    tree: rust([
      { dir: "src/engines/sim-client", name: "sim-client", deps: ["sim-awareness"] },
      { dir: "src/engines/sim-awareness", name: "sim-awareness" },
    ]),
  },
  {
    name: "the core's platform on the routine host",
    rules: ["outside-the-core"],
    tree: rust([
      { dir: "src/platform/kernel", name: "kernel", deps: ["routine-host"] },
      { dir: "src/platform/routine-host", name: "routine-host" },
    ]),
  },
  {
    name: "the routine host on an engine besides the message crate",
    rules: ["outside-the-core"],
    tree: rust([
      { dir: "src/platform/routine-host", name: "routine-host", deps: ["sim-client"] },
      { dir: "src/engines/sim-client", name: "sim-client" },
    ]),
  },
  {
    // A proc macro's dependencies leave the loop's I/O alone, but not the tiers.
    name: "an engine's proc macro on a feature",
    rules: ["down-the-tiers"],
    tree: rust([
      { dir: "src/engines/messages", name: "messages", deps: ["pointer-sync"], procMacro: true },
      { dir: "src/features/pointer-sync/core", name: "pointer-sync" },
    ]),
  },
  {
    name: "a feature on another feature's crate",
    rules: ["feature-on-feature"],
    tree: rust([
      { dir: "src/features/avatars/core", name: "avatars", deps: ["pointer-sync"] },
      { dir: "src/features/pointer-sync/core", name: "pointer-sync" },
    ]),
  },
  {
    name: "a feature naming another feature's modules of the message crate and the profile engine",
    rules: ["feature-on-feature"],
    tree: rust([
      { dir: "src/features/avatars/core", name: "avatars", source: "use messages::{ids, pointer_sync as p};\nuse profile_engine::pointer_sync::Displays;\n" },
      { dir: "src/features/pointer-sync/core", name: "pointer-sync" },
    ]),
  },
  {
    name: "a feature's routines on the core's platform",
    rules: ["feature-parts"],
    tree: rust([
      { dir: "src/features/traffic/routines", name: "traffic-routines", deps: ["kernel"] },
      { dir: "src/platform/kernel", name: "kernel" },
    ]),
  },
  {
    // Routines are loop crates too, so the transport breaks both rules.
    name: "a feature's routines on an engine that keeps the edge's rules",
    rules: ["feature-parts", "loop-io"],
    tree: rust([
      { dir: "src/features/traffic/routines", name: "traffic-routines", deps: ["transport"] },
      { dir: "src/engines/transport", name: "transport" },
    ]),
  },
  {
    name: "the platform on a tool",
    rules: ["nothing-on-apps"],
    tree: rust([
      { dir: "src/platform/kernel", name: "kernel", deps: ["thing"] },
      { dir: "tools/thing", name: "thing" },
    ]),
  },
  {
    name: "a loop crate reaching tokio through a crate that isn't ours",
    rules: ["loop-io"],
    tree: rust(
      [{ dir: "src/platform/kernel", name: "kernel", deps: ["helper"] }],
      [
        { dir: "outside/helper", name: "helper", deps: ["tokio"] },
        { dir: "outside/tokio", name: "tokio" },
      ],
    ),
  },
  {
    name: "a loop crate reaching the transport",
    rules: ["loop-io"],
    tree: rust([
      { dir: "src/features/traffic/core", name: "traffic", deps: ["transport"] },
      { dir: "src/engines/transport", name: "transport" },
    ]),
  },
  {
    name: "foreign functions outside the edges, and in src/apps/core beside _set_FMA3_enable",
    rules: ["foreign-functions"],
    tree: rust([
      { dir: "src/engines/messages", name: "messages", source: `unsafe extern "C" {\n    fn puts(s: *const u8) -> i32;\n}\n` },
      { dir: "src/apps/core", name: "dualinput-core", source: `unsafe extern "C" {\n    fn _set_FMA3_enable(flag: i32) -> i32;\n    fn rand() -> i32;\n}\n` },
    ]),
  },
  {
    name: "a feature implementing Moment",
    rules: ["feature-moments"],
    tree: rust([{ dir: "src/features/traffic/core", name: "traffic", source: "pub struct Spotted;\nimpl kernel::Moment for Spotted {}\n" }]),
  },
  {
    name: "the platform naming a feature's module of the message crate",
    rules: ["platform-names-feature"],
    tree: rust([
      { dir: "src/platform/session", name: "session", source: "use messages::traffic::Copy;\n" },
      { dir: "src/features/traffic/core", name: "traffic" },
    ]),
  },
  {
    name: "crates in no unit of the picture",
    rules: ["unmapped"],
    tree: rust([
      { dir: "src/engines/widgets", name: "widgets" },
      { dir: "misc/thing", name: "thing" },
    ]),
  },
  {
    name: "a feature's panel module importing another feature's types alone",
    rules: ["feature-on-feature"],
    tree: {
      ...TS,
      "src/features/pointer-sync/panel/press.ts": `export type Press = { x: number };\n`,
      "src/features/avatars/panel/hand.ts": `import type { Press } from "../../pointer-sync/panel/press.ts";\nexport const reach = (p: Press) => p.x;\n`,
    },
  },
  {
    name: "a panel module importing the EFB app's shell",
    rules: ["feature-parts"],
    tree: {
      ...TS,
      "src/platform/efb-shell/api.ts": `export const api = 1;\n`,
      "src/features/pointer-sync/panel/index.ts": `import { api } from "../../../platform/efb-shell/api.ts";\nexport const x = api;\n`,
    },
  },
  {
    name: "the panel bridge importing the sim's pages",
    rules: ["nothing-on-apps"],
    tree: {
      ...TS,
      "src/sim-package/pages/efb.ts": `export const efb = 1;\n`,
      "src/platform/panel-bridge/bridge.ts": `import { efb } from "../../sim-package/pages/efb.ts";\nexport const bridge = efb;\n`,
    },
  },
  {
    name: "the EFB app's shell importing a feature's module of the messages' types",
    rules: ["platform-names-feature"],
    tree: {
      ...TS,
      "src/engines/messages/ts/traffic/copy.ts": `export type Copy = { id: string };\n`,
      "src/features/traffic/efb/slice.ts": `export const slice = 1;\n`,
      "src/platform/efb-shell/frame.ts": `import type { Copy } from "../../engines/messages/ts/traffic/copy.ts";\nexport const frame = (c: Copy) => c.id;\n`,
    },
  },
]

for (const c of cases) {
  test(c.name, () => {
    assert.deepEqual(findings(c.tree), c.rules)
  })
}
