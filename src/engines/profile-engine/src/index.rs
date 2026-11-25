//! `index.json`, which the profiles' site serves, CI's builder writes, and the core reads: for
//! each profile, the bundles some level of the format takes (record/areas/profiles/02-units.md,
//! "The index").

use serde::{Deserialize, Serialize};

use crate::format::{Profile, ProfileStatus};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Index {
    pub profiles: Vec<IndexProfile>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexProfile {
    /// The profile's path from `profiles/`, without `.yaml`, as `aircraft/bksq-baronpro`.
    pub path: String,
    /// Oldest first, each at a higher level than the one before.
    pub bundles: Vec<IndexBundle>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexBundle {
    pub level: u32,
    pub hash: String,
    /// When CI published it, in UTC, as `2026-10-20T14:02:11Z`.
    pub published: String,
    /// The SimObjects folders and presets it covers, so a core matches an aircraft to a
    /// profile without opening a bundle.
    pub variants: Vec<String>,
    /// What the EFB app shows of it, so a core lists every profile without opening a bundle.
    #[serde(flatten)]
    pub shown: Shown,
}

/// What the EFB app's list of supported aircraft shows of a profile.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Shown {
    pub maker: String,
    pub name: String,
    pub status: ProfileStatus,
}

impl Shown {
    pub fn of(profile: &Profile) -> Shown {
        Shown {
            maker: profile.maker.clone(),
            name: profile.name.clone(),
            status: profile.status,
        }
    }
}

impl IndexProfile {
    /// The bundle a core at `level` takes: the newest at or below it.
    pub fn bundle_for(&self, level: u32) -> Option<&IndexBundle> {
        self.bundles.iter().rev().find(|b| b.level <= level)
    }
}

impl IndexBundle {
    pub fn covers(&self, aircraft: &str) -> bool {
        covers(&self.variants, aircraft)
    }
}

/// Whether a bundle's variants cover an aircraft, given the path the sim service reports for
/// it, compared ignoring case: a preset by its whole path, and a bare folder every preset in it.
pub fn covers(variants: &[String], aircraft: &str) -> bool {
    let folder = aircraft.split('/').next().unwrap_or(aircraft);
    variants.iter().any(|v| {
        if v.contains('/') {
            v.eq_ignore_ascii_case(aircraft)
        } else {
            v.eq_ignore_ascii_case(folder)
        }
    })
}

impl Index {
    pub fn parse(bytes: &[u8]) -> Option<Index> {
        serde_json::from_slice(bytes).ok()
    }

    /// Pretty JSON, with a final line break.
    pub fn encode(&self) -> Vec<u8> {
        let mut text = serde_json::to_string_pretty(self).expect("an index should encode");
        text.push('\n');
        text.into_bytes()
    }

    /// Adds a bundle CI just published at `level`. Every core at that level or above takes
    /// it, so no level takes a bundle listed at that level or above, which goes from the index,
    /// though its file stays on the site for a pin.
    pub fn add(&mut self, path: &str, bundle: IndexBundle) {
        let i = match self.profiles.iter().position(|p| p.path == path) {
            Some(i) => i,
            None => {
                self.profiles.push(IndexProfile {
                    path: path.to_string(),
                    bundles: Vec::new(),
                });
                self.profiles.sort_by(|a, b| a.path.cmp(&b.path));
                self.profiles
                    .iter()
                    .position(|p| p.path == path)
                    .expect("the profile was just added")
            }
        };
        let profile = &mut self.profiles[i];
        // The newest bundle published again changes nothing, its date included. An older one
        // published again, as a revert builds, is new to every level from its own up.
        if profile.bundles.last().map(|b| &b.hash) == Some(&bundle.hash) {
            return;
        }
        profile.bundles.retain(|b| b.level < bundle.level);
        profile.bundles.push(bundle);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle(level: u32, hash: &str) -> IndexBundle {
        IndexBundle {
            level,
            hash: hash.into(),
            published: "2026-10-20T14:02:11Z".into(),
            variants: vec!["bksq-aircraft-baronpropress".into()],
            shown: Shown {
                maker: "Black Square".into(),
                name: "Baron 58P".into(),
                status: ProfileStatus::Partial,
            },
        }
    }

    #[test]
    fn a_core_takes_the_newest_bundle_at_or_below_its_level() {
        let mut index = Index::default();
        index.add("aircraft/bksq-baronpro", bundle(1, "a1b2"));
        index.add("aircraft/bksq-baronpro", bundle(2, "c3d4"));
        let p = &index.profiles[0];
        assert_eq!(p.bundle_for(1).map(|b| b.hash.as_str()), Some("a1b2"));
        assert_eq!(p.bundle_for(3).map(|b| b.hash.as_str()), Some("c3d4"));
        // A fix that needs only level 1 replaces both, since every level from 1 takes it.
        index.add("aircraft/bksq-baronpro", bundle(1, "e5f6"));
        assert_eq!(index.profiles[0].bundles, [bundle(1, "e5f6")]);
        // A revert to the first bundle is new to level 2 as well.
        index.add("aircraft/bksq-baronpro", bundle(2, "c3d4"));
        index.add("aircraft/bksq-baronpro", bundle(1, "e5f6"));
        assert_eq!(index.profiles[0].bundles, [bundle(1, "e5f6")]);
    }

    #[test]
    fn the_same_bundle_again_keeps_its_date() {
        let mut index = Index::default();
        index.add("aircraft/bksq-baronpro", bundle(1, "a1b2"));
        let mut later = bundle(1, "a1b2");
        later.published = "2026-11-01T00:00:00Z".into();
        index.add("aircraft/bksq-baronpro", later);
        assert_eq!(index.profiles[0].bundles, [bundle(1, "a1b2")]);
    }

    #[test]
    fn an_index_says_what_the_efb_app_shows_of_each_bundle() {
        let mut index = Index::default();
        index.add("aircraft/bksq-baronpro", bundle(1, "a1b2"));
        let text = String::from_utf8(index.encode()).expect("an index is text");
        assert!(text.contains(r#""maker": "Black Square""#), "{text}");
        assert!(text.contains(r#""status": "partial""#), "{text}");
        assert_eq!(Index::parse(text.as_bytes()), Some(index));
    }

    #[test]
    fn a_bare_folder_covers_its_presets() {
        let mut b = bundle(1, "a1b2");
        b.variants = vec!["A350".into(), "FNX_32X/presets/fenix/a320".into()];
        assert!(b.covers("a350/presets/inibuilds/a350-900"));
        assert!(b.covers("fnx_32x/presets/fenix/a320"));
        assert!(!b.covers("fnx_32x/presets/fenix/a321"));
    }
}
