//! A checked profile, as the core reads it from a bundle: each block in the order the bundle
//! holds it, and each write function as the JavaScript the builder compiled
//! (record/areas/profiles/01-format-and-delivery.md).

use serde::{Deserialize, Serialize};

use crate::features::{Blocks, EntryFields};
use crate::names::Name;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    /// The aircraft's name as the EFB app's list of supported aircraft shows it, such as
    /// "Synaptic A220".
    pub name: String,
    pub maturity: Maturity,
    pub authors: Option<String>,
    pub aircraft: Aircraft,
    pub state: Vec<StateEntry>,
    pub events: Vec<EventEntry>,
    /// Each feature's blocks, such as avatars' `seats`.
    pub features: Blocks,
}

/// How far a profile's authors stand behind it, which the EFB app's list of supported aircraft
/// tags the aircraft with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Maturity {
    Stable,
    Experimental,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Aircraft {
    pub variants: Vec<Variant>,
    pub pace: Option<Pace>,
}

/// A variant: its short ID, which `only` uses, and the SimObjects folders or presets it
/// covers, each a folder's name or a preset's path below `SimObjects\Airplanes\`, with `/`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Variant {
    pub id: String,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StateEntry {
    pub key: String,
    pub name: String,
    /// What the checklist shows under `name`.
    pub description: Option<String>,
    pub watch: Watch,
    pub write: Write,
    pub owner: Owner,
    /// The variants it applies to, or every variant when empty.
    pub only: Vec<String>,
    pub ignore: Vec<Name>,
    /// Each feature's fields of it, such as avatars' `location`.
    pub features: EntryFields,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EventEntry {
    pub key: String,
    pub name: String,
    /// A `K:`, `H:`, or `B:` event, or an `L:` variable, each rise of it from 0 one occurrence.
    pub watch: Name,
    pub write: Write,
    pub only: Vec<String>,
    pub ignore: Vec<Name>,
    pub features: EntryFields,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Watch {
    Name(Name),
    /// Events counted into a shadow value, which starts at `default`.
    Count(Box<Count>),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Count {
    pub default: f64,
    pub inc: Option<Name>,
    pub dec: Option<Name>,
    pub step: f64,
    /// An event whose value becomes the shadow.
    pub set: Option<Name>,
    /// A variable whose change is added.
    pub count: Option<Name>,
    pub wrap: bool,
    pub range: (f64, f64),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Write {
    /// Watch-only: every machine watches the entry and compares the values.
    None,
    /// Sets the variable, or sends the event once.
    Name(Name),
    /// Flips the control only when the wanted value differs from the local one.
    Toggle(Name),
    Steps(Steps),
    /// JavaScript, compiled at ES2020, which takes the value to write.
    Function(String),
}

/// Turns the difference between the local value and the wanted one into steps.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Steps {
    pub inc: Name,
    pub dec: Name,
    pub step: f64,
    /// `None` on a counted entry, whose write steps by the count's `wrap` and `range`.
    pub wrap: Option<bool>,
    pub range: Option<(f64, f64)>,
    pub pace: Option<Pace>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Owner {
    Shared,
    PilotFlying,
}

/// The spacing of a write's steps or a chain's actions.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Pace {
    Frames(u32),
    Ms(u32),
}

impl Pace {
    /// Reads `1 frame`, `<n> frames`, or `<n>ms`, with `n` a whole number from 1.
    pub fn parse(text: &str) -> Option<Pace> {
        let text = text.trim();
        if text == "1 frame" {
            return Some(Pace::Frames(1));
        }
        let whole = |s: &str| {
            (!s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
                .then(|| s.parse::<u32>().ok())
                .flatten()
                .filter(|n| *n > 0)
        };
        if let Some(n) = text.strip_suffix(" frames") {
            return whole(n).map(Pace::Frames);
        }
        text.strip_suffix("ms").and_then(whole).map(Pace::Ms)
    }
}

impl std::fmt::Display for Pace {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Pace::Frames(1) => write!(f, "1 frame"),
            Pace::Frames(n) => write!(f, "{n} frames"),
            Pace::Ms(n) => write!(f, "{n}ms"),
        }
    }
}

impl Profile {
    /// The variant that covers an aircraft, given the path the sim service reports for it:
    /// its folder, then its preset's path, as `a350/presets/inibuilds/a350-900_default_cabin`,
    /// compared ignoring case. A variant that names the preset beats one that names only its
    /// folder.
    pub fn covers(&self, aircraft: &str) -> Option<&str> {
        let named = |presets: bool| {
            self.aircraft.variants.iter().find(|v| {
                let paths: Vec<String> = v
                    .paths
                    .iter()
                    .filter(|p| p.contains('/') == presets)
                    .cloned()
                    .collect();
                crate::index::covers(&paths, aircraft)
            })
        };
        named(true).or_else(|| named(false)).map(|v| v.id.as_str())
    }

    /// Each block as one variant has it, with the entries whose `only` leaves it out gone. It
    /// takes the profile rather than copying it, since the core resolves a profile on its loop,
    /// where copying every entry's JavaScript would cost a large profile's load much of its
    /// handler's 1ms.
    pub fn resolve(self, variant: &str) -> Resolved {
        let applies = |only: &[String]| only.is_empty() || only.iter().any(|o| o == variant);
        Resolved {
            features: self.features.resolve(variant),
            variant: variant.to_string(),
            pace: self.aircraft.pace,
            state: self
                .state
                .into_iter()
                .filter(|e| applies(&e.only))
                .collect(),
            events: self
                .events
                .into_iter()
                .filter(|e| applies(&e.only))
                .collect(),
        }
    }
}

/// A profile as one variant has it, which the features read once it's loaded.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Resolved {
    pub variant: String,
    pub pace: Option<Pace>,
    pub state: Vec<StateEntry>,
    pub events: Vec<EventEntry>,
    /// Each feature's blocks as this variant has them.
    pub features: Blocks,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(variants: &[(&str, &[&str])]) -> Profile {
        Profile {
            name: "An aircraft".into(),
            maturity: Maturity::Stable,
            authors: None,
            aircraft: Aircraft {
                variants: variants
                    .iter()
                    .map(|(id, paths)| Variant {
                        id: id.to_string(),
                        paths: paths.iter().map(|p| p.to_string()).collect(),
                    })
                    .collect(),
                pace: None,
            },
            state: Vec::new(),
            events: Vec::new(),
            features: Blocks::default(),
        }
    }

    #[test]
    fn a_presets_match_beats_its_folders() {
        let p = profile(&[
            ("any", &["A350"]),
            ("a359", &["A350/presets/inibuilds/A350-900_Default_Cabin"]),
        ]);
        assert_eq!(
            p.covers("a350/presets/inibuilds/a350-900_default_cabin"),
            Some("a359")
        );
        assert_eq!(p.covers("a350/presets/inibuilds/a350-1000"), Some("any"));
        assert_eq!(p.covers("a350"), Some("any"));
        assert_eq!(p.covers("fnx_32x"), None);
    }

    #[test]
    fn a_pace_is_frames_or_ms() {
        assert_eq!(Pace::parse("1 frame"), Some(Pace::Frames(1)));
        assert_eq!(Pace::parse("2 frames"), Some(Pace::Frames(2)));
        assert_eq!(Pace::parse("40ms"), Some(Pace::Ms(40)));
        for bad in ["2 frame", "0ms", "1.5 frames", "-2 frames", "fast", "40 ms"] {
            assert_eq!(Pace::parse(bad), None, "{bad}");
        }
    }
}
