//! The profile the tool edits: its file, what the tool reads from it, and each edit, which the
//! profile engine checks before the tool writes it, so a profile the tool wrote is one the core
//! loads.

use std::path::{Path, PathBuf};

use profile_engine::features::avatars::{Location, Seat};
use profile_engine::{Files, Variant};

use crate::yaml::{self, Value};

/// A profile's file, as `profiles/aircraft/bksq-baronpro.yaml`: it sits in a folder named
/// `aircraft`, whose parent is the profiles' folder its imports are found from, as the
/// builder takes it (tools/profile-builder/src/main.rs, `profiles`).
pub struct ProfileFile {
    pub path: PathBuf,
    root: PathBuf,
    /// Its path from the profiles' folder, as `aircraft/bksq-baronpro.yaml`.
    name: String,
}

impl ProfileFile {
    pub fn open(path: &Path) -> Result<ProfileFile, String> {
        let folder = path
            .parent()
            .filter(|f| f.file_name().is_some_and(|n| n == "aircraft"))
            .ok_or_else(|| format!("{} isn't in a folder named aircraft", path.display()))?;
        let file = path
            .file_name()
            .ok_or_else(|| format!("{} names no file", path.display()))?;
        let profile = ProfileFile {
            path: path.to_path_buf(),
            root: folder.parent().unwrap_or(Path::new(".")).to_path_buf(),
            name: format!("aircraft/{}", file.to_string_lossy()),
        };
        let text = profile.read()?;
        profile
            .check(&text)
            .map_err(|report| format!("{} has errors to fix first:\n{report}", path.display()))?;
        Ok(profile)
    }

    /// The file's text as it is now, so an edit lands on top of any other made since.
    pub fn read(&self) -> Result<String, String> {
        std::fs::read_to_string(&self.path)
            .map_err(|e| format!("couldn't read {}: {e}", self.path.display()))
    }

    /// Every check but TypeScript's, on `text` in place of the file, with its modules from
    /// the profiles' folder.
    pub fn check(&self, text: &str) -> Result<(), String> {
        check(
            &Edited {
                root: &self.root,
                name: &self.name,
                text,
            },
            &self.name,
        )
    }

    /// Writes `text`, once the profile engine finds no error in it, through a file beside the
    /// profile renamed over it, so an editor holding the profile never reads half of it.
    pub fn write(&self, text: &str) -> Result<(), String> {
        self.check(text).map_err(|report| {
            format!("the edit would break the profile, so it isn't written:\n{report}")
        })?;
        let mut new = self.path.as_os_str().to_owned();
        new.push(".new");
        std::fs::write(&new, text)
            .and_then(|()| std::fs::rename(&new, &self.path))
            .map_err(|e| format!("couldn't write {}: {e}", self.path.display()))
    }
}

/// The profiles' folder with one file's text replaced.
struct Edited<'a> {
    root: &'a Path,
    name: &'a str,
    text: &'a str,
}

impl Files for Edited<'_> {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        if path == self.name {
            Some(self.text.as_bytes().to_vec())
        } else {
            std::fs::read(self.root.join(path)).ok()
        }
    }
}

/// The profile engine's errors in the profile `name` and its modules, as its report prints them.
pub fn check(files: &impl Files, name: &str) -> Result<(), String> {
    let source = profile_engine::source(files, name).map_err(|r| r.to_string())?;
    let report = profile_engine::check(&source, profile_engine::LEVEL);
    if report.has_errors() {
        return Err(report.to_string());
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Block {
    State,
    Events,
}

impl Block {
    pub fn key(self) -> &'static str {
        match self {
            Block::State => "state",
            Block::Events => "events",
        }
    }
}

/// An entry of the profile's own file. A module's entries take no `location`, which the
/// format allows only in a profile (src/engines/profile-engine/src/features/avatars.rs).
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub block: Block,
    pub key: String,
    pub name: String,
    pub only: Vec<String>,
    pub location: Option<Location>,
    pub deadband: Option<f64>,
}

impl Entry {
    /// Where the tool writes its fields, as `["state", "mixture_1", "location"]`.
    pub fn path<'a>(&'a self, field: &'a str) -> [&'a str; 3] {
        [self.block.key(), &self.key, field]
    }

    pub fn applies(&self, variant: &str) -> bool {
        self.only.is_empty() || self.only.iter().any(|o| o == variant)
    }
}

/// What the tool reads from a profile that the engine has checked.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Facts {
    pub variants: Vec<Variant>,
    /// The state entries, then the event entries, each in the file's order.
    pub entries: Vec<Entry>,
    pub seats: Vec<Seat>,
}

impl Facts {
    pub fn read(text: &str) -> Result<Facts, String> {
        let Some(root) = yaml::parse(text)? else {
            return Ok(Facts::default());
        };
        let variants = yaml::get(&root, "aircraft")
            .and_then(|a| yaml::get(a, "variants"))
            .map(yaml::entries)
            .unwrap_or_default()
            .into_iter()
            .map(|(id, paths)| Variant {
                id: id.to_string(),
                paths: strings(paths),
            })
            .collect();
        let mut entries = Vec::new();
        for block in [Block::State, Block::Events] {
            for (key, entry) in yaml::get(&root, block.key())
                .map(yaml::entries)
                .unwrap_or_default()
            {
                let field = |k| yaml::get(entry, k);
                entries.push(Entry {
                    block,
                    key: key.to_string(),
                    name: field("name")
                        .and_then(yaml::text)
                        .unwrap_or(key)
                        .to_string(),
                    only: field("only").map(strings).unwrap_or_default(),
                    location: field("location").and_then(location),
                    deadband: field("deadband").and_then(yaml::number),
                });
            }
        }
        let seats = yaml::get(&root, "seats")
            .map(yaml::entries)
            .unwrap_or_default()
            .into_iter()
            .map(|(key, s)| {
                let field = |k| yaml::get(s, k);
                Seat {
                    key: key.to_string(),
                    name: field("name")
                        .and_then(yaml::text)
                        .unwrap_or(key)
                        .to_string(),
                    hip: field("hip").and_then(yaml::numbers).unwrap_or_default(),
                    knees: field("knees").and_then(yaml::numbers).unwrap_or_default(),
                    feet: field("feet").and_then(yaml::numbers).unwrap_or_default(),
                    eye: field("eye").and_then(yaml::numbers).unwrap_or_default(),
                    facing: field("facing").and_then(yaml::number).unwrap_or(0.0),
                    take_radius: field("take_radius").and_then(yaml::number),
                    only: field("only").map(strings).unwrap_or_default(),
                }
            })
            .collect();
        Ok(Facts {
            variants,
            entries,
            seats,
        })
    }

    /// The variant that covers the loaded aircraft's path, by the core's own rule.
    pub fn variant(&self, aircraft: &str) -> Option<String> {
        let profile = profile_engine::Profile {
            maker: String::new(),
            name: String::new(),
            maturity: profile_engine::Maturity::Experimental,
            authors: None,
            aircraft: profile_engine::Aircraft {
                variants: self.variants.clone(),
                pace: None,
            },
            state: Vec::new(),
            events: Vec::new(),
            features: Default::default(),
        };
        profile.covers(aircraft).map(str::to_string)
    }
}

/// A field that takes a list of text or one item, such as `only`.
fn strings(node: &saphyr::MarkedYaml<'_>) -> Vec<String> {
    yaml::items(node)
        .into_iter()
        .filter_map(|n| yaml::text(n).map(str::to_string))
        .collect()
}

fn location(node: &saphyr::MarkedYaml<'_>) -> Option<Location> {
    if let Some(p) = yaml::numbers::<3>(node) {
        return Some(Location::Everywhere(p));
    }
    let points: Vec<(String, [f64; 3])> = yaml::entries(node)
        .into_iter()
        .filter_map(|(v, p)| Some((v.to_string(), yaml::numbers::<3>(p)?)))
        .collect();
    (!points.is_empty()).then_some(Location::ByVariant(points))
}

/// The entry's location once the author marks `point` with `variant` loaded. An entry that
/// applies to one variant takes one point; one that applies to several takes a point for each,
/// keeping the others' points, so walking the entries once with each variant loaded leaves
/// every variant its own. A single point written before for all of them stays each other
/// variant's.
pub fn located(entry: &Entry, variants: &[Variant], variant: &str, point: [f64; 3]) -> Location {
    let applies: Vec<&str> = variants
        .iter()
        .map(|v| v.id.as_str())
        .filter(|v| entry.applies(v))
        .collect();
    if applies.len() <= 1 {
        return Location::Everywhere(point);
    }
    let old = |v: &str| match &entry.location {
        Some(Location::Everywhere(p)) => Some(*p),
        Some(Location::ByVariant(points)) => points.iter().find(|(w, _)| w == v).map(|(_, p)| *p),
        None => None,
    };
    let points = applies
        .into_iter()
        .filter_map(|v| {
            let p = if v == variant { Some(point) } else { old(v) };
            p.map(|p| (v.to_string(), p))
        })
        .collect();
    Location::ByVariant(points)
}

/// A number of meters as the tool writes it: to the millimeter, which a cast lands well
/// within, so the file reads `0.31` rather than `0.30999999`.
pub fn meters(v: f64) -> String {
    let rounded = (v * 1_000.0).round() / 1_000.0;
    // −0.0 prints as `-0`.
    format!("{}", if rounded == 0.0 { 0.0 } else { rounded })
}

pub fn list(values: &[f64]) -> Value {
    let items: Vec<String> = values.iter().map(|v| meters(*v)).collect();
    Value::Line(format!("[{}]", items.join(", ")))
}

pub fn location_value(location: &Location) -> Value {
    match location {
        Location::Everywhere(p) => list(p),
        Location::ByVariant(points) => {
            Value::Map(points.iter().map(|(v, p)| (v.clone(), list(p))).collect())
        }
    }
}

/// Writes `seat` into `text`'s `seats`, each field in place, in the order the format's
/// examples give them, adding the seat when the text lacks it.
pub fn write_seat(text: &str, seat: &Seat) -> Result<String, String> {
    let at = |field| ["seats", seat.key.as_str(), field];
    let mut text = yaml::set(text, &at("name"), &Value::Line(quoted(&seat.name)))?;
    text = yaml::set(&text, &at("hip"), &list(&seat.hip))?;
    text = yaml::set(&text, &at("knees"), &list(&seat.knees))?;
    text = yaml::set(&text, &at("feet"), &list(&seat.feet))?;
    text = yaml::set(&text, &at("eye"), &list(&seat.eye))?;
    text = if seat.facing == 0.0 {
        yaml::remove(&text, &at("facing"))?
    } else {
        yaml::set(&text, &at("facing"), &Value::Line(meters(seat.facing)))?
    };
    text = match seat.take_radius {
        Some(r) => yaml::set(&text, &at("take_radius"), &Value::Line(meters(r)))?,
        None => yaml::remove(&text, &at("take_radius"))?,
    };
    text = if seat.only.is_empty() {
        yaml::remove(&text, &at("only"))?
    } else {
        let only: Vec<String> = seat.only.iter().map(|o| quoted(o)).collect();
        yaml::set(
            &text,
            &at("only"),
            &Value::Line(format!("[{}]", only.join(", "))),
        )?
    };
    Ok(text)
}

/// Text as a YAML scalar: plain where YAML reads it back as the same text, quoted otherwise.
fn quoted(text: &str) -> String {
    let plain = !text.is_empty()
        && text
            .chars()
            .all(|c| c.is_alphanumeric() || " _-.()/".contains(c))
        && text.chars().next().is_some_and(char::is_alphabetic)
        && !text.ends_with(' ')
        && yaml::parse(&format!("k: {text}"))
            .ok()
            .flatten()
            .and_then(|r| yaml::get(&r, "k").and_then(yaml::text).map(|t| t == text))
            .unwrap_or(false);
    if plain {
        text.to_string()
    } else {
        format!("'{}'", text.replace('\'', "''"))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::BTreeMap;

    use super::*;

    /// A profile with two variants, a state entry and an event entry, and comments to keep.
    pub(crate) const PROFILE: &str = "authors: Dual Input # the team

aircraft:
  variants:
    base: bksq-aircraft-baronpro
    press: bksq-aircraft-baronpropress

# ═══ STATE
state:
  battery:
    name: Battery
    watch: L('BKSQ_Battery')
    write: L('BKSQ_Battery')
  mixture_1:
    name: Left mixture
    only: press
    watch: L('BKSQ_MixtureLeverPosition_1')
    write: L('BKSQ_MixtureLeverPosition_1')

events:
  ap_master:
    name: Autopilot master
    watch: K('AP_MASTER')
    write: K('AP_MASTER')
";

    pub(crate) struct Memory(pub(crate) BTreeMap<String, String>);

    impl Files for Memory {
        fn read(&self, path: &str) -> Option<Vec<u8>> {
            self.0.get(path).map(|t| t.as_bytes().to_vec())
        }
    }

    /// Checks `text` as `aircraft/test.yaml`, then reads it back as a bundle, which holds every
    /// field the source does, since the profile has no imports.
    pub(crate) fn read_back(text: &str) -> profile_engine::Profile {
        let files = Memory(BTreeMap::from([(
            "aircraft/test.yaml".to_string(),
            text.to_string(),
        )]));
        check(&files, "aircraft/test.yaml").unwrap_or_else(|r| panic!("{r}\n{text}"));
        profile_engine::read(text.as_bytes(), profile_engine::LEVEL)
            .unwrap_or_else(|r| panic!("{r}\n{text}"))
    }

    fn seat() -> Seat {
        Seat {
            key: "pilot".into(),
            name: "Pilot".into(),
            hip: [0.283, 0.121, 1.4],
            knees: [0.05, 0.45],
            feet: [-0.42, 0.62],
            eye: [0.63, -0.05],
            facing: 0.0,
            take_radius: Some(0.5),
            only: Vec::new(),
        }
    }

    #[test]
    fn a_seat_written_reads_back_through_the_profile_engine_and_keeps_the_comments() {
        let text = write_seat(PROFILE, &seat()).unwrap();
        let profile = read_back(&text);
        assert_eq!(profile.features.avatars.seats, vec![seat()]);
        assert!(text.contains("authors: Dual Input # the team\n"));
        assert!(text.contains("# ═══ STATE\n"));
        let mut moved = seat();
        moved.hip[2] = 1.35;
        moved.take_radius = None;
        moved.facing = 12.5;
        let again = write_seat(&text, &moved).unwrap();
        assert_eq!(read_back(&again).features.avatars.seats, vec![moved]);
        assert_eq!(Facts::read(&again).unwrap().seats[0].facing, 12.5);
        assert!(!again.contains("take_radius"), "{again}");
    }

    #[test]
    fn a_location_and_a_deadband_written_read_back_through_the_profile_engine() {
        let facts = Facts::read(PROFILE).unwrap();
        let battery = &facts.entries[0];
        let point = [0.2104, 0.5507, 1.9213];
        let first = located(battery, &facts.variants, "press", point);
        assert_eq!(
            first,
            Location::ByVariant(vec![("press".into(), point)]),
            "the battery is in both variants"
        );
        let mut text =
            yaml::set(PROFILE, &battery.path("location"), &location_value(&first)).unwrap();
        text = yaml::set(&text, &battery.path("deadband"), &Value::Line("2".into())).unwrap();
        let profile = read_back(&text);
        let fields = &profile.state[0].features.avatars;
        assert_eq!(
            fields.location,
            Some(Location::ByVariant(vec![(
                "press".into(),
                [0.21, 0.551, 1.921]
            )]))
        );
        assert_eq!(fields.deadband, Some(2.0));

        // Walked again with the other variant loaded, the battery keeps the first point.
        let battery = &Facts::read(&text).unwrap().entries[0];
        let both = located(battery, &facts.variants, "base", [0.1, 0.5, 1.9]);
        assert_eq!(
            both,
            Location::ByVariant(vec![
                ("base".into(), [0.1, 0.5, 1.9]),
                ("press".into(), [0.21, 0.551, 1.921]),
            ])
        );

        // The mixture is only in the 58P, so it takes one point.
        let mixture = &facts.entries[1];
        let one = located(mixture, &facts.variants, "press", [0.3, 0.6, 1.8]);
        let text = yaml::set(PROFILE, &mixture.path("location"), &location_value(&one)).unwrap();
        assert_eq!(
            read_back(&text).state[1].features.avatars.location,
            Some(Location::Everywhere([0.3, 0.6, 1.8]))
        );
        let ap = &facts.entries[2];
        let text = yaml::set(
            PROFILE,
            &ap.path("location"),
            &location_value(&Location::Everywhere([0.0, 0.7, 2.0])),
        )
        .unwrap();
        assert!(
            read_back(&text).events[0]
                .features
                .avatars
                .location
                .is_some()
        );
    }

    #[test]
    fn one_point_for_every_variant_stays_the_other_variants_once_one_is_marked() {
        let facts = Facts::read(PROFILE).unwrap();
        let mut battery = facts.entries[0].clone();
        battery.location = Some(Location::Everywhere([1.0, 1.0, 1.0]));
        assert_eq!(
            located(&battery, &facts.variants, "press", [2.0, 2.0, 2.0]),
            Location::ByVariant(vec![
                ("base".into(), [1.0, 1.0, 1.0]),
                ("press".into(), [2.0, 2.0, 2.0]),
            ])
        );
    }

    #[test]
    fn the_loaded_aircraft_picks_its_variant() {
        let facts = Facts::read(PROFILE).unwrap();
        assert_eq!(
            facts.variant("bksq-aircraft-baronpropress").as_deref(),
            Some("press")
        );
        assert_eq!(facts.variant("pa24-250/presets/a2a/pa24-250"), None);
    }

    #[test]
    fn meters_are_written_to_the_millimeter_and_names_quoted_only_when_they_need_it() {
        assert_eq!(meters(0.30999999), "0.31");
        assert_eq!(meters(-0.0004), "0");
        assert_eq!(meters(2.0), "2");
        assert_eq!(quoted("Pilot"), "Pilot");
        assert_eq!(quoted("Pilot's seat"), "'Pilot''s seat'");
        assert_eq!(quoted("yes"), "yes");
        assert_eq!(quoted("1st officer"), "'1st officer'");
        assert_eq!(quoted("null"), "'null'");
    }
}
