//! Adding the loaded aircraft: which of the open profile's variants covers it, the ID its field
//! starts with, and Add's edit, which writes its preset's path or its folder into `variants`
//! (record/areas/profiles/07-adding-an-aircraft.md).
//!
//! A path here is the core's, cut below `SimObjects\Airplanes\` and lowercased, as
//! `asobo_c172sp_g1000/presets/asobo/c172sp_avionics_passengers_skis`, whose first part is the
//! folder; an aircraft built the MSFS 2020 way gives its folder alone. A profile compares paths
//! ignoring case, as the loader does, and a variant naming a preset beats one naming its folder.

use profile_engine::tree::{self, Kind};
use profile_engine::{Covering, covering};
use profile_language::Edit;

use super::view::{AddCover, AddNamed, AddSuggested, AddView, By};
use super::yaml_edit::{self, scalar};

/// One of the open profile's variants: its ID, with the paths it names.
pub(crate) type Variant = (String, Vec<String>);

/// The open profile's variants, in the file's order.
pub(crate) type Variants = [Variant];

/// The island's view of the loaded aircraft, `path` titled `title`, in a profile with
/// `variants`.
pub(crate) fn view(title: &str, path: &str, variants: &Variants) -> AddView {
    let folder = folder_of(path).to_string();
    let preset = path.contains('/').then(|| path.to_string());
    AddView {
        title: title.to_string(),
        cover: cover(variants, path),
        named: AddNamed {
            preset: preset.as_deref().and_then(|p| named(variants, p)),
            folder: named(variants, &folder),
        },
        variants: variants.iter().map(|(id, _)| id.clone()).collect(),
        suggested: AddSuggested {
            preset: suggest_preset(title, &folder),
            folder: suggest_folder(&folder),
        },
        folder,
        preset,
    }
}

/// Whether a variant already names `path`, so there's nothing to add for it: the lens hides when
/// one names the loaded aircraft's own path, its preset's or, for an aircraft that gives its
/// folder alone, its folder.
pub(crate) fn has_own(variants: &Variants, path: &str) -> bool {
    named(variants, path).is_some()
}

/// Whether adding `path` of the loaded aircraft at `loaded` into the variant `id` would change
/// which variant covers it: not when a variant already names `path`, nor when `path` is the
/// preset and `id` already covers it through its folder.
pub(crate) fn gains_nothing(variants: &Variants, loaded: &str, path: &str, id: &str) -> bool {
    has_own(variants, path)
        || path == loaded
            && cover(variants, loaded).is_some_and(|c| c.by == By::Folder && c.variant == id)
}

/// The folder of a path, its first part.
pub(crate) fn folder_of(path: &str) -> &str {
    path.split('/').next().unwrap_or(path)
}

/// The variant that covers `path`, as the core picks it.
fn cover(variants: &Variants, path: &str) -> Option<AddCover> {
    let ids = variants
        .iter()
        .map(|(id, paths)| (id.as_str(), paths.as_slice()));
    covering(ids, path).map(|(id, how)| AddCover {
        variant: id.to_string(),
        by: match how {
            Covering::Preset => By::Preset,
            Covering::Folder => By::Folder,
        },
    })
}

/// The variant that names exactly `path`.
fn named(variants: &Variants, path: &str) -> Option<String> {
    variants
        .iter()
        .find(|(_, paths)| paths.iter().any(|p| p.eq_ignore_ascii_case(path)))
        .map(|(id, _)| id.clone())
}

/// The ID the field starts with for a preset: the words of its title that its folder's name
/// doesn't hold, separators and case aside, so "C172SP G1000" goes from under
/// `asobo_c172sp_g1000` and leaves `passengers_skis`. A word goes when all of it lies in a run of
/// 3 or more characters the folder's name holds too, since a shorter run, such as one letter,
/// matches by chance. Words that start with a digit go from the front, so the ID starts with a
/// letter, as the format's grammar reads one, and a title with no word that does gets its
/// folder's suggestion. A letter outside ASCII separates words, since an ID can't hold one.
pub(crate) fn suggest_preset(title: &str, folder: &str) -> String {
    let held = squash(folder);
    let words: Vec<String> = title
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_ascii_lowercase)
        .collect();
    let flat: Vec<char> = words.concat().chars().collect();
    let mut marked = vec![false; flat.len()];
    for start in 0..flat.len() {
        let mut length = 0;
        while start + length < flat.len()
            && held.contains(&flat[start..=start + length].iter().collect::<String>())
        {
            length += 1;
        }
        if length >= 3 {
            marked[start..start + length]
                .iter_mut()
                .for_each(|m| *m = true);
        }
    }
    let mut at = 0;
    let mut kept = Vec::new();
    for word in &words {
        let n = word.chars().count();
        if !marked[at..at + n].iter().all(|&m| m) {
            kept.push(word.as_str());
        }
        at += n;
    }
    let kept = if kept.is_empty() {
        words.iter().map(String::as_str).collect()
    } else {
        kept
    };
    from_a_letter(&kept).unwrap_or_else(|| suggest_folder(folder))
}

/// The ID the field starts with for a folder: the last part of its name that starts with a
/// letter, as `g1000` from `asobo_c172sp_g1000`, or its parts joined with `_` after an `_` when
/// none does, as `_737_800` from `737-800`.
pub(crate) fn suggest_folder(folder: &str) -> String {
    let parts: Vec<String> = folder
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|p| !p.is_empty())
        .map(str::to_ascii_lowercase)
        .collect();
    parts
        .iter()
        .rev()
        .find(|p| p.starts_with(|c: char| c.is_ascii_alphabetic()))
        .cloned()
        .unwrap_or_else(|| format!("_{}", parts.join("_")))
}

/// Words joined with `_` from the first that starts with a letter, or none when none does.
fn from_a_letter(words: &[&str]) -> Option<String> {
    let start = words
        .iter()
        .position(|w| w.starts_with(|c: char| c.is_ascii_alphabetic()))?;
    Some(words[start..].join("_"))
}

/// A name's ASCII letters and digits, lowercased, with everything else gone.
fn squash(name: &str) -> String {
    name.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// Whether `id` reads as a variant ID: a letter or `_`, then letters, digits, `_`, and `-`, as the
/// format's grammar reads one. src/apps/profile-extension/panel/src/add.tsx holds the same rule,
/// so change both together.
pub(crate) fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The edit that writes `path` into the variant `id`: under `variants:` as a new variant's last
/// line, or after an existing variant's paths, which turns a variant of one path into a list; in a
/// file with no `variants:`, a `variants:` key first under `aircraft:`, and in one with no
/// `aircraft:`, an `aircraft:` key where the format's layout puts it; then the whole text as the
/// formatter writes it. An existing variant's own lines and their comments stay as they are.
pub(crate) fn edit(text: &str, path: &str, id: &str) -> Result<Option<Edit>, String> {
    let mut editing = yaml_edit::read(text, "Add")?;
    let item = scalar(path);
    let top: &[(tree::Key, tree::Node)] = match &editing.root.kind {
        Kind::Map(entries) => entries,
        _ => &[],
    };
    let lines = &mut editing.lines;
    match top.iter().find(|(k, _)| k.text == "aircraft") {
        None => {
            let block = vec![
                "aircraft:".to_string(),
                "  variants:".to_string(),
                format!("    {id}: {item}"),
            ];
            let at = yaml_edit::new_key_line(&editing, "aircraft");
            editing.lines.splice(at..at, block);
        }
        Some((aircraft, node)) => {
            let fields: &[(tree::Key, tree::Node)] = match &node.kind {
                Kind::Map(fields) => fields,
                Kind::Null => &[],
                _ => return Err("`aircraft` isn't a map, so Add can't put `variants` in it".into()),
            };
            match fields.iter().find(|(k, _)| k.text == "variants") {
                None => {
                    let indent = fields
                        .first()
                        .map_or(aircraft.at.column + 1, |(k, _)| k.at.column - 1);
                    let pad = " ".repeat(indent);
                    lines.splice(
                        aircraft.at.line..aircraft.at.line,
                        [format!("{pad}variants:"), format!("{pad}  {id}: {item}")],
                    );
                }
                Some((key, variants)) => {
                    let entries: &[(tree::Key, tree::Node)] = match &variants.kind {
                        Kind::Map(entries) => entries,
                        Kind::Null => &[],
                        _ => return Err("`variants` isn't a map, so Add can't add to it".into()),
                    };
                    match entries.iter().find(|(k, _)| k.text == id) {
                        None => {
                            let own = key.at.column - 1;
                            let end = block_end(lines, key.at.line - 1, own);
                            let pad = " "
                                .repeat(entries.first().map_or(own + 2, |(k, _)| k.at.column - 1));
                            lines.insert(end, format!("{pad}{id}: {item}"));
                        }
                        Some((variant, value)) => join(lines, variant, value, &item)?,
                    }
                }
            }
        }
    }
    Ok(yaml_edit::finish(text, &editing.lines))
}

/// Writes `item` into the variant whose key is `variant` and whose value is `value`, touching
/// only what it must, so the variant's comments stay: after a list's last item; after the key of
/// a variant with no path; or, for a variant of one path, that path and whatever follows it on
/// its line, a comment included, moved under the key as a list's first item.
fn join(
    lines: &mut Vec<String>,
    variant: &tree::Key,
    value: &tree::Node,
    item: &str,
) -> Result<(), String> {
    let at = variant.at.line - 1;
    match &value.kind {
        Kind::Seq(items) => {
            let last = items.last().map_or(at, |i| i.at.line - 1);
            let line = &lines[last];
            let indent = &line[..line.len() - line.trim_start().len()];
            let added = format!("{indent}- {item}");
            lines.insert(last + 1, added);
        }
        Kind::Map(_) => {
            return Err(format!(
                "`{}` isn't a path or a list of them, so Add can't add to it",
                variant.text
            ));
        }
        _ => {
            let line = &lines[at];
            let indent = &line[..line.len() - line.trim_start().len()];
            // An ID takes no quotes, so its key's line starts with the ID and a colon.
            let rest = line
                .trim_start()
                .strip_prefix(variant.text.as_str())
                .and_then(|r| r.strip_prefix(':'))
                .ok_or("format the file first, so Add can find the variant's line")?;
            let after = rest.trim_start();
            let on_its_line = !after.is_empty() && !after.starts_with('#');
            let replaced = match (&value.kind, on_its_line) {
                // No path yet: the item goes after the key, before any comment.
                (Kind::Null, false) => vec![format!("{indent}{}: {item}{rest}", variant.text)],
                (Kind::Null, true) | (_, false) => {
                    return Err("format the file first, so Add can find the variant's path".into());
                }
                (_, true) => vec![
                    format!("{indent}{}:", variant.text),
                    format!("{indent}  - {after}"),
                    format!("{indent}  - {item}"),
                ],
            };
            lines.splice(at..=at, replaced);
        }
    }
    Ok(())
}

/// The line after a key's block, from 0: its key's line at `line` and the lines below it indented
/// past `indent` or blank, with the blank and comment lines at its end left to what follows.
fn block_end(lines: &[String], line: usize, indent: usize) -> usize {
    let mut end = line + 1;
    for (n, l) in lines.iter().enumerate().skip(line + 1) {
        if l.trim().is_empty() {
            continue;
        }
        if l.len() - l.trim_start().len() <= indent {
            break;
        }
        if !l.trim_start().starts_with('#') {
            end = n + 1;
        }
    }
    end
}

#[cfg(test)]
mod tests {
    use profile_language::format;

    use super::*;

    const SKIS: &str = "asobo_c172sp_g1000/presets/asobo/c172sp_avionics_passengers_skis";

    fn variants(list: &[(&str, &[&str])]) -> Vec<(String, Vec<String>)> {
        list.iter()
            .map(|(id, paths)| {
                (
                    id.to_string(),
                    paths.iter().map(|p| p.to_string()).collect(),
                )
            })
            .collect()
    }

    #[test]
    fn a_preset_its_folders_variant_covers_says_so_and_its_folder_is_named() {
        let v = view(
            "C172SP G1000 Passengers Skis",
            SKIS,
            &variants(&[
                ("classic", &["asobo_c172sp"]),
                ("g1000", &["asobo_c172sp_g1000"]),
            ]),
        );
        assert_eq!(v.folder, "asobo_c172sp_g1000");
        assert_eq!(v.preset.as_deref(), Some(SKIS));
        assert_eq!(
            v.cover,
            Some(AddCover {
                variant: "g1000".into(),
                by: By::Folder
            })
        );
        assert_eq!(
            (v.named.preset, v.named.folder.as_deref()),
            (None, Some("g1000"))
        );
        assert_eq!(v.variants, ["classic", "g1000"]);
        assert_eq!(v.suggested.preset, "passengers_skis");
        assert_eq!(v.suggested.folder, "g1000");
    }

    #[test]
    fn a_variant_naming_the_preset_wins_over_the_folders_ignoring_case() {
        let list = variants(&[
            ("g1000", &["ASOBO_C172SP_G1000"]),
            ("skis", &[&SKIS.to_uppercase()]),
        ]);
        let v = view("C172SP G1000 Passengers Skis", SKIS, &list);
        assert_eq!(
            v.cover,
            Some(AddCover {
                variant: "skis".into(),
                by: By::Preset
            })
        );
        assert_eq!(v.named.preset.as_deref(), Some("skis"));
        assert!(has_own(&list, SKIS));
        assert!(!has_own(
            &list,
            "asobo_c172sp_g1000/presets/asobo/c172sp_avionics_passengers"
        ));
    }

    #[test]
    fn an_aircraft_that_gives_its_folder_alone_has_no_preset() {
        let list = variants(&[("base", &["bksq-aircraft-baronpro"])]);
        let v = view(
            "Black Square Baron 58P Professional N515MR",
            "bksq-aircraft-baronpropress",
            &list,
        );
        assert_eq!((v.preset, v.cover), (None, None));
        assert_eq!(v.suggested.folder, "baronpropress");
        let own = variants(&[("press", &["bksq-aircraft-baronpropress"])]);
        assert!(has_own(&own, "bksq-aircraft-baronpropress"));
    }

    #[test]
    fn a_suggestion_drops_the_words_the_folder_holds_and_starts_with_a_letter() {
        assert_eq!(
            suggest_preset("C172SP G1000 Passengers Skis", "asobo_c172sp_g1000"),
            "passengers_skis"
        );
        assert_eq!(
            suggest_preset("C172SP Classic Skydive", "asobo_c172sp"),
            "classic_skydive"
        );
        assert_eq!(
            suggest_preset("Pilatus PC-6 Gauge Wheels", "microsoft-pilatus-pc6"),
            "gauge_wheels"
        );
        assert_eq!(
            suggest_preset("A380-800 RR Basic", "inibuilds-a380"),
            "rr_basic"
        );
        assert_eq!(
            suggest_preset("Asobo C172SP", "asobo_c172sp"),
            "asobo_c172sp"
        );
        assert_eq!(suggest_folder("asobo_c172sp_g1000"), "g1000");
        assert_eq!(suggest_folder("PMDG 777-300ER"), "pmdg");
        assert_eq!(suggest_folder("microsoft-pilatus-pc6"), "pc6");
    }

    #[test]
    fn every_suggestion_is_an_id() {
        assert_eq!(suggest_preset("Café Racer", "vendor-plane"), "caf_racer");
        assert_eq!(suggest_preset("737 800", "pmdg-737"), "pmdg");
        assert_eq!(suggest_folder("737-800"), "_737_800");
        for id in [
            suggest_preset("Café Racer", "vendor-plane"),
            suggest_preset("737 800", "pmdg-737"),
            suggest_folder("737-800"),
        ] {
            assert!(valid_id(&id), "{id}");
        }
    }

    #[test]
    fn an_id_starts_with_a_letter_or_underscore() {
        assert!(valid_id("skis") && valid_id("_g1000") && valid_id("a-b_2"));
        assert!(
            !valid_id("") && !valid_id("2skis") && !valid_id("passenger skis") && !valid_id("a:b")
        );
    }

    const PROFILE: &str = "maker: Asobo
name: Cessna 172 Skyhawk
status: experimental

aircraft:
  variants:
    classic: asobo_c172sp
    g1000: asobo_c172sp_g1000

# ═══ STATE

state:
  battery:
    name: Battery
    watch: L('BATTERY')
    write: L('BATTERY')
";

    fn applied(text: &str, edit: Option<Edit>) -> String {
        let Some(edit) = edit else {
            return text.to_string();
        };
        let offset = |line: usize, column: usize| {
            let start: usize = text
                .split_inclusive('\n')
                .take(line - 1)
                .map(str::len)
                .sum();
            start + column - 1
        };
        let (from, to) = (
            offset(edit.range.start.line, edit.range.start.column),
            offset(edit.range.end.line, edit.range.end.column),
        );
        format!("{}{}{}", &text[..from], edit.text, &text[to..])
    }

    #[test]
    fn a_new_variant_goes_last_under_variants() {
        let after = applied(PROFILE, edit(PROFILE, SKIS, "skis").expect("an edit"));
        assert!(
            after.contains(&format!(
                "    g1000: asobo_c172sp_g1000\n    skis: {SKIS}\n\n# ═══ STATE"
            )),
            "{after}"
        );
        assert_eq!(
            after,
            format(&after).expect("formats"),
            "as the formatter writes it"
        );
    }

    #[test]
    fn a_path_joins_an_existing_variant_as_a_list() {
        let after = applied(
            PROFILE,
            edit(PROFILE, "asobo_c172sp_g1000_floats", "g1000").expect("an edit"),
        );
        assert!(
            after.contains(
                "    g1000:\n      - asobo_c172sp_g1000\n      - asobo_c172sp_g1000_floats\n"
            ),
            "{after}"
        );
        let again = applied(&after, edit(&after, "third", "g1000").expect("an edit"));
        assert!(
            again.contains("      - asobo_c172sp_g1000_floats\n      - third\n"),
            "{again}"
        );
        assert_eq!(again.matches("g1000:").count(), 1, "{again}");
    }

    #[test]
    fn joining_a_variant_keeps_its_comments() {
        let text = "maker: M\naircraft:\n  variants:\n    g1000: asobo_c172sp_g1000  # NXi and floats\n    two:\n      # the first\n      - a\n      - b  # the second\n";
        let has = |text: &str, parts: &[&str]| -> Option<usize> {
            text.lines()
                .position(|l| parts.iter().all(|p| l.contains(p)))
        };
        let after = applied(
            text,
            edit(text, "asobo_c172sp_g1000_floats", "g1000").expect("an edit"),
        );
        let kept = has(&after, &["- asobo_c172sp_g1000", "# NXi and floats"]);
        let added = has(&after, &["- asobo_c172sp_g1000_floats"]);
        assert!(kept.is_some() && added == kept.map(|k| k + 1), "{after}");
        let again = applied(&after, edit(&after, "c", "two").expect("an edit"));
        let line = |text: &str, whole: &str| text.lines().position(|l| l.trim() == whole);
        let lines = [
            has(&again, &["# the first"]),
            line(&again, "- a"),
            has(&again, &["- b", "# the second"]),
            line(&again, "- c"),
        ];
        assert!(
            lines.iter().all(Option::is_some) && lines.windows(2).all(|w| w[0] < w[1]),
            "{again}"
        );
    }

    #[test]
    fn add_waits_for_a_map_in_brackets_to_be_written_out() {
        let text = "maker: M\naircraft:\n  variants: {g1000: asobo_c172sp_g1000}\n";
        assert!(edit(text, SKIS, "skis").is_err());
    }

    #[test]
    fn a_profile_with_no_aircraft_gets_one_in_its_layout_place() {
        let text = "maker: M\nname: Test\nstatus: experimental\n\n# ═══ STATE\n\nstate:\n  a:\n    watch: L('A')\n    write: L('A')\n";
        let after = applied(
            text,
            edit(text, "asobo_c172sp", "classic").expect("an edit"),
        );
        assert!(
            after.contains("aircraft:\n  variants:\n    classic: asobo_c172sp\n"),
            "{after}"
        );
        let at = |part: &str| {
            after
                .find(part)
                .unwrap_or_else(|| panic!("{part}: {after}"))
        };
        assert!(at("status") < at("aircraft:") && at("aircraft:") < at("# ═══ STATE"));
        let paced = "maker: M\naircraft:\n  pace: 2 frames\n";
        let after = applied(paced, edit(paced, "a_folder", "a").expect("an edit"));
        assert!(
            after.contains("aircraft:\n  variants:\n    a: a_folder\n  pace: 2 frames"),
            "{after}"
        );
    }

    #[test]
    fn add_keeps_the_files_line_ends() {
        let text = PROFILE.replace('\n', "\r\n");
        let after = applied(&text, edit(&text, SKIS, "skis").expect("an edit"));
        assert!(after.contains(&format!("skis: {SKIS}\r\n")), "{after}");
        assert!(!after.replace("\r\n", "").contains('\n'));
    }
}
