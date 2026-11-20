//! Every channel between cores is a constant in this crate, made with `Channel::new`, so a
//! test can find them all in its source and fail on two with one number, which would hand one
//! channel's messages to the other's handler (record/areas/network/02-units.md, "Channels and
//! sends").

// Tests run off the core's loop, so they may read files, which the root's clippy.toml forbids
// only the loop.
#![allow(clippy::disallowed_methods)]

use std::collections::BTreeMap;
use std::path::Path;

#[test]
fn no_two_channels_share_a_number() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut seen: BTreeMap<u16, String> = BTreeMap::new();
    let mut files = Vec::new();
    rust_files(&src, &mut files);
    files.sort();
    for file in files {
        let text = std::fs::read_to_string(&file).expect("a source file should read");
        let name = file.strip_prefix(&src).unwrap().display().to_string();
        for (at, _) in text.match_indices("Channel::new(") {
            let rest = text[at + "Channel::new(".len()..].trim_start();
            let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
            // A `Channel::new(` with no number after it, such as one a doc comment mentions,
            // makes no channel.
            let Ok(number) = digits.parse::<u16>() else {
                continue;
            };
            if let Some(first) = seen.insert(number, name.clone()) {
                panic!("channel {number} is made twice, in {first} and in {name}");
            }
        }
    }
    assert!(
        seen.contains_key(&1),
        "the heartbeat's channel, 1, should be among them"
    );
}

/// Every `.rs` file under `dir`, in its folders too, as `src/module/` holds some.
fn rust_files(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("a folder of src should list") {
        let path = entry.expect("an entry should read").path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}
