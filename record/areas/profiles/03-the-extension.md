# Profiles: the extension

```text
Purpose:     The profile extension: what a profile's author installs, sees, and does in VS Code, and the language server behind it.
Depends on:  01-format-and-delivery.md, 02-units.md, ../architecture/02-code-map.md, ../build/01-the-build.md, ../interface/decisions.md, log.md
Decides:     What the extension does for an author; the profile language and its highlighting; completion, hovers, checks, navigation, the outline, the formatter, and snippets; how a save builds a bundle into the local folder; the language server and its two runtimes; where each part lives; how the extension is packed, published, and installed; its budgets, known limits, and cases (stage 22d).
```

> **Note**
> Stage 22g adds the extension's features that need the sim, live values on `watch:` lines, Run, the display picker, and the Dual Input panel in the right-hand side bar, which [04-the-extension-in-the-sim](04-the-extension-in-the-sim.md) designs (user, 2026-11-22).
> [Commands and settings](#commands-and-settings) gain "Dual Input: Run entry", "Dual Input: Pick displays", and the setting `dualInput.dataFolder`, empty for `%APPDATA%\DualInput\`, which names a development core's data folder, where `serve` finds its `port.json`.
> In [the extension](#the-extension), the lowest VS Code is 1.106.0, and `@types/vscode` 1.106.0, since the Dual Input panel's view container sits in the secondary side bar, which VS Code takes from an extension from 1.106.0.

The profile extension is a VS Code extension for writing profiles.
It knows the format, shows the profile builder's errors as you type, and builds each profile you save into Dual Input's local folder, so a test session reloads it on every PC in the flight.
It's a thin client in TypeScript of a language server in Rust, `dualinput-profile-builder serve`, which runs the profile engine and TypeScript 6.0.3 inside QuickJS-ng, the code CI builds profiles with, so its checks and its bundles are those of CI at the extension's release ([known limits](#known-limits)).
It's on VS Code's Marketplace for Windows, and each release of Dual Input attaches its `.vsix` too.
The extension stands in for the Dual Input IDE's editor, which is months from usable, so profiles can be written and flown with friends before it ([the product plan's picks](../product/plan.md#3-v1-or-later)).

The user picked its features on 2026-11-21 and designed it with us on 2026-11-21 and 2026-11-22, and the reasons below are the ones that decided each part.

## Installing it

- In VS Code, open the Extensions view, search for "Dual Input", and install "Dual Input Profiles".
  VS Code updates it from then on, as it does every extension from the Marketplace.
- Or download `dualinput-profiles-<version>.vsix` from a release's assets, and install it from Extensions → ⋯ → Install from VSIX…, or with `code --install-extension dualinput-profiles-<version>.vsix`.
- Open a checkout of Dual Input's repository in VS Code, with File → Open Folder.
  The extension acts on the files in `profiles/aircraft/` and `profiles/modules/`, so any checkout that holds `profiles/` works, the sparse one in [profiles in this repository](../architecture/02-code-map.md#profiles-in-this-repository) included.

## The language

VS Code gives every file in `profiles/aircraft/` and `profiles/modules/` a language of the extension's own, "Dual Input Profile", whose ID is `dualinput-profile`, with Dual Input's glyph as its icon in the list of languages, which `tools/icons.ts` draws in the app's sky for dark themes and a darker sky for light ones.
The files keep `.yaml`, since a file's folder already says what it is and picks its schema ([02-units](02-units.md)' note of stage 22c), and a new file suffix would touch every import, the builder, the core's local folder, and CI's publish.

- The extension names the files by two patterns, `**/profiles/aircraft/*.yaml` and `**/profiles/modules/*.yaml`.
  VS Code matches a pattern that holds a `/` against a file's whole path, ignoring case, and takes a pattern's language over the one a file's `.yaml` suffix gives (read in VS Code 1.140.0, `resources/app/out/vs/workbench/workbench.desktop.main.js`, [log][design]).
  So every other YAML file in the repository stays YAML.
- With a language of its own, a profile is left alone by every YAML tool: Prettier doesn't format it and Red Hat's YAML extension doesn't check it, so the extension's formatter is the one that writes it.
- A comment starts with `#`, and with `//` inside a script, so VS Code's Toggle Line Comment writes each in its place.
- Brackets pair and close as you type: `(`, `[`, and `'`.
  A `"` doesn't close itself, since outside a script a profile takes single quotes only ([quotes](#quotes)).

## Highlighting

A name call, such as `L('BKSQ_MixtureLeverPosition_1')`, names something in the sim ([names](01-format-and-delivery.md#names)).
Name calls are what a profile is made of, so they stand out at a glance, in the colors fsc-editor gave them (read in fsc-editor, `src/renderer/src/lib/monaco-theme.ts` and the `--syntax-*` colors in `src/renderer/src/index.css`), and the rest of the colors follow four rules (user, 2026-11-22):

- A key or a variant ID looks the same where it's declared and where it's used: an entry's key under `state:` and after `state.` in a script, and a variant ID under `variants`, in `only`, and as a `location` map's key.
- Green is text an author writes freely, and teal a value the format reads: a number, a pace, one of the format's words, or a variant ID.
- Bold marks what an author navigates by, block and entry keys and section headings, and what Dual Input gives a script.
- In a script, color marks what Dual Input gives the script, the name calls, and JavaScript's syntax, and every variable and function, the script's own and JavaScript's built-ins alike, takes the text color.

| What | Example | Look |
| --- | --- | --- |
| A name call's kind | `L` `A` `B` `K` `H` `instrument` | Violet, bold |
| The name | `BKSQ_MixtureLeverPosition_1` in `L('BKSQ_MixtureLeverPosition_1')` | Amber |
| A name's other arguments | `'Degrees'` in `A('NAV OBS:1', 'Degrees')`, and `2` and `value` in `K('KOHLSMAN_SET', 2, value)` | Muted violet |
| A name call's quotes, brackets, and commas | `'` `(` `,` `)` | Gray, like the YAML's punctuation, so the amber covers the name alone and the violet the kind alone |
| What a script is given | `state`, and `value` outside a name call | Salmon, bold |
| Dual Input's own functions | `write()`, `.repeat()`, `.every()` | Gold, bold |
| A block's key and an entry's key | `state:`, `mixture_1:`, and `battery_1` in `state.battery_1` | Blue, bold |
| A field's key | `watch:`, `variants:` | A softer blue |
| A heading | `# ═══ ELECTRICAL`, `# ── Breakers` | A brighter blue; a section in bold |
| Text an author writes | `Left alternator`, `bksq-aircraft-baronpropress`, a string in a script | Green |
| A value the format reads | `10`, `2 frames` in the YAML and in `.every('2 frames')`, `none`, `pilot_flying`, `true`, and `press` in `variants`, `only`, and a `location` map | Teal |
| A script's keywords | `const`, `if`, `return` | Pink |
| A script's variables and functions, JavaScript's built-ins among them | `steps`, `clamp`, `Math.round` | The text color |
| The YAML's punctuation | `:` `-` `[` `]` | Gray |
| A script's brackets, braces, and operators | `(` `{` `=` `===` `!`, and the `.` in `state.battery_1` | A lighter gray, since in a script they carry the logic, and a missed `!` reverses a line (user, 2026-11-22) |
| A comment | `# Only the seven breakers...` | A darker gray, upright, since the gray alone sets it apart (user, 2026-11-25) |

A grammar of the extension's own, in TextMate's format, paints them, from the moment a file opens.
It finds name calls by their shape, in a YAML value and in a script alike, and hands each script to VS Code's own JavaScript grammar for the rest.
It's a grammar of its own rather than additions to VS Code's YAML grammar, since a profile uses a narrow part of YAML, which [01-format-and-delivery](01-format-and-delivery.md) refuses the rest of, and the grammar names every scope its colors key on.

A grammar matches by spelling, so it can't tell `state` or `write` from a local variable of the same name.
A script can't declare either, since the build fails it with `reserved-name` ([checks](#checks)), so every `state` and `write` in a script is Dual Input's.
`.repeat()` and `.every()` have no such guard, so the grammar colors them gold only in a chain that `write()` starts, on one line or across several, and an array's `.every()` or a string's `.repeat()` keeps JavaScript's look, even inside a chain's brackets (user, 2026-11-22).
The server sends no semantic tokens, since with these rules they'd correct nothing the grammar gets wrong, and a key `state` lacks, as in `state.batery_1`, already gets TypeScript's error after typing pauses (user, 2026-11-22).

Dual Input colors every token in a profile itself, in a dark palette and a light one, so every author sees the same text colors whatever their theme, and only the editor's background stays the theme's (user, 2026-11-22).
Each token, the JavaScript inside scripts among them, takes a scope of ours, and the extension gives every one a color as the default of `editor.tokenColorCustomizations`.
The extension sets that default through `configurationDefaults` in its `package.json`, and VS Code keeps it, since VS Code drops only a default for a setting scoped to the application or marked to refuse one.
VS Code matches a theme-specific key such as `[*Light*]` against the theme's name and nothing else (read in VS Code 1.140.0, `workbench.desktop.main.js`, `isThemeScopeMatch`).
So the dark palette is the default, and the light one goes to every theme whose name holds "Light".
VS Code's bracket pair colorization, which paints brackets gold, violet, and blue by their depth over any token's color, is off for the language the same way, so brackets take the punctuation's gray; VS Code reads that setting for each file by its language (read in VS Code 1.147.0, `workbench.desktop.main.js`, `getCreationOptions`; user, 2026-11-22).
VS Code keeps no extension's defaults for a language between sessions, and a profile it restores at startup keeps its bracket colors until it's reopened (read in VS Code 1.147.0, `workbench.desktop.main.js`, `updateCachedConfigurationDefaultsOverrides`; user, 2026-11-23).
So as it starts, the extension changes each open profile's language to plain text and back, since a language change makes VS Code read the language's settings again (read in VS Code 1.147.0, `workbench.desktop.main.js`, `_onDidChangeLanguage`; user, 2026-11-24).
`experiments/areas/profiles/colors/colors.mjs` shows both palettes on a sample profile, colored through the real grammars, with a picker for each color, for changing them by eye.

A theme's name can mislead, so as it starts and whenever the theme changes, the extension asks VS Code whether the active theme is light, dark, or high contrast, and where that differs from what the defaults give a theme of that name, it writes the right palette under that theme's name in the author's own `editor.tokenColorCustomizations`, with no prompt (user, 2026-11-22).
It touches only rules whose scopes are ours, keeping the author's own rules for that theme, and a write that fails logs to the Output panel.
The setting `dualInput.colors`, `auto` by default, or `dark` or `light`, forces a palette for the active theme the same way, for a theme that declares the wrong kind.

## Completion and hovers

Every list comes from the profile engine's own blocks and levels, so the editor offers exactly what the build takes (user, 2026-11-22):

| Where | What it offers |
| --- | --- |
| A file's top level, or an entry | The keys and fields that aren't there yet, in [Layout](01-format-and-delivery.md#layout)'s order, each with its one-line description; a module offers only what a module takes |
| `owner:`, `status:`, `wrap:` | `pilot_flying` and `shared`; `flawless`, `complete`, `partial`, and `experimental`; `true` and `false` |
| `write:` | `none` and the name calls, then the [snippets](#snippets) for a toggle, a stepping write, and a write function; in an event entry, the write function is the only snippet, since an event entry's write takes no map |
| `only:`, and a `location:` map's keys | The profile's variant IDs |
| `import:` | The modules in `profiles/modules/`, by their paths without `.yaml` |
| A field that takes a name | Only the kinds it takes: a state entry's `watch:` offers no `K()` or `H()`, an event entry's `watch:` no `A()`, and `toggle:` only `K()`, `H()`, and `B()`; each goes in with its quotes and its unit's place, as `A('', '')` |
| `inc:` in a write | `dec:`, `wrap:`, and `range:` with it, which [writing](01-format-and-delivery.md#writing) asks of an editor |
| An event entry's `write:` | The name its `watch:` gives, first, which [event entries](01-format-and-delivery.md#event-entries) asks of an editor |
| A script | TypeScript's completion and signature help: the keys of `state`, the name calls, `write()`, and the chain's methods |

Completing the names themselves and the units they take waits for a database of the sim's names (user, 2026-11-22).

A hover shows:

- on a field, its description and whether it's required;
- on `state.battery_1` in a script, TypeScript's type and the entry's `name:`, such as "Battery 1", which the engine writes as a doc comment on each key of `state` in the program TypeScript checks, so TypeScript shows it as the completion's documentation too, for the item you highlight;
- on a variant ID, the SimObjects folders or presets it covers.

## Checks

| Check | When | Where it shows |
| --- | --- | --- |
| Every check of the engine's but the type check, from [what fails a load](01-format-and-delivery.md#what-fails-a-load) | On each keystroke | The Problems panel and squiggles |
| TypeScript's check of the scripts | 300ms after typing stops | The same |
| The build's report | At each save that builds | The same, and the Output panel |

- Errors and warnings carry the engine's codes, such as `map-form`, and TypeScript's, such as `TS2339`, at the YAML's line and column ([the profile engine](02-units.md#the-profile-engine)).
- Where an error already shows its fix, a quick fix applies it: a bracketed map written out on its own lines, or a double-quoted string in single quotes.
- An error in a module shows in the module, and at the import of each profile it breaks, there with the code `module-errors`.
- A module's scripts are checked in the program of each profile that imports it, whose `state` keys differ, with the errors of all of them shown together, and a module that nothing imports is checked against its own entries alone.
- A script that declares one of the names Dual Input gives every script, `state`, `write`, `L`, `A`, `B`, `K`, or `H`, as a variable, a parameter, a function, a class, or a name taken apart from an object, fails the build with the error `reserved-name`, at the declaration (user, 2026-11-22).
  Its message gives the rule and what the name is, as "A script can't declare `state`, which holds the profile's entries", and for the letters, "A script can't declare `K`, which names a `K:` event".
  `value` stays free, since level 1's declarations make it the marker for where a `K()` event takes the written value, and every write function names its own parameter `value`, which means the same value.
  The build walks each script's syntax tree as it type-checks, so the check runs wherever TypeScript's does, in CI and in the extension, and the 58P's scripts declare none of the seven (read in `profiles/aircraft/bksq-baronpro.yaml`).

## Navigation

- Go to Definition goes from `state.battery_1` to its entry, from an import to its module's file, and from a variant ID to its line under `variants`.
- Find All References on an entry lists every script that reads its `state.<key>`.
- Rename on an entry's key renames every `state.<key>` that reads it, across the profile and the modules it imports, and across every profile that imports a module whose entry is renamed.
- Go to Symbol in Workspace (Ctrl+T) finds an entry by its name across every profile and module.

## The outline

The server gives VS Code each file's symbols and folding ranges, from which VS Code draws the Outline view, the breadcrumbs above the editor, sticky scroll, which pins the current section's heading at the top as you scroll its entries, and Go to Symbol (Ctrl+Shift+O).

- The tree holds `aircraft`, with its variants; `state` and `events`, each holding its sections, each section its subsections, and each its entries; and `seats`, each seat by its `name:`.
  Other top-level keys, such as `maker:`, stay out.
- A section, `# ═══ ELECTRICAL`, holds the entries below it until the next section, and a subsection, `# ── Breakers`, the entries below it until the next heading; entries before a block's first heading sit under the block.
- An entry shows its `name:`, such as "Left mixture", with its key, `mixture_1`, beside it, so the outline reads as the cockpit does.
  A state entry takes VS Code's field icon, and an event entry its event icon.
- A heading folds down to the next heading at its level or above, and each block, entry, and `write: |` script folds by its indentation.

## Formatting

The formatter writes [Layout](01-format-and-delivery.md#layout), with the changes to it in [01-format-and-delivery](01-format-and-delivery.md)'s notes of stage 22d and of 2026-11-23.
It runs on Format Document (Shift+Alt+F), and at each save before the save's build, since the extension turns on VS Code's `editor.formatOnSave` for its language alone.
The extension also names itself the language's `editor.defaultFormatter`, since with a second formatter such as Prettier offered for a profile and neither set as the default, VS Code formatted nothing on save (user, 2026-11-23).

- It puts the top-level keys in Layout's order, each with the comments above it, and an entry's fields in their table's order; indents 2 spaces; writes a bracketed map out on its own lines, from the entries its line holds, since YAML's own reading splits one at its commas; and writes a list of numbers or variant IDs on one line, in brackets, and every other list, of names, folders, imports, or displays, one item to a line.
- Outside scripts, it writes a value plain where YAML reads it as the same text, and in single quotes where it doesn't: `name: 'Left mixture'` becomes `name: Left mixture`, while `name: 'Radio: COM1'` keeps its quotes, since a colon and a space would start a map.
- It writes each heading in Layout's form, fsc-editor's forms among them, with its rule running on to column 100, as in `# ═══ ELECTRICAL ═══…`, so a section shows as a line across the file in any editor, as fsc-editor's did to 78 columns (user, 2026-11-22), and it reflows comments, as [comments](#comments) gives.
- It lays out each script's JavaScript, as [scripts](#scripts) gives.
- It never changes the order of entries, which is the author's and the bundle's, or the words of a comment.
- A file that doesn't parse as YAML gets no edits, and its errors show.

Pressing Enter puts the caret where the formatter would put the next line, from the same code (user, 2026-11-22): 2 spaces in under `state:`, 4 under an entry's key, under the field after a field, and 2 deeper than `write:` after `write: |`.
Inside a script, a new line keeps the indent of the line above, goes 2 deeper after a line that ends in `{`, `(`, or `=>`, and a `}` typed at its start moves back 2.
The server does it through LSP's formatting as you type, on Enter and on `}`, which VS Code runs only with `editor.formatOnType` on, so the extension turns that on for its language, with `editor.tabSize` at 2 and `editor.insertSpaces`, beside `editor.formatOnSave`.

### Comments

The formatter reflows each paragraph of a comment to 100 columns, joining short lines and breaking long ones at a space, since a comment edited by hand comes out ragged (user, 2026-11-22).
The 58P's comments wrap near there, the longest of its 28 comment lines at 98 characters and 17 at 90 to 99 (read in `profiles/aircraft/bksq-baronpro.yaml`), and its first format rewraps each of their paragraphs once, since a fill to 100 columns joins words those lines broke before.

A formatter can't tell a break you meant from one you didn't, so a line holding only `#` ends a paragraph, as a blank line does in Markdown.
A list item, starting `- `, `* `, or `1. `, starts a line of its own, and its text reflows under its first word, so a line under it indented to that word continues it.
These keep their lines, neither joined nor broken:

- a heading;
- a line with more than one space after its `#` that doesn't continue a list item, as a diagram has;
- a line with two spaces in a row inside its text, as an aligned table has;
- a line whose text starts with an entry's key or a field and a colon, such as `# watch: L('X')`, which is an entry set aside rather than prose, where a sentence such as `# A known limit: as` starts with a capital and goes on reflowing;
- a comment after a value on the same line.

### Scripts

The formatter lays out each script's JavaScript with dprint-plugin-typescript 0.101.0, Deno's code formatter as a Rust library, since a script edited by hand comes out as ragged as a comment, and CI's `format --check` then holds every author's scripts to one layout, as it holds the rest of a profile (user, 2026-11-23).
The layout is the one the 58P's scripts were written in: 2 spaces to a level, single quotes but for a string that holds more single quotes than double, no semicolons, and lines broken to fit 100 columns, their indent included.
Run on the 58P's profile, dprint left 17 of its 18 scripts as they were, and broke the 18th's one line of 108 columns, `const vsHold = …`, into three (measured with `dualinput-profile-builder format`, 2026-11-23).
It took the builder from 13.4 MB to 17.8 MB, and the `.vsix` from 4.2 MB to 6.0 MB (measured on our development machine, 2026-11-23, a release build).

- A script on the `write:` line goes into a `|` block below it, since [Layout](01-format-and-delivery.md#layout) writes every script as one.
  A value YAML reads as a boolean, a number, or null, as `write: true`, stays on the line, since it's no script, and the engine's checks report it.
  A script written plain over two lines or more, as `write: (value) =>` with the rest on the lines below, keeps its lines, since the formatter moves only a script that the `write:` line holds whole.
- A script that doesn't parse, as while you're typing it, keeps its lines, and TypeScript's check shows why.
- A folded block, `>`, keeps its lines and its `>`, since YAML reads each of its line breaks as a space, except before a more-indented line, so a break dprint added, removed, or indented would change the text the script runs as.
- dprint runs in `profile-language`, in Rust, so formatting a script waits on neither of TypeScript's runtimes, and `cargo test` covers it.

### Quotes

Outside a script, a profile takes single quotes only: a double-quoted string in a YAML value, or in a name call on a YAML line, fails the build, with an error that shows it in single quotes (user, 2026-11-22).
Single quotes hold anything a profile writes there: in YAML, `''` stands for a quote inside one, double quotes exist for escapes such as `\n` that no profile needs, and a name that holds a `'` writes it as `\'`, as JavaScript does and the engine reads (read in `src/engines/profile-engine/src/names.rs`).
A script takes any string JavaScript takes, so `"'"` is written as it reads.
The formatter rewrites double quotes outside scripts as it saves, and the 58P's profile has none outside its comments.
The rule holds the files an author writes, and not a bundle, which the builder writes and reads back ([the builder](02-units.md#the-builder)): a bundle keeps its double quotes where YAML needs quotes, as in `"true"`, since a text with a line break, which a profile writes as a `|` block, has no single-quoted form.
The formatter and the bundle writer ask one test of the engine's whether a value can go plain, and differ only in the quote each writes where it can't.

## Snippets

The server offers each snippet as a completion only where it fits, such as a state entry inside `state:`, where a snippet file of VS Code's would offer every one everywhere (user, 2026-11-22).
The three forms of a write come on `write:` itself, after the names, since an author who types the field and one who picks it from the list both end with the caret there (user, 2026-11-23).
So an entry's list of fields holds `write` once, rather than `write` beside three snippets that each write it too.
Each starts with the caret on its first blank, which is the entry's key where it has one, and Tab moves to the next blank.
Each writes its fields in their table's order, as the formatter would, so a counted entry's `default:` comes after its `write:`.

| Snippet | What it writes |
| --- | --- |
| A new profile | In an empty file in `profiles/aircraft/`: `maker`, `name`, `status`, `authors`, `aircraft` with one variant, and one state entry with blanks, since the checker refuses an empty `state:` |
| A new module | In an empty file in `profiles/modules/`: `authors`, and one state entry with blanks |
| A state entry | Its key, `name`, `watch: L('')`, and a `write:` that takes the same name as you type the watch's |
| A watch-only entry | The same, with `write: none` |
| A toggle | After `write:`, `toggle: K('')` on the line below it |
| A stepping write | After `write:`, `inc:`, `dec:`, `wrap:`, and `range:` on the lines below it; in a counted entry, `inc:` and `dec:` alone, since its write steps by the `wrap:` and `range:` its `watch:` gives |
| A counted entry | A counting `watch:` with `inc:`, `dec:`, `wrap:`, and `range:`, a stepping `write:`, and `default:` |
| A write function | After `write:`, `\|`, with `(value) => {` and `write(L(''), value)` inside |
| An event entry | Its key, `name`, `watch: K('')`, and a `write:` with the same name |
| A heading | `# ═══ ` for a section, or `# ── ` for a subsection, at the entries' indent |
| A seat | `name`, `hip`, `knees`, `feet`, and `eye`, with zeros to tune |
| A variant | A short ID and its SimObjects folder, inside `aircraft:`'s `variants:` |

## Building on save

| | What happens |
| --- | --- |
| What builds | A save you make, with Ctrl+S or File → Save, of a profile in `profiles/aircraft/` |
| A module's save | Builds each profile that imports the module, for its errors, and writes the bundles only of those the local folder holds already, so a module's save never makes a bundle for a profile nobody is testing |
| What a build reads | The files as they're saved, never a change still unsaved in another tab, so a bundle is the one `dualinput-profile-builder build` gives from the same files |
| What it writes | Only a bundle that built with no error, by the four steps of [writing a bundle there](02-units.md#writing-a-bundle-there): into the local folder, named for the profile's file, through a `.new` file renamed over it |
| Where | `%APPDATA%\DualInput\profiles\local\`, or the folder the `dualInput.localFolder` setting names, such as a development core's `profiles.local` |
| A save that fails | Writes nothing, so the crew keeps flying the last bundle that built, and the errors show |
| A save that changes nothing | Writes the same bytes, which move no pin, since the core compares hashes |

A save VS Code makes on its own, after a delay or as the focus moves, builds nothing, since with `files.autoSave` on, every pause in typing would reload the crew's cockpits.
Ctrl+S still builds with autosave on, since VS Code marks that save as a manual one (read in VS Code 1.140.0, `workbench.desktop.main.js`).
The user settled each of these on 2026-11-21 and 2026-11-22.

The status bar shows the profile in the active editor:

- with a bundle in the local folder from a save that built: "Dual Input 1a2b3c4", the bundle's first 7 hex digits, with the time it was built in its tooltip;
- after a save that failed, with an older bundle still in the folder: "Dual Input 1a2b3c4 · 2 errors", since the crew still flies that bundle, and the hash is what the author matches against the EFB app;
- after a save that failed, with no bundle in the folder: "Dual Input: not built · 2 errors";
- with no bundle in the folder and no build yet: nothing.

In a module, it shows the profiles its last save built, each with its short hash.

A bundle left behind in the local folder matters at a session's start: a core pins its own local bundle when it's the PF's, the pilot flying's, so a bundle from Monday's test is what your crew flies on Friday whenever you're the PF, and the EFB app's session card shows its short hash and your name ([the pin](02-units.md#the-pin)).
A bundle in a crewmate's folder from before the session goes to nobody, since a core offers only a bundle that's new while the session is held ([test sessions](02-units.md#test-sessions)).
"Dual Input: Remove local bundle" deletes it, which moves no pin in a session already held, so remove it before you host.

In a test session, your save reaches the crew like this ([test sessions](02-units.md#test-sessions)):

1. In Dual Input, host or join a session in an aircraft your profile covers.
2. In VS Code, change the profile, and save it with Ctrl+S.
   The status bar shows the new bundle's short hash, such as "Dual Input 1a2b3c4".
3. Watch the EFB app's session card.
   It shows the same 7 digits, and each crew row shows them once that PC has loaded the bundle.

Within 1s, your core finds the bundle in the local folder and offers it to the PF's core, which pins it without anyone acting, and every PC in the flight reloads it.
From the save to a synced cockpit takes up to 2s for the build and about 3s more for the reload ([test sessions](02-units.md#test-sessions)).

### Commands and settings

| Command | Does |
| --- | --- |
| Dual Input: Build now | Saves the file, then builds as a save you make does, for when building on save is off |
| Dual Input: Remove local bundle | Deletes this profile's bundle from the local folder; in a module, asks which importing profile's |
| Dual Input: Open local folder | Shows the local folder in File Explorer |
| Dual Input: Restart language server | Starts the server again |

| Setting | Default | Does |
| --- | --- | --- |
| `dualInput.buildOnSave` | On | Builds each save you make, for an author who edits only for a pull request and never tests in Dual Input when off |
| `dualInput.localFolder` | Empty, for `%APPDATA%\DualInput\profiles\local\` | The folder bundles go into |
| `dualInput.trace.server` | Off | Logs every message between the extension and the server, for debugging |
| `dualInput.colors` | `auto` | Forces the dark or light palette for the active theme, for a theme that declares the wrong kind |

The Output view's "Dual Input Profiles" panel holds the server's log and each build's report.

## How it works

| Part | Where | What it holds |
| --- | --- | --- |
| `profile-language` | `src/engines/profile-language`, an engine on the engines' top line beside `profile-build` | The editor's features over `profile-engine`: symbols, folding, completion, hovers, definitions, references, renames, snippets, the formatter, and indentation as you type; it reads no file and runs no TypeScript, so `cargo test` covers it whole |
| The language server | `serve`, a command of `tools/profile-builder`'s `dualinput-profile-builder` | The Language Server Protocol over stdin and stdout, the open documents, TypeScript's language service, and building on save |
| The extension | `src/apps/profile-extension`, in TypeScript | Starting the server, the status bar, the commands, the settings, the grammar, and the Output panel |
| The packer | `tools/lib/vsix.ts` | Writing the `.vsix` |

The builder stays in `tools/`, since `tools/` holds what builds Dual Input's parts and the builder builds profiles, and nothing bars a tool from shipping (user, 2026-11-22).
The extension sits in `src/apps/`, where the code map puts the IDE it stands in for, and the root `Cargo.toml` lists it in `exclude`, as `src/apps/desktop` is, since `src/apps/*` would take it for a crate.
The server owns building on save and the local folder, and the extension holds only what VS Code alone draws, so another editor would need only a client of its own and its highlighting (user, 2026-11-22).

### The language server

- It speaks LSP through `lsp-server` 0.10.0, the crate rust-analyzer's repository publishes for its own server, which runs the protocol on threads and channels, and `lsp-types` 0.97.0, the protocol's types (read on crates.io, 2026-11-22); that `lsp-server` needs no async runtime is the stage's to confirm as it builds.
- It keeps the text of each open document, and for its checks hands the engine a module's text from its open editor, or else from disk, through the engine's `Files` ([the profile engine](02-units.md#the-profile-engine)); a build reads every file from disk.
- It reads every profile in the workspace's `profiles/aircraft/` as it starts, and again whenever the extension reports, through LSP's watched files, that one changed on disk, so it knows which profiles import each module, which a module's save, Rename, Find All References, and workspace symbols need.
- It maps a position in a script to the TypeScript program the engine writes for the profile, and back, with the places the engine keeps for TypeScript's errors ([the profile engine](02-units.md#the-profile-engine)).
- It asks TypeScript for a completion's details only for the item you highlight, through LSP's completion resolve, since the details of all 183 of the 58P's keys took 410ms, where the list took 5.5ms and one item's details 2.5ms (measured on our development machine, 2026-11-22, a release build).
- It builds on a save through `profile-build`'s `build`, the function `dualinput-profile-builder build` runs, so the bytes it writes are those CI would build from the same files with the same builder.
  It takes each save's reason from LSP's `textDocument/willSave`, and builds on the `didSave` that follows a save whose reason is a manual one.
- It runs "Build now" and "Remove local bundle" as LSP commands, `dualInput.build` and `dualInput.removeLocalBundle`, names a module's importers with `dualInput.importers`, and gives the local folder's path, for "Open local folder", with `dualInput.localFolder`; reads its settings from the editor's configuration; and tells the editor each build's result in a notification of its own, `dualInput/build`, with the profile's file, the saved file that set the build off, the bundle's hash and path, its count of errors, and when it was built, sending one at start for each bundle the local folder holds already.

### TypeScript in two runtimes

TypeScript 6.0.3's language service runs inside the server's QuickJS-ng, rather than in the extension's Node, so every language feature lives in one program, TypeScript ships once in the `.vsix`, and the IDE can use the server as it is (user, 2026-11-22).
In QuickJS-ng, completion after `state.` on the 58P took a median of 42.5ms, where Node took 3.0ms, and signature help and a hover took 35.9ms and 34.8ms there ([log][p04]).

The server holds two runtimes, each with `typescript.js` loaded, so no request waits behind a check or a build (user, 2026-11-22):

- On the server's main thread, one answers completion, signature help, and hovers inside scripts; `profile-language` finds references and renames by the text of `state.<key>`.
- On a thread of its own, the other checks the scripts 300ms after typing stops, and runs each save's build.
  It checks a profile's scripts only once the engine's own checks pass, as the build does, so an entry the engine refused doesn't bury its reads in TypeScript's errors.
  A check runs to its end, and shows its errors only if the text hasn't changed since it began, after which the newest text is checked.
  Stopping a check partway would cost more than it saves, since TypeScript drops its whole type checker when a check is canceled, and the next check builds it again (read in `node_modules/typescript-6/lib/typescript.js`, `runWithCancellationToken`).

QuickJS-ng has no `Intl`, and TypeScript sorts completions with `Intl.Collator`, so each runtime gets a stand-in that compares by code unit ([log][p04]).
VS Code puts completions in its own order, by each one's sort text, so the stand-in's order never reaches the author.
One runtime took 243ms to load and held 43 MB once it had answered the 58P's requests ([log][p04]); two, loading side by side on their threads, are the stage's to measure.

### The extension

- It's TypeScript, checked by the root's TypeScript against `@types/vscode` 1.91.0, the lowest VS Code that `engines.vscode` takes in the `package.json` of `vscode-languageclient` 11.0.1, Microsoft's client for language servers (read on npm, 2026-11-22).
- It gives its language itself as `editor.defaultFormatter`, VS Code's `editor.formatOnSave` and `editor.formatOnType`, `editor.tabSize` at 2, `editor.insertSpaces`, `editor.rulers` at 100, the column [comments](#comments) reflow to, in a gray at 15% opacity that stays faint on a dark theme and a light one alike (user, 2026-11-25), and `editor.bracketPairColorization.enabled` off, as defaults for that language alone.
- esbuild bundles it into one CommonJS file, with `vscode` left out as VS Code's guide to bundling has it ([bundling extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)), so the `.vsix` carries no `node_modules`.
- Its manifest, `src/apps/profile-extension/package.json`, names no npm dependencies and isn't an npm workspace; the root's `package.json` holds `vscode-languageclient` and `@types/vscode`.
- Its parts that don't import `vscode`, such as the status bar's text from a build's result, have tests that `node --test` runs, as `tools/check.ts` runs every `*.test.ts`; what only VS Code shows is checked by hand at the stage's close.
- Its identity is `dual-input.dualinput-profiles`, in the lowercase form [writing.md](../../../.claude/rules/writing.md#voice) gives a name that can't hold a space, its display name "Dual Input Profiles", and its icon the glyph `tools/icons.ts` draws, at 128px.

### Packing and publishing

- `node tools/build.ts extension` builds the builder with Cargo's release profile, bundles the extension, and packs both, with the grammar and the icon, into `target/profile-extension/dualinput-profiles-<version>.vsix`; `node tools/build.ts release` packs it too.
  The version is Dual Input's own, from the root `Cargo.toml`'s `[workspace.package]`, written into the packed manifest, so the extension's version names the level it builds at.
- `tools/lib/vsix.ts` writes the `.vsix` as a zip with Node's own deflate and CRC-32, with no dependency.
  VS Code's installer reads only `extension/package.json` from one, and vsce 1.0.0, of 2015-12-16, and 4.1.1, of 2026-11-16, write the same manifest around it, so the format has held for ten years ([log][design]).
  It writes that manifest too, for the Marketplace, with `TargetPlatform` as `win32-x64`, since from VS Code 1.61.0 "VS Code looks for the extension package that matches the current platform" (documented, [publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)).
  vsce itself would add 135 packages to every `npm ci`, CI's included ([log][design]).
- The release workflow's build job keeps the `.vsix` in its artifact, and its publish job attaches it to the draft beside the installer, and once the release is published, a job of its own publishes it on the Marketplace with `vsce publish --packagePath` (documented, [publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)), run through `npx` at a pinned version in that job alone ([a release](../build/01-the-build.md#a-release)).
- vsce signs in through the Marketplace's Trusted Publishing, `vsce publish --oidc`: it trades the job's GitHub OIDC token for a Marketplace credential, which a policy on the publisher grants to `release.yml` in this repository, so the repository holds no secret for it (documented, [publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), [vsce's README](https://github.com/microsoft/vscode-vsce)).
  A personal access token would have been the other way, and Azure DevOps retires those on 2026-12-01 (same page; user, 2026-11-22).
- The Marketplace's publisher is `dual-input`, with that policy naming the repository owner `dual-input`, the repository `dualinput`, and the workflow `release.yml`.

## Budgets

Each is a starting value:

- **A request inside a script:** completion, signature help, or a hover, at most 100ms at p95 on the 58P; p04 measured 57.8ms, 55.6ms, and 61.0ms in QuickJS-ng ([log][p04]).
- **The engine's checks on a keystroke:** at most 20ms on the 58P, which the stage measures.
- **A build on save:** the builder's 2s ([budgets](02-units.md#budgets)), on the server's second thread.
- **The server's start:** ready to answer within 1s, with its two runtimes loading side by side, which p04, with one runtime, didn't measure.

## Known limits

- The extension runs on Windows only, since the builder inside it is a Windows program, as Dual Input is.
- VS Code updates the extension as soon as a release is out, and Dual Input updates itself only when the sim closes (user, 2026-11-22).
  In between, a profile that uses a field only the new release takes builds at the new level, and the author's own core skips that bundle and logs it until Dual Input updates.
- The extension checks and builds with the engine of its own release, while CI checks a pull request with the engine at the pull request's commit.
  So after `main` changes the format, a profile the released extension passed can fail CI, and one using a block `main` gained shows that block as unknown in the editor; a developer working on the format installs the `.vsix` that `node tools/build.ts extension` builds from their own tree.
- A name's own text, and its unit, complete only once a database of the sim's names exists.
- A light theme whose name doesn't hold "Light", such as Catppuccin Latte, shows the dark palette the first time a profile opens in it, until the extension writes the light one under its name; and an author's own top-level `textMateRules` in `editor.tokenColorCustomizations` replace the extension's colors, since VS Code merges no list (read in VS Code 1.140.0).

## Cases

As `profile-language`'s own tests:

- The 58P's profile gives its sections, subsections, and entries as symbols, each entry by its `name:` with its key beside it, and a fold for each heading.
- The formatter writes every rule of Layout on a fixture that breaks each one, writes the 58P's profile as it stands, and changes nothing on a second run.
- The formatter lays out a script out of layout, leaves one that doesn't parse as it was typed, and moves a script on the `write:` line into a block, every line within 100 columns.
- Comments: a paragraph reflows to 100 columns, and a heading's rule runs on to it; a line holding only `#` ends a paragraph; a list item reflows under its first word, its indented lines with it; and a heading, a line with more than one space after `#` outside a list item, a line with two spaces inside its text, a line starting with a key and a colon, and a comment after a value each keep their lines, while the 58P's `# A known limit: as` reflows.
- Quotes: a double-quoted value or name call outside a script is rewritten in single quotes, a name holding `'` is written with `\'`, and a script's `"'"` is left alone.
- A module's scripts are checked in each importing profile's program, and a module nothing imports against its own entries.
- A file that doesn't parse gets no edits.
- Completion offers, at each place in [completion and hovers](#completion-and-hovers), what that table gives, and nothing a level's checker refuses there.
- Go to Definition, Find All References, and Rename reach across a profile and a module it imports.
- Pressing Enter after each line [formatting](#formatting) names indents as given.

As the language server's own tests, through `lsp-server`'s connection in memory:

- A manual save builds the profile and writes its bundle under the profile's name through a `.new` file; a save after a delay or on a change of focus builds nothing.
- A save of a module builds each profile that imports it, and writes only the bundles of those the local folder held already.
- A build reads the files as saved, though a module open in the editor has changes not yet saved.
- A save with an error writes nothing, and `dualInput/build` reports the count.
- With `dualInput.buildOnSave` off, a save builds nothing and "Build now" saves and builds; with `dualInput.localFolder` set, the bundle goes there.
- "Remove local bundle" deletes the bundle.
- Completion inside a script answers from TypeScript, with the stand-in for `Intl`, and its detail on a key of `state` gives the entry's `name:`.
- A TypeScript error shows after a pause in changes, and a check of text that changed while it ran shows nothing, and the check of the newest text follows.
- A new profile written by its snippet, with its blanks filled, builds.

As the extension's own tests, through `node --test`:

- The status bar's text for each of its four states, and in a module.
- Run through `vscode-textmate` and `vscode-oniguruma`, the libraries VS Code highlights with, lines from the 58P's profile and from scripts give each look in [highlighting](#highlighting)'s table its scope.
  In each palette, every character takes one of the palette's colors over a theme with a rule for each scope, a key and a variant ID keep one look wherever they're declared and used, a pace and the format's words look like a number, and a name call's kind, name, arguments, and punctuation each look different.
  The root's `package.json` holds the two libraries for these tests alone.

As the engine's and the builder's tests:

- A double-quoted value or name call outside a script fails the build with its single-quoted form in the error.
- A script that declares each of `state`, `write`, `L`, `A`, `B`, `K`, and `H`, as a variable, a parameter, a function, and a name taken apart from an object, fails with `reserved-name` at the YAML's line and column, and a write function whose parameter is `value` builds.
- A bundle's keys put `seats` last, and a bundle whose values hold double quotes, as `"true"`, reads back with no error.
- `dualinput-profile-builder format --check` passes on `profiles/` and fails on a fixture out of layout.

By hand, at the stage's close:

- The `.vsix` that `node tools/build.ts extension` writes installs in VS Code, and each feature above works once on the 58P's profile.
- A manual save writes into the local folder a bundle whose hash is the one `dualinput-profile-builder build` gives for the same file.

## Left open

- A client for Zed, and whether the IDE builds on Zed, which the user decides once the IDE's design starts (user, 2026-11-22).
  As of 2026-11-22, Zed runs a language server as VS Code does; highlights with Tree-sitter rather than TextMate; takes semantic tokens when its `semantic_tokens` setting is `"combined"` or `"full"`, and not at its default, `"off"`; matches an extension's language by a file's suffix or its first line, and by a glob only in the user's own `file_types` setting; and its docs describe no panel, status bar item, or webview an extension can add ([log][design]).

## What this changes elsewhere

- [01-format-and-delivery](01-format-and-delivery.md)'s Layout puts `seats` last, takes single quotes outside scripts, and reflows comments, in its note of stage 22d, and lays out scripts, in its note of 2026-11-23.
- [02-units](02-units.md)' builder gains `serve` and `format`, and a bundle puts `seats` last, in its note of stage 22d.
- [The build](../build/01-the-build.md) ships the extension, in its note of stage 22d.
- [The code map](../architecture/02-code-map.md) gains `profile-language` and `profile-extension`, in its note of 2026-11-22.
- The architecture's tentative decision on [authoring tools](../architecture/decisions.md#v1-ships-the-profile-extension-with-the-profile-builder-inside-it-and-the-profile-author-tool-runs-from-the-repository) changes in place.

[p04]: log.md#2026-11-22-typescripts-language-service-answers-in-about-40ms-in-quickjs-ng-on-the-58ps-write-functions-against-3ms-in-node-once-quickjs-ng-has-a-stand-in-for-intl
[design]: log.md#2026-11-22-the-profile-extensions-design-finds-what-vs-code-reads-of-a-vsix-and-a-language-what-vsce-costs-and-what-zed-allows-and-the-format-puts-seats-last-and-takes-single-quotes
