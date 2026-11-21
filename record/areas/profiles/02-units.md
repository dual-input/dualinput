# Profiles: their units

```text
Purpose:     The profile engine's, the profile builder's, and the profile loader's interfaces, and how a bundle is built, published, fetched, cached, pinned, and loaded.
Depends on:  01-format-and-delivery.md, ../architecture/02-code-map.md, ../core/01-loop-and-edge.md, ../core/03-sim-seam-and-wasm-module.md, ../session/02-units.md, ../sync/05-units.md, ../plugins/01-plugins.md, ../recording/01-recording-and-bug-reports.md, ../build/01-the-build.md, log.md
Decides:     Which compiler builds a bundle, and where it runs; the YAML parser; a bundle's exact bytes and its hash; the index; how CI publishes and keeps every bundle, and at which levels; whether CI holds a released level's builder output to its release tag; where the core fetches from; the cache; the local folder; the pin's key; how a bundle loads; the match check's item; the budgets; and the cases for the bench (node 6.8).
```

> **Note**
> From stage 22c ([profiles log](log.md#2026-11-21-the-formats-audit-before-level-1-freezes-puts-maps-on-their-own-lines-types-instrument-readings-and-names-one-layout); user, 2026-11-21):
>
> - In [levels](#levels), each level has two schemas in `levels/<n>/`: `profile.json` for a file in `profiles/aircraft/` and `module.json` for one in `profiles/modules/`, each with its required fields, and an editor picks one by the file's folder.
>   The declarations type an `instrument()` entry as a number, or as text with `'string'`.
> - In [a bundle's bytes](#a-bundles-bytes), the top-level keys come in [the format's layout](01-format-and-delivery.md#layout)'s order.
> - CI holds a level's files only to release tags from 1.0.0 on, since nobody flies a release before it, and [publishing](#publishing) still counts every release tag's `LEVEL` as released, so a 0.x release gets the tree's profiles.

The core loads bundles and never builds one.
A published bundle comes from our Pages site under its hash, and an unpublished one from a local folder that the profile builder or the IDE wrote it into.
The profile builder type-checks and compiles with TypeScript 6.0.3's own compiler inside QuickJS-ng, the same code in CI, in the `dualinput-profile-builder` program the core team runs from the repository, and later in the IDE, so `typescript.js` never ships to pilots.
CI publishes to a branch it only ever adds files to, and only at levels a release supports, and the index lists, for each profile, the bundle a core at each level takes.
On the core, a job reads, parses, and checks the pinned bundle, and the loop decodes the result and raises `ProfileLoaded`.

This answers node 6.8 of the [architecture plan](../architecture/plan.md#68-profiles).
[01-format-and-delivery](01-format-and-delivery.md) gives the format, the checks, the levels, and delivery, the code map's [profiles in this repository](../architecture/02-code-map.md#profiles-in-this-repository) puts them in `profiles/`, and [the session's units](../session/02-units.md#which-bundle-a-session-pins) has the PF's loader pin the bundle; this document holds only what they leave out.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `profile-engine` | Engine | The format, its blocks and each feature's, every check but the type check, the levels' frozen schemas and declarations, reading a bundle, writing one, and the program TypeScript checks | In the core's jobs, the builder, and CI |
| `profile-build` | Engine | Building a bundle: modules merged, the type check and compile with TypeScript 6.0.3 inside QuickJS-ng, the level worked out, and the bundle read back | In the builder, CI, and later the IDE, and never in the core |
| `profile-loader` | Platform | The index, the cache, the local folder, the pin, the loaded profile, and the match check's item | On the loop, with jobs at the edge |
| `tools/profile-builder` | Tool | The program `dualinput-profile-builder`: building, watching, and publishing | For the core team, from the repository, and CI |

- `profile-engine` uses the message crate, as the code map's [engines](../architecture/02-code-map.md#engines) row has it, and reads no file: whoever runs it hands it the files' bytes.
- `profile-build` uses `profile-engine` and rquickjs, so it sits on the engines' top line, beside the sync engine.
  It runs QuickJS-ng through rquickjs itself, not through the sandbox, whose limits and missing clock are for profiles' scripts and plugins ([decision 046](../../decisions/046-sandbox-runtimes-and-limits.md)), not for our own compiler.
- `profile-loader` uses what the code map's [platform](../architecture/02-code-map.md#the-platform) row lists, and the core never links `profile-build`.

## The profile engine

```rust
// a sketch: src/engines/profile-engine
pub const LEVEL: u32 = 1;                                                  // the highest level this build reads

pub fn read(bundle: &[u8], level: u32) -> Result<Profile, Report>;        // a bundle, checked against that level's schema
pub fn source(files: &impl Files, path: &str) -> Result<Source, Report>;   // a profile and its modules, parsed
pub fn check(source: &Source, level: u32) -> Report;                       // every check but the type check
pub fn program(source: &Source, level: u32) -> Program;                    // the level's declarations, and every script, for TypeScript
pub fn place(program: &Program, found: &[Diagnostic]) -> Report;           // TypeScript's errors, at the YAML's lines and columns
pub fn write(source: &Source, compiled: &Compiled) -> Vec<u8>;             // the bundle's bytes

impl Profile {
    pub fn covers(&self, aircraft: &Aircraft) -> Option<&VariantId>;      // a preset's match beats its folder's
    pub fn resolve(&self, variant: &VariantId) -> Resolved;                // each block, filtered by `only`
}
```

- A `Report` holds errors and warnings, each with its file, line, column, and a code, so the builder, CI, and the IDE point at the same place.
- The engine parses with saphyr 0.2.2.
  Its tree carries a span on every node, a repeated key is an error by default from 0.2.0, and it reads YAML 1.2, so `no` stays a string (read in saphyr's source and `CHANGELOG.md`, 2026-10-16).
  Our own walker over that tree is the checker, since a field's level is ours to check and serde's "unknown field" can't express it.
  serde-saphyr 2.0.0 deserializes into serde types with spans, but has one owner on crates.io, shipped 1.0.0 on 2026-07-31 and 2.0.0 on 2026-10-13, and loses a value's place inside untagged enums, which `write:` is, since "Serde buffers the values without preserving YAML location" (documented, serde-saphyr's README, `Spanned`).
  serde_yaml is deprecated, and the libyaml translation under it carries advisory [RUSTSEC-2024-0449](https://rustsec.org/advisories/RUSTSEC-2024-0449.html).
- Each feature's block is a module of the engine's, which registers the block's key, the level it came in at, its fields with theirs, its checks, and its declarations, as the code map's [tiers](../architecture/02-code-map.md#tiers) keep each feature's block there.
- `program` writes, for each variant, one TypeScript file that declares `state` with that variant's entries and wraps each write function in a constant of its type, so a function that reads a key a variant lacks fails as [what fails a load](01-format-and-delivery.md#what-fails-a-load) requires.
  It records where each script sits, so `place` turns TypeScript's lines into the YAML's.
- `read` checks a bundle against the schema of the level it's given, the core's `LEVEL`, and runs no type check, since the builder ran it on that bundle's source.

### Levels

- Each level's schema, as JSON Schema, so an editor's YAML support can complete a profile's fields, and its declarations, as one `.d.ts`, are files the engine generates from its blocks into `src/engines/profile-engine/levels/<n>/`.
  They're committed, and CI generates them again and fails on a difference, beside holding a released level's to its release tag ([profiles in this repository](../architecture/02-code-map.md#profiles-in-this-repository)).
- TypeScript checks with `noLib`, so a level's declarations are the scripts' whole world: first the JavaScript the sandbox runs, TypeScript 6.0.3's own library declarations kept to the globals and members the sandbox's context defines ([log][p03]), then the names, `write()`, the chain, and `state`, and nothing the sandbox leaves out, such as `Date` ([one loop](../architecture/02-code-map.md#one-loop)).
  - They name no `instrument()`, which only a watch takes and the engine reads without TypeScript, so a write function that calls it fails its type check, and no `aircraft`, which the format never defined, since `only` covers what differs between variants (user, 2026-10-24).
  - They name no `plugin`, since v1 has no plugins ([no plugins in v1](../plugins/01-plugins.md#no-plugins-in-v1)).
- The sandbox's context holds the base objects and, of rquickjs's intrinsics, `Eval`, `RegExp`, and `Promise`, and deletes the `Promise` and `AsyncDisposableStack` globals that `Promise` adds, so a script sees the same globals as without it ([the sandbox](../plugins/01-plugins.md#the-sandbox); [plugins log](../plugins/log.md#2026-10-24-stage-12s-sandbox-stops-a-write-functions-endless-loop-at-100-interrupt-checks-and-needs-quickjs-ngs-promise-intrinsic-without-which-an-async-function-aborts-the-core-when-its-sandbox-is-dropped)).

### A bundle's bytes

`write` lays a bundle out in one way, so the same files and the same builder give the same bytes on any PC:

- The top-level keys come in one fixed order, and the entries in their source's order, the profile's first, then each module's in the order it's imported.
- Every script is a `|` block holding the compiled JavaScript, every other value is plain where YAML allows it, and the file has no comments and no `import`, in UTF-8 with LF line endings.
- The level isn't in the bytes, since the index carries it ([the index](#the-index)).

A bundle's hash is SHA-256 over its bytes, written as lowercase hex, through `sha2` 0.11, which iroh already brings into the core (read in our network probes' `Cargo.lock`, such as `experiments/areas/network/two-cores/Cargo.lock`), and which a bug report's upload, after v1, uses too ([a bug report](../recording/01-recording-and-bug-reports.md#a-bug-report); user, 2026-10-21; [recording log][every]).
Windows' `Get-FileHash` takes SHA-256 by default, so anyone can check a bundle against its name.

## The builder

```rust
// a sketch: src/engines/profile-build
pub struct Compiler;                                                       // typescript.js in a QuickJS-ng runtime of its own

impl Compiler {
    pub fn new() -> Compiler;                                              // loads the compiler
    pub fn check(&mut self, program: &Program) -> Vec<Diagnostic>;
    pub fn compile(&mut self, program: &Program) -> Compiled;              // every script, at ES2020
}

pub fn build(files: &impl Files, path: &str, compiler: &mut Compiler) -> Built;

pub struct Built {
    pub bundle: Option<Vec<u8>>,   // none when the report holds an error
    pub hash: Option<String>,
    pub level: Option<u32>,
    pub covers: Vec<Variant>,
    pub report: Report,
}
```

`build` does, in order:

1. Parses the profile and its modules with `source`, and runs `check` at each level from 1 up to `LEVEL`.
2. Type-checks `program` at each level whose schema passed, from the lowest, and the lowest level that passes both is the bundle's, as [levels](01-format-and-delivery.md#levels) works it out.
3. Compiles every script at ES2020, the one target for every level, so the syntax a released core parses never changes, and compiles each result in its own QuickJS-ng without running it, so a script the sandbox couldn't parse fails the build.
4. Writes the bundle, hashes it, and reads it back with `read` at its level, so the bytes a core will read pass their level's frozen schema, as the source did.

### TypeScript 6.0.3 inside QuickJS-ng

The builder runs TypeScript's own compiler, `typescript.js` 6.0.3, in a QuickJS-ng runtime through rquickjs 0.14.0, the same in every place it runs (user, 2026-10-16).

- It ran there unmodified, and its errors and output matched Node's byte for byte; a profile of 300 write functions took about 660ms to check and compile, after a load of about 240ms, with 57 MB of memory, on a 1 MB stack ([log][p02]).
- It's the smallest option that type-checks: `typescript.js` is 9.1 MB, 1.2 MB under zstd, against 24.5 MB, 7.7 MB under zstd, for tsgo 7.0.2's program ([log][p02]).
- It runs in process through its own API, so the IDE's Rust side can link `profile-build` as it is, while TypeScript 7.0 "does not yet expose a stable programmatic API", and 7.1 is expected to ship a new, different one (documented, [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)), so a builder on tsgo would drive its command line and read its output.
- Pinned at 6.0.3 exactly, its output stays put, and as of Microsoft's post of 2025-12-02, TypeScript 6.0's patches are to be "infrequent, and only issued when absolutely necessary" (documented, [Progress on TypeScript 7](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)); checking small scripts against our declarations needs nothing TypeScript adds after it.
- The root's `package.json` names it under an alias of its own, `typescript-6`, beside the TypeScript 7.0.2 our own type checks run, so the lockfile pins its bytes, and `profile-build` embeds `typescript.js` from `node_modules` as it compiles, so building it takes `npm ci` first, as a new PC's steps run (user, 2026-10-24).

oxc and swc strip types, adding 2.2 MB and 6.2 MB to a release build, and type-check nothing, so a builder on either would skip the check [what fails a load](01-format-and-delivery.md#what-fails-a-load) requires ([log][p02]).

Nothing in a bundle or a released core names the compiler: a level's declarations and the one target are what stay fixed.
So moving to TypeScript 7, if the IDE's editor runs it, is a change to the builder alone, after which CI publishes again each bundle whose bytes changed, and pilots download each once.

### The builder program

`tools/profile-builder` builds `dualinput-profile-builder`, which keeps that name and runs from the repository for the core team, since v1 ships no authoring tool ([authoring tools](../build/01-the-build.md#authoring-tools)).
Its commands:

| Command | Does |
| --- | --- |
| `build <profile or folder> [--out <folder>]` | Builds each profile, prints its report, and writes each bundle under its profile's file name, replacing the last one built |
| `watch <profile or folder> --out <folder>` | The same, again on every save |
| `publish` | CI's: builds every profile in `profiles/aircraft/` and lays out the Pages tree ([publishing](#publishing)) |

A member of the core team points `--out` at their local folder ([the local folder](#the-local-folder)), and the IDE, once it comes, calls `build` in process on each save, so its authors run no command (user, 2026-10-16).
A contributor without the workspace's setup sends a profile's change as a pull request and reads CI's check ([authoring tools](../build/01-the-build.md#authoring-tools)).

## Publishing

CI's profiles job, a reusable workflow, runs on each merge to `main` that changes `profiles/` or either profile engine, and on each release, whose workflow calls it ([authoring tools](../build/01-the-build.md#authoring-tools)):

1. It runs `dualinput-profile-builder publish` on `main`'s newest commit.
2. It fails on any error, and when two profiles cover one folder or preset.
3. It leaves out each bundle at a level no release supports yet: a level is released once a release tag's `LEVEL` reaches it, which CI reads from the tags.
4. It commits each new bundle as `bundles/<hash>.yaml`, and the new `index.json`, to the `pages` branch, which Pages serves, and never deletes a file there.

- **A branch keeps every bundle.** Pages publishes a branch's folder on each push (documented, [Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)), so a bundle stays published as long as the branch keeps its file, while a deploy from Actions uploads the site's files as one artifact each time, so keeping the old bundles would mean fetching them back first.
  The branch holds an empty `.nojekyll` file, which has Pages skip Jekyll and serve the files as they are (documented, [Bypassing Jekyll on GitHub Pages](https://github.blog/news-insights/the-library/bypassing-jekyll-on-github-pages/)).
- **Only released levels publish.** A level still on `main` can change before its release, and a bundle published at it would be kept for good under a schema its release may not hold, so a profile that needs a new block merges, and publishes when the release that carries the block ships.
- **No hold on the builder's bytes.** CI checks each bundle against its level's frozen schema and declarations, by reading the bundle back ([the builder](#the-builder)), and compiles every script at ES2020, so what a released loader reads is what its level allows; this answers the line [5.4](../architecture/plan.md#54-the-workspace) raised, and settles the code map's [left open](../architecture/02-code-map.md#left-open) item on it.
  CI loading each new bundle in the builder of every release at or above its level would hold more, with one cached program per release.

### The index

```json
{
  "profiles": [
    {
      "path": "aircraft/bksq-baronpro",
      "bundles": [
        { "level": 1, "hash": "a1b2…", "published": "2026-10-20T14:02:11Z", "variants": ["bksq-aircraft-baronpro", "bksq-aircraft-baronproturbo", "bksq-aircraft-baronpropress"] },
        { "level": 2, "hash": "c3d4…", "published": "2026-11-05T09:40:57Z", "variants": ["bksq-aircraft-baronpro", "bksq-aircraft-baronproturbo", "bksq-aircraft-baronpropress"] }
      ]
    }
  ]
}
```

The hashes and dates are [levels](01-format-and-delivery.md#levels)' hypothetical example, and `published` is the UTC time CI published each.

- A core takes, for each profile, the newest bundle at or below its own level, and the index lists only the bundles some level takes, so it grows with profiles and levels and not with every merge.
  In the sketch, a core at level 1 takes `a1b2…`, and one at level 2 or above takes `c3d4…`.
- Every other bundle stays fetchable by its hash, which a pin needs ([the pin](#the-pin)).
- Each bundle's entry lists the variants it covers, so the core matches an aircraft to a profile without opening a bundle.

### Where the core fetches from

The core fetches from a subdomain of ours pointed at the Pages site, `profiles.dualinput.app`: `index.json` and `bundles/<hash>.yaml` at its root (user, 2026-10-16; the name, user, 2026-10-24).
A core that's never updated fetches from the address it shipped with, so the address has to outlive a move off Pages.

## Fetching

- Each time the core starts, a job fetches `index.json` with the ETag the cache kept from the last answer, and a 304 changes nothing ([log][p01]).
- For each profile whose bundle for this core's `LEVEL` the cache lacks, a job fetches `bundles/<hash>.yaml`.
- A fetch that failed at start is tried again at the next Host or Join, and a pin's fetch that failed is tried again each time this member enters the flight.
- The edge runs each fetch as a job ([timers, jobs, and IDs](../core/01-loop-and-edge.md#timers-jobs-and-ids)), through reqwest 0.13 with rustls, which iroh already brings into the core (read in our network probes' `Cargo.lock`: reqwest 0.13.5, rustls 0.23.45).

FS Copilot's app downloads every profile at once, as one zip from its own server, trying again after 2s, doubling up to 10s, and offers a profile whose publish date on that server is newer than the `# Updated:` date in the pilot's file, for the pilot to download by hand (read in the FS Copilot fork, `FsCopilot/Updater.cs`, `Check` and `Download`; `FsCopilot/Simulation/Definitions.cs`, `UpdatedRx`; and `FsCopilot/ViewModels/MainViewModel.cs`).

## The cache

- The cache is a folder, `profiles/`, in the core's data folder: `index.json`, its ETag, and `bundles/<hash>.yaml`.
- A job writes each file under a temporary name and renames it, so a crash leaves no half-written bundle under a hash.
- The loader keeps a bundle only while its SHA-256 matches its name, and deletes one that doesn't, fetched or cached, and fetches it again.
- At each start with no session file, once the start's fetches finish, the loader deletes each bundle that isn't the one the index gives this core's `LEVEL` for its profile; a start with a session file deletes nothing, since the session may pin an older one.

## The local folder

- The local folder is a setting the loader registers, empty at first, naming a folder of bundle files that the builder or the IDE wrote, one for each profile (user, 2026-10-16).
  It's a development setting, which no app shows, since v1 ships no authoring tool, and the IDE makes it a pilot's setting (user, 2026-10-18).
- The loader lists it at start and whenever it chooses or looks up a bundle, as a job that runs `read` at `LEVEL` on each file and skips, and logs, one that fails, so it never takes a bundle at a level this core can't read.
  A local bundle that covers an aircraft is taken over a published one, as [testing an edit](01-format-and-delivery.md#testing-an-edit) has it.
- A new local bundle takes effect when the session's aircraft next changes before preflight ends, or at the next session, and a crewmate testing with the author puts the same file in their own folder before joining; equal hashes prove they run the same copy.
- The core builds nothing, so the report on a profile's errors is the builder's or the IDE's, and the apps show none.

## The pin

```rust
// a sketch: the message crate's profile-loader module; the number is hypothetical
pub const PIN: Key<Option<Pin>> = Key::new(60, Writer::PilotFlying);

pub struct Pin { pub hash: [u8; 32], pub local: bool }
```

- The PF's loader writes its choice into `PIN` when the session's aircraft changes before preflight ends, as [which bundle a session pins](../session/02-units.md#which-bundle-a-session-pins) has it, and when the key holds none and its choice becomes one, as when the start's fetch finishes after the aircraft was set.
- Its choice is a local bundle that covers the session's aircraft, or else the bundle the cached index gives this core's `LEVEL` for it, when the cache holds that bundle, or else none.
- After preflight ends, the pin changes only from none, as when the PF's fetch finishes after a session that started airborne.
  A following machine asks for a catch-up whenever its profile loads after preflight has ended, so that late pin brings every following cockpit to the flying machine's ([catch-up](../sync/05-units.md#catch-up)).
- Every core looks for the pinned hash in its cache, then in its local folder.
  It fetches a published pin it lacks as soon as the pin names it, and doesn't fetch a local one, since no copy of it is on Pages.

## Loading

- The loaded profile is the pinned bundle, while this member is in the flight ([in the flight](../session/02-units.md#in-the-flight)) and this core holds it.
- Whenever that starts to hold, a job reads the file, runs `read` at `LEVEL` on it, and returns the checked profile encoded with postcard.
- The loop decodes it, finds the variant from this member's aircraft, folder and preset ([the aircraft](../core/03-sim-seam-and-wasm-module.md#the-aircraft)), and raises `ProfileLoaded`.
- A pinned bundle that covers none of this member's aircraft loads nothing until the pin changes, as when the session's aircraft has changed and the PF's loader hasn't yet written the new pin.
- Leaving the flight, a new pin, and the session's end raise `ProfileUnloaded` first, and a job's result for a pin or a flight that no longer holds is dropped, as the code map's [one loop](../architecture/02-code-map.md#one-loop) requires of a job's handler.
- A bundle that fails `read` loads nothing, and the core logs why.

```rust
// a sketch: what a handler reads
let loaded = cx.read::<Profiles>().loaded();   // Option<&Loaded>: its hash, whether it's local, the variant,
                                               // and each block resolved for it
```

State sync's sync engine compiles the write functions from it ([6.9](../architecture/plan.md#69-sync)).

### In the recording

- The job's result is an input, so the recording holds the decoded profile, and a replay decodes it again with no file read ([running a replay](../core/01-loop-and-edge.md#running-a-replay)).
- The loader tells the recording crate nothing, since v1 writes no index of a run (user, 2026-10-23; [recording log][flush]).
- A published bundle stays on Pages under its hash, so only a local bundle's text has to reach us with a run (user, 2026-10-16), and how a run's folder, which a pilot sends by hand, carries it is [left open](#left-open).

## The match check's item

```rust
// a sketch
me.match_item(profile_loader::BUNDLE, ProfileLoader::bundle);
```

Each member's value is one of three (user, 2026-10-18):

| Value | When | Level |
| --- | --- | --- |
| Loaded | This core loaded the pinned bundle, from Pages or from its local folder | None, since two cores' hashes can't differ |
| "No profile for this aircraft" | The pin holds none, since no profile covers the aircraft ([the match check](../session/02-units.md#the-match-check)) | An error, even when every member shows it |
| "Couldn't get the session's profile" | The pin names a bundle this core couldn't fetch, find, or read | An error, even when every member shows it |

- The session shows the pinned hash once, as "unpublished" for a local bundle, since every core loads only the pinned bundle (user, 2026-10-18).
- The value changes on `ProfileLoaded`, on a failed fetch or read, and on a new pin, and the session crate writes this member's `match` key again whenever one of its values changes, so a profile that loads after its member entered the flight shows as loaded.
- The wording, and how a hash shows, are [6.16](../architecture/plan.md#616-the-apps)'s.

## What this changes in 01-format-and-delivery

[01-format-and-delivery](01-format-and-delivery.md) holds what the code map and this design change there.

## Budgets

Each is a starting value:

- **A build:** at most 2s for a profile at one level, in at most 128 MB, on an 8 MB stack; 300 write functions took about 660ms after the compiler's 240ms load, with 57 MB, and passed on a 1 MB stack ([log][p02]).
  CI loads the compiler once, and type-checks a profile at a second level only when its scripts, not its YAML, need the higher one, so 50 profiles of 300 write functions take about 35s (arithmetic), inside CI's [20 minutes](../architecture/02-code-map.md#budgets-for-the-workspace).
- **A load on the loop:** decoding the job's result and resolving the variant stay within a handler's 1ms ([budgets](../architecture/02-code-map.md#budgets)) at the largest bundle we have, which the bench measures.
  Until a profile of ours is larger, that's a bench fixture of 200 KB with 300 write functions, above 1.5 times FS Copilot's largest, below, since ours carry more blocks in a wordier format (user, 2026-10-24).
- **A start with nothing new:** one answer of headers ([log][p01]).
- **A bundle's size:** no cap.
  FS Copilot's largest profile with its modules merged, the iFly 737 MAX8's, is 114,855 bytes, and the median of its 56 is 33,700 (read on disk, FS Copilot fork, `Definitions/`), while ours also carry seats, possibly hundreds on an airliner, so they run larger (user, 2026-10-16).
- **The Pages site:** a site holds at most 1 GB ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)), about 2,000 bundles of a hypothetical 500 KB.
  The FS Copilot fork changed its profiles' files 75 times in 10 months (read in its git history of `Definitions/`, 2025-12-03 to 2026-10-11), and a change to a module publishes every profile that imports it again, so ours run several times that, which still leaves years.

## Cases for the bench

- The PF's start fetch finishes after the session's aircraft is set: the pin goes from none to the bundle, every core in the flight loads it, and the match check shows it loaded.
- Control passes before preflight ends to a pilot whose cache holds an older bundle: the pin stays.
- A member whose cache lacks the pinned bundle fetches it by hash and loads it, and the match check shows it loaded.
- A member offline whose cache lacks the pin shows "Couldn't get the session's profile", loads nothing, and fetches it when it next enters the flight online.
- The PF pins a local bundle: a member with the same file loads it, and one without it fetches nothing and shows the error.
- The session's aircraft changes before preflight ends, and a member enters the new aircraft before the new pin arrives: it loads nothing, then loads the new bundle.
- A member leaves the flight and comes back: the profile unloads, and the same pin loads again, though CI published a newer bundle meanwhile.
- A session starts airborne with the PF's cache empty, and the PF's fetch finishes after preflight ended: the pin goes from none to the bundle.
- A cached bundle whose bytes don't match its name is deleted and fetched again.
- A job's result arrives after this member left the flight, and is dropped.
- A replay of a run with a load decodes the recorded profile, reads no file, and loads the same.

The builder's own tests, which CI runs, take these:

- A bundle written and read back gives the profile it was written from, scripts with blank lines at their ends included.
- The same files built twice, and on two PCs, give the same bytes.
- A profile at a level no release supports isn't published, and is published by the release that brings the level.
- A bundle that fails its level's frozen schema fails CI.
- Two profiles covering one preset fail CI.
- A script using syntax QuickJS-ng can't parse fails the build.
- The `pages` branch only gains files.

## Left open

- How a run's folder, which a pilot sends by hand, carries a local bundle's text (user, 2026-10-21; [recording log][every]).
- Where the apps show the match check's item: [6.16](../architecture/plan.md#616-the-apps).
- Which TypeScript the IDE's editor runs, which may move the builder to TypeScript 7: the IDE's design.
- Test sessions, in which the author's core sends each new bundle to the crew: the IDE's dev loop, as [testing an edit](01-format-and-delivery.md#testing-an-edit) has them.
- Expiring superseded bundles, if the Pages site nears 1 GB, since a pin needs only recent ones.

[p01]: log.md#2026-10-16-github-pages-answers-a-repeat-fetch-of-an-unchanged-file-with-a-304-and-no-body-and-compresses-what-it-sends-when-asked
[p02]: log.md#2026-10-16-typescript-603s-compiler-type-checks-and-compiles-inside-quickjs-ng-as-under-node-in-09s-for-300-write-functions-on-a-1-mb-stack
[p03]: log.md#2026-10-24-the-sandboxs-context-runs-quickjs-ngs-base-objects-past-es2020-without-json-map-set-date-or-promise-and-level-1-types-write-functions-by-exactly-what-it-runs
[every]: ../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour
[flush]: ../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb
