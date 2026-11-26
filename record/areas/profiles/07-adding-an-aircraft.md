# Profiles: adding an aircraft

```text
Purpose:     The profile extension's way to add the loaded aircraft to a profile's `variants`, by the path the core matches it on.
Depends on:  01-format-and-delivery.md, 03-the-extension.md, 04-the-extension-in-the-sim.md, ../core/03-sim-seam-and-wasm-module.md
Decides:     When the lens shows; what its island shows and offers; what Add writes; the status line for an aircraft no profile covers; the close button on every tool island's title; and the known limits and cases (stage 22j).
```

While an aircraft is loaded, a lens above `variants:` reads "Add" and the aircraft's title, and opens an island in the Dual Input panel.
The island shows the aircraft's folder and preset as the core matches them, says what in the profile covers the aircraft now and what that means, and offers its preset or its whole folder, into a new variant or an existing one.
Add writes the line into `variants:`.

The user asked on 2026-11-26 for an easy way to an aircraft's folder and preset names while writing a profile, after a profile whose `g1000` names the G1000's folder loaded `g1000` on the G1000 Skis too, with nothing in the editor saying so ([aircraft log](../aircraft/log.md#2026-11-26-the-cessna-172s-19-presets-sit-in-two-folders-the-ifds-inside-the-classics-and-its-floats-skis-and-banner-presets-each-add-cockpit-controls-of-their-own)).
A first design listed every variation from the sim's own aircraft list, but that list named a preset's path for only 3 of 8 aircraft ([profiles log](log.md#2026-11-26-the-sims-aircraft-store-lists-an-aircrafts-variations-with-their-folders-but-names-a-presets-path-for-only-3-of-8-aircraft-so-adding-an-aircraft-takes-its-path-from-a-load)).
So this design takes only what the core matches on, and an author adds each preset that needs a variant of its own by loading it, as they load it anyway to test its sync (user, 2026-11-26).

## What the core matches on

The core matches a profile to an aircraft by one thing: the path the sim reports when the aircraft loads, cut below `SimObjects\Airplanes\` and lowercased, such as `asobo_c172sp_g1000/presets/asobo/c172sp_avionics_passengers_skis` ([the aircraft and its variants](01-format-and-delivery.md#the-aircraft-and-its-variants)).
Its first part is the folder, and the whole path is the preset; an aircraft built the MSFS 2020 way, such as the Black Square Baron 58P, reports its folder alone.
A variant naming the preset beats one naming its folder.
`authoring`'s slice already carries the path, in a session and out of one.

The aircraft's `A:TITLE`, which the sim service reads at each load ([the aircraft](../core/03-sim-seam-and-wasm-module.md#the-aircraft)), names the aircraft for a person, as "C172SP G1000 Passengers Skis", and plays no part in a match.

## The lens

- "Add" and the aircraft's `A:TITLE`, as "Add C172SP G1000 Passengers Skis", with VS Code's add icon, sits above `variants:`, or above `aircraft:` in a profile with no `variants:` yet, in any profile under `profiles/aircraft/` while an aircraft is loaded in a flight, with a session or without one (user, 2026-11-26).
- At the world map it doesn't show, since the core still holds the aircraft of the flight before.
- It doesn't show when the profile already names the aircraft's own path, its preset's or, for an aircraft that reports its folder alone, its folder, since there's nothing to add for it (user, 2026-11-26).
- "Dual Input: Add this aircraft" opens the island in the active profile from the command palette, as a profile with no `aircraft:` yet needs, and Add writes `aircraft:` and `variants:` too.
- Run, live values, and the display picker still work only in the session's flight, in an aircraft the profile covers ([in a session](04-the-extension-in-the-sim.md#in-a-session)), since they read and write the cockpit; adding an aircraft reads only its path.
- A module has no `aircraft:`, so it has no lens, and the command palette's "Add this aircraft" refuses it.
- The island shows only in the VS Code window the core's `authoring` serves, as the lens does, since Add reads the aircraft from that window's slice.

## The island

It opens in Run's place, as the display picker does, under a title with a plane, since its lens's add icon would read as a button beside the title's close button (user, 2026-11-26).
With the C172 G1000 Skis loaded in a profile whose `g1000` names `asobo_c172sp_g1000`, it's drafted as:

```text
ADD THIS AIRCRAFT                                                    ✕
C172SP G1000 Passengers Skis

  The variant g1000 already covers this aircraft through its folder
  asobo_c172sp_g1000.

(•) This preset only
    asobo_c172sp_g1000/presets/asobo/c172sp_avionics_passengers_skis
    This aircraft alone, for entries of its own, such as a lever only it has.
 ✓  Its whole folder
    asobo_c172sp_g1000
    In the profile already, as g1000.

[ passengers_skis              ]  [ + Add ]
Goes in a new variant, passengers_skis.
```

Its words and layout are a draft, which the panel's dev page settles by eye with the user, as the panel's other islands were.

- **The aircraft:** its `A:TITLE` alone, since each choice shows its path (user, 2026-11-26).
- **What covers it now, and why add more:** the island's job is to say that a folder covers every aircraft in it, and that a preset names one aircraft of its folder and wins over the folder, so an author knows why they'd give a preset a variant of its own (user, 2026-11-26).
  A box names, in one line, the variant that already covers the aircraft through its folder, and the preset's choice says what a preset of its own is for, since an author needs telling only once (user, 2026-11-26).
  When nothing covers the aircraft, there's no box, since the choices say all there is and the status line already says no profile covers it.
- **What to add:** this preset, or its whole folder, each with its path and a line on when to pick it.
  A choice whose path a variant already names is no choice: a tick in place of its circle, and "In the profile already, as" that variant (user, 2026-11-26).
  An aircraft that reports its folder alone offers only the folder.
- **The variant:** one field, with no switch between a new variant and an existing one (user, 2026-11-26).
  An ID that isn't one of the profile's makes a new variant, and one that is joins it, beside the paths it has, rather than replacing them, so no path goes without the author seeing it go.
  A line under the field says which, and says when the variant already covers the aircraft through its folder, as `g1000` does its preset, where Add would change nothing.
  An ID starts with a letter or `_`, then takes letters, digits, `_`, and `-`, as the format's grammar reads one, and the line says so of an ID that doesn't.
  The field starts with a suggestion the author can change, always lowercase and joined with `_`, so IDs read alike across profiles.
  For a preset, it's the words of its `A:TITLE` that its folder's name doesn't hold, separators and case aside: a word goes when all of it lies in a run of 3 or more characters that the folder's name also holds, so "C172SP G1000" goes from under `asobo_c172sp_g1000`, leaving `passengers_skis`, and "Pilatus PC-6" from under `microsoft-pilatus-pc6`, leaving `gauge_wheels`.
  Words that start with a digit go from its front, so "A380-800 RR Basic" under `inibuilds-a380` leaves `rr_basic`.
  For a folder, it's the last part of its name that starts with a letter, as `g1000` from `asobo_c172sp_g1000`.
- **Add**, a button beside the field, and Enter, write it; Add is off while nothing can be added, while the field holds no ID, or while the variant already covers the aircraft.
- **Colors:** a variant's ID shows in the color the profile's text gives a variant ID, and a path in the color it gives a plain value, so the island and the file read as one thing (user, 2026-11-26).
- **Keys:** the picked choice takes the keys as the island opens, so Up and Down choose, Enter adds, and Escape closes.

## What Add writes

- Into a new variant, `<id>: <path>` as the last line under `variants:`.
- Into an existing variant, the path after the variant's own, which turns a variant of one path into a list, as the formatter writes one ([layout](01-format-and-delivery.md#layout)).
  The variant's own lines and their comments stay as they are.
- In a file with a map written in brackets, nothing, since the file doesn't build with one; Add says to write it out first.
- `serve` makes the edit through LSP's `workspace/applyEdit`, as the display picker's goes, and the island closes; the edit is unsaved until the author saves, and a save builds it as any save does.

## The status line for an aircraft no profile covers

In the session's flight with no profile pinned, the status line says "Mismatching aircraft" over the raw path, which is the state for an open file that isn't the session's profile.
It gets a state of its own, drafted as "No profile", the aircraft's `A:TITLE` under it, and "No profile covers this aircraft.", whose words the dev page settles.

## Every tool island's title closes it

Each tool island, Run, Pick displays, and Add this aircraft, has a close button at the right of its title, which leaves it as Escape does, so every island leaves the same way, and Run, which had no way out, gets one (user, 2026-11-26).
The display picker's Cancel goes.

## How it works

| Part | Where | What it adds |
| --- | --- | --- |
| `authoring` | `src/features/authoring/core` | In the status line's facts, the loaded aircraft's `A:TITLE` from the sim service while the sim is in a flight, beside the path they carry, and whether the session pinned no profile |
| `profile-engine` | `src/engines/profile-engine` | The rule that picks the variant covering an aircraft, and how it covers it, which the core's loader and the island share |
| `serve` | `tools/profile-builder` | The lens and its rule, the island's view from the path, the title, and the open text's `variants`, the suggestion, and the edit, which shares its reading and writing of the text with the display picker's |
| The extension | `src/apps/profile-extension` | The lens's command and the palette's, the island, the close button on every tool island's title, the status line's new state, and their scenes on the panel's dev page; the island takes the profile's colors from the manifest, as the Sync log does |
| The kit | `src/packages/ui` | A radio group, shadcn's Luma one, as its checkbox is, spaced with margins since Coherent GT drops `gap` |

`serve` builds the island from the status line's facts and the open text alone, so `authoring.panel` carries nothing for it, and `authoring` reads none of the profile's `variants`.

## Known limits

- The island adds one aircraft at a time: a folder's other presets that need variants of their own are added by loading each.
- An aircraft built the MSFS 2020 way gives an `A:TITLE` that holds its livery, as the Baron 58P's "Black Square Baron 58P Professional N515MR" does (measured on MSFS 2024, 2026-11-17, [session log](../session/log.md#2026-11-17-in-the-sim-join-set-the-world-map-and-started-the-flight-within-09s-and-active-pause-followed-from-our-efb-apps-code-in-264ms-once-the-menu-script-parsed)), so its lens and island name the livery too; its path, the folder, is the same for every livery.

## Cases

- `serve`'s own tests, for the island's view: an aircraft its folder's variant covers, one a variant names by its preset, and one nothing covers; a folder a variant names, whose choice is closed; a preset a variant names; an aircraft with no preset; each suggestion, every one an ID; and the edit into a new variant, into an existing variant of one path, and into a profile with no `aircraft:`, a join keeping the variant's comments, and none in a file with a map in brackets.
- `serve`'s own tests, through the server: the lens in a profile out of any session, its range on `variants:`, no island for a module, the island's view, Add's edit, and no lens once the profile names the aircraft's preset; and the views it sends, the island's and the new status line's among them, as the extension's types read them.
- On the bench, in the `authoring` scenario: the status line's facts carry the stand-in sim's title, and say the session pinned a profile.
- On the panel's dev page, by eye with the user: the island in each case above, the close button on every tool island, and the status line's new state.
- In the sim, with no session: in the C172 G1000 Skis, with a profile whose `g1000` names its folder, the lens reads "Add C172SP G1000 Passengers Skis", the island says `g1000` covers it through its folder, and adding the preset into a new variant, `skis`, writes `skis: asobo_c172sp_g1000/presets/asobo/c172sp_avionics_passengers_skis`; then, in a session, the profile loads on `skis`.

## What this changes elsewhere

- [04-the-extension-in-the-sim](04-the-extension-in-the-sim.md) gains a note of stage 22j: adding an aircraft works outside the session's profile and outside a session, every tool island's title closes it, and the status line has a state for an aircraft no profile covers.
