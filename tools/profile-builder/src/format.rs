//! `format`: writes each profile and module in the format's layout, as the profile extension's
//! formatter does, or with `--check` lists each one that isn't in it and fails, as
//! `tools/check.ts` and CI's profiles job run it on `profiles/`
//! (record/areas/profiles/02-units.md, "The builder program").

use std::path::{Path, PathBuf};

use profile_language::Unformatted;

use crate::write_whole;

/// Formats the file `target`, or every `.yaml` file under the folder `target`. With `check`, it
/// writes nothing, and fails when a file isn't in layout.
pub(crate) fn format(target: &Path, check: bool) -> Result<(), String> {
    let files = yaml_files(target)?;
    let mut out_of_layout = 0;
    let mut failed = 0;
    for path in &files {
        let text = std::fs::read_to_string(path)
            .map_err(|e| format!("couldn't read {}: {e}", path.display()))?;
        match profile_language::format(&text) {
            Ok(formatted) if formatted == text => {}
            Ok(_) if check => {
                println!("{}: not in the format's layout", path.display());
                out_of_layout += 1;
            }
            Ok(formatted) => {
                write_whole(path, formatted.as_bytes())?;
                println!("{}: formatted", path.display());
            }
            Err(Unformatted::Yaml(errors)) => {
                for e in errors {
                    eprintln!(
                        "{}:{}:{}: error {}: {}",
                        path.display(),
                        e.at.line,
                        e.at.column,
                        e.code,
                        e.message
                    );
                }
                failed += 1;
            }
            Err(Unformatted::Changed) => {
                eprintln!(
                    "{}: left as it is, since the formatted text read as a different profile, a fault of the formatter's",
                    path.display()
                );
                failed += 1;
            }
        }
    }
    let count = |n: usize| {
        if n == 1 {
            "1 file".to_string()
        } else {
            format!("{n} files")
        }
    };
    match (out_of_layout, failed) {
        (0, 0) => Ok(()),
        (n, 0) => Err(format!(
            "{} not in the format's layout; `dualinput-profile-builder format {}` writes {}",
            count(n),
            target.display(),
            if n == 1 { "it" } else { "them" }
        )),
        (_, n) => Err(format!("{} couldn't be formatted", count(n))),
    }
}

/// The file `target`, or every `.yaml` file under the folder `target`, in order.
fn yaml_files(target: &Path) -> Result<Vec<PathBuf>, String> {
    if target.is_file() {
        return Ok(vec![target.to_path_buf()]);
    }
    let mut found = Vec::new();
    let mut folders = vec![target.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let entries = std::fs::read_dir(&folder)
            .map_err(|e| format!("couldn't list {}: {e}", folder.display()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                folders.push(path);
            } else if path.extension().is_some_and(|e| e == "yaml") {
                found.push(path);
            }
        }
    }
    found.sort();
    Ok(found)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A folder of its own under the system's temporary folder, deleted when the test ends.
    pub(crate) struct Scratch(pub(crate) PathBuf);

    impl Scratch {
        pub(crate) fn new(name: &str) -> Scratch {
            let folder = std::env::temp_dir().join(format!(
                "dualinput-profile-builder-{name}-{}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&folder);
            std::fs::create_dir_all(&folder).expect("the temporary folder should be writable");
            Scratch(folder)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn check_passes_on_the_repositorys_profiles() {
        let profiles = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../profiles");
        format(&profiles, true).expect("profiles/ is in the format's layout");
    }

    #[test]
    fn check_fails_on_a_file_out_of_layout_and_format_writes_it() {
        let scratch = Scratch::new("format");
        let file = scratch.0.join("out.yaml");
        std::fs::write(&file, "state:\n    a:\n        name: \"A\"\nauthors: X\n").expect("writes");
        let error = format(&scratch.0, true).expect_err("out of layout");
        assert!(
            error.contains("1 file not in the format's layout"),
            "{error}"
        );
        format(&scratch.0, false).expect("formats");
        let written = std::fs::read_to_string(&file).expect("reads");
        assert_eq!(written, "authors: X\n\nstate:\n  a:\n    name: A\n");
        format(&scratch.0, true).expect("in layout once formatted");
    }
}
