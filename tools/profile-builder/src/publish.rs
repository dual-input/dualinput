//! `publish`, CI's command: builds every profile, and lays the bundles a release supports out
//! in the Pages tree, adding to what the folder holds and never deleting a file there, since a
//! session may pin any bundle ever published (record/areas/profiles/02-units.md,
//! "Publishing").

use std::path::Path;

use profile_build::{Compiler, build};
use profile_engine::{Index, IndexBundle};

use crate::{Disk, print, profiles, write_whole};

/// Builds each profile in `profiles_folder`, then, if none has an error and no two cover one
/// folder or preset, writes each new bundle at a level up to `released` as `bundles/<hash>.yaml`
/// in `pages`, and the index, which lists only the profiles `profiles_folder` holds. `released`
/// is the highest level a release supports, which CI reads from the release tags; a bundle above
/// it waits for the release that brings its level, since a level can still change before then.
pub(crate) fn publish(
    profiles_folder: &Path,
    pages: &Path,
    released: u32,
    now: &str,
    compiler: &mut Compiler,
) -> Result<(), String> {
    // The index drops each profile the target doesn't hold, so one profile's file as the target
    // would drop every other profile.
    if profiles_folder.is_file() {
        return Err(format!(
            "publish takes the profiles' folder, not one profile, so {} isn't published",
            profiles_folder.display()
        ));
    }
    let (root, paths) = profiles(profiles_folder)?;
    let disk = Disk(root);
    let mut built = Vec::new();
    let mut failed = false;
    for path in &paths {
        let b = build(&disk, path, compiler);
        print(path, &b);
        failed |= b.report.has_errors();
        built.push((path, b));
    }
    if failed {
        return Err("Some profiles have errors, so nothing is published".into());
    }
    // A bare folder covers every preset in it, so a folder in one profile and a preset in it in
    // another cover that preset twice, as two of one path do.
    let mut covered: Vec<(String, &str)> = Vec::new();
    let mut twice = Vec::new();
    for (path, b) in &built {
        for v in b.covers.iter().flat_map(|v| &v.paths) {
            let v = v.to_ascii_lowercase();
            let folder = |p: &str| p.split('/').next().unwrap_or(p).to_string();
            let overlaps = |o: &str| {
                o == v
                    || (!o.contains('/') && o == folder(&v))
                    || (!v.contains('/') && v == folder(o))
            };
            for (o, other) in covered
                .iter()
                .filter(|(o, other)| other != path && overlaps(o))
            {
                twice.push(format!("{v} and {o} overlap, in {path} and {other}"));
            }
            covered.push((v, path));
        }
    }
    if !twice.is_empty() {
        return Err(format!(
            "Two profiles can't cover one folder or preset, so nothing is published:\n{}",
            twice.join("\n")
        ));
    }

    let index_path = pages.join("index.json");
    let mut index = match std::fs::read(&index_path) {
        Ok(bytes) => Index::parse(&bytes)
            .ok_or_else(|| format!("{} doesn't read as an index", index_path.display()))?,
        Err(_) => Index::default(),
    };
    // A renamed or deleted profile's entry would still cover its folders, and a core takes the
    // first entry that covers its aircraft, so the index drops each profile whose file is gone.
    // One whose file is there keeps its entry though it didn't publish this run, as one waiting
    // for the release that brings its level, and a dropped one's bundles stay for a pin.
    index.profiles.retain(|p| {
        let there = paths.iter().any(|path| entry_path(path) == p.path);
        if !there {
            println!(
                "{}: no longer in profiles/, so the index drops it, and its bundles stay for a pin",
                p.path
            );
        }
        there
    });
    let bundles = pages.join("bundles");
    std::fs::create_dir_all(&bundles)
        .map_err(|e| format!("couldn't make {}: {e}", bundles.display()))?;
    // Pages skips Jekyll for a branch that holds this file, and serves every file as it is.
    let jekyll = pages.join(".nojekyll");
    if !jekyll.exists() {
        write_whole(&jekyll, b"")?;
    }
    for (path, b) in built {
        let (Some(bundle), Some(hash), Some(level), Some(shown)) =
            (b.bundle, b.hash, b.level, b.shown)
        else {
            continue;
        };
        if level > released {
            println!(
                "{path}: level {level}, which no release supports yet, so it waits for the release that brings it"
            );
            continue;
        }
        let file = bundles.join(format!("{hash}.yaml"));
        if !file.exists() {
            write_whole(&file, &bundle)?;
        }
        index.add(
            entry_path(path),
            IndexBundle {
                level,
                hash,
                published: now.to_string(),
                variants: b.covers.into_iter().flat_map(|v| v.paths).collect(),
                shown,
            },
        );
    }
    write_whole(&index_path, &index.encode())
}

/// A profile's path in the index, as `aircraft/bksq-baronpro`, from its file's, as
/// `aircraft/bksq-baronpro.yaml`.
fn entry_path(path: &str) -> &str {
    path.trim_end_matches(".yaml")
}

#[cfg(test)]
mod tests {
    use super::*;

    use profile_build::STACK;

    const BARON: &str = "maker: M\nname: A\nstatus: complete\nauthors: Dual Input\naircraft:\n  variants:\n    press: bksq-aircraft-baronpropress\n";

    /// A folder of its own under the PC's temporary folder, empty.
    fn scratch(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("dualinput-publish-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("profiles").join("aircraft")).expect("a scratch folder");
        dir
    }

    fn put(dir: &Path, name: &str, text: &str) {
        std::fs::write(dir.join("profiles").join("aircraft").join(name), text).expect("a profile");
    }

    fn files(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir.join("pages").join("bundles"))
            .map(|r| {
                r.flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    fn on_stack(f: impl FnOnce(&mut Compiler) + Send + 'static) {
        std::thread::Builder::new()
            .stack_size(STACK)
            .spawn(move || f(&mut Compiler::new()))
            .expect("a thread")
            .join()
            .expect("no panic");
    }

    #[test]
    fn a_level_no_release_supports_waits_and_publishing_only_adds_files() {
        on_stack(|compiler| {
            let dir = scratch("levels");
            put(&dir, "bksq-baronpro.yaml", BARON);
            let (profiles, pages) = (dir.join("profiles"), dir.join("pages"));
            publish(&profiles, &pages, 0, "2026-10-20T14:02:11Z", compiler).expect("publishes");
            assert!(
                files(&dir).is_empty(),
                "level 1 waits for a release that supports it"
            );

            publish(&profiles, &pages, 1, "2026-10-20T14:02:11Z", compiler).expect("publishes");
            let first = files(&dir);
            assert_eq!(first.len(), 1);

            put(
                &dir,
                "bksq-baronpro.yaml",
                &BARON.replace("Dual Input", "Dual Input and a friend"),
            );
            publish(&profiles, &pages, 1, "2026-11-05T09:40:57Z", compiler).expect("publishes");
            let second = files(&dir);
            assert_eq!(second.len(), 2, "the first bundle stays for a pin");
            assert!(second.contains(&first[0]));

            let index = Index::parse(&std::fs::read(pages.join("index.json")).expect("an index"))
                .expect("reads");
            let bundles = &index.profiles[0].bundles;
            assert_eq!(index.profiles[0].path, "aircraft/bksq-baronpro");
            assert_eq!(bundles.len(), 1, "a core at level 1 takes only the newest");
            assert_eq!(bundles[0].published, "2026-11-05T09:40:57Z");
            assert_eq!(bundles[0].variants, ["bksq-aircraft-baronpropress"]);
            assert!(pages.join(".nojekyll").exists());
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    #[test]
    fn the_index_lists_only_the_profiles_the_folder_holds_waiting_ones_included() {
        on_stack(|compiler| {
            let dir = scratch("renamed");
            put(&dir, "a.yaml", BARON);
            let (profiles, pages) = (dir.join("profiles"), dir.join("pages"));
            let index = || {
                let bytes = std::fs::read(pages.join("index.json")).expect("an index");
                let index = Index::parse(&bytes).expect("reads");
                index
                    .profiles
                    .into_iter()
                    .map(|p| p.path)
                    .collect::<Vec<_>>()
            };
            publish(&profiles, &pages, 1, "2026-10-20T14:02:11Z", compiler).expect("publishes");
            assert_eq!(index(), ["aircraft/a"]);
            let first = files(&dir);

            // Renamed, and edited, so b builds to a bundle of its own.
            let aircraft = profiles.join("aircraft");
            std::fs::rename(aircraft.join("a.yaml"), aircraft.join("b.yaml")).expect("renames");
            put(
                &dir,
                "b.yaml",
                &BARON.replace("Dual Input", "Dual Input and a friend"),
            );
            publish(&profiles, &pages, 1, "2026-11-05T09:40:57Z", compiler).expect("publishes");
            assert_eq!(index(), ["aircraft/b"]);
            let both = files(&dir);
            assert_eq!(both.len(), 2);
            assert!(both.contains(&first[0]), "a's bundle stays for a pin");

            // A profile that waits for a release keeps its entry.
            publish(&profiles, &pages, 0, "2026-11-06T10:00:00Z", compiler).expect("publishes");
            assert_eq!(index(), ["aircraft/b"]);

            // One profile's file as the target would drop every other profile.
            let one = publish(
                &aircraft.join("b.yaml"),
                &pages,
                1,
                "2026-11-06T10:00:00Z",
                compiler,
            );
            assert!(one.is_err());
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    #[test]
    fn two_profiles_covering_one_preset_publish_nothing() {
        on_stack(|compiler| {
            let dir = scratch("twice");
            put(&dir, "a.yaml", BARON);
            put(
                &dir,
                "b.yaml",
                &BARON.replace("bksq-aircraft-baronpropress", "BKSQ-aircraft-BaronProPress"),
            );
            let error = publish(
                &dir.join("profiles"),
                &dir.join("pages"),
                1,
                "2026-10-20T14:02:11Z",
                compiler,
            )
            .expect_err("two profiles cover one preset");
            assert!(error.contains("overlap"), "{error}");
            assert!(files(&dir).is_empty());

            // A bare folder covers every preset in it.
            put(
                &dir,
                "b.yaml",
                &BARON.replace(
                    "bksq-aircraft-baronpropress",
                    "bksq-aircraft-baronpropress/presets/bksq/press",
                ),
            );
            let error = publish(
                &dir.join("profiles"),
                &dir.join("pages"),
                1,
                "2026-10-20T14:02:11Z",
                compiler,
            )
            .expect_err("a folder and a preset in it overlap");
            assert!(error.contains("overlap"), "{error}");
            assert!(files(&dir).is_empty());
            let _ = std::fs::remove_dir_all(&dir);
        });
    }
}
