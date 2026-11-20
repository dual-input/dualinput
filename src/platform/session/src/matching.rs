//! The match check: each item's owner hands the session crate its value whenever it changes,
//! this core writes its own values into its `MATCH` key, and every core compares every
//! member's values item by item, with each item's own comparison
//! (record/areas/session/02-units.md, "The match check").

use kernel::Cx;
use messages::session::{self as wire, Difference, Installed, MatchItem, MatchValues, Severity};
use messages::sim::Location;
use serde::Serialize;
use serde::de::DeserializeOwned;
use sim_service::{AircraftChanged, SimService};

use crate::Session;

/// A difference an item's comparison found: an error says something will likely go wrong, and
/// a warning that it might (record/areas/product/03-v1-scope.md, "Preflight match check").
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Found {
    pub level: Severity,
    pub words: String,
    /// What the difference can cause, where the item says.
    pub note: Option<String>,
}

/// An item's comparison: each member's name and value, and which of them is this pilot's, so the
/// words can say `yours`, or `None` when this pilot isn't among them, as while out of the flight.
pub type Compare<T> = fn(&[(String, T)], Option<usize>) -> Option<Found>;

type CompareBytes = Box<dyn Fn(&[(String, &[u8], bool)]) -> Option<Found>>;

/// An item's comparison, over each member's name and value in postcard, and whether it's this
/// pilot's.
pub(crate) struct Item {
    compare: CompareBytes,
}

impl Item {
    pub(crate) fn new<T: DeserializeOwned + 'static>(compare: Compare<T>) -> Item {
        Item {
            compare: Box::new(move |values| {
                let read: Vec<(String, T, bool)> = values
                    .iter()
                    .filter_map(|(name, bytes, mine)| {
                        Some((name.clone(), crate::decode(bytes)?, *mine))
                    })
                    .collect();
                let mine = read.iter().position(|(_, _, mine)| *mine);
                let read: Vec<(String, T)> = read
                    .into_iter()
                    .map(|(name, value, _)| (name, value))
                    .collect();
                compare(&read, mine)
            }),
        }
    }
}

/// Hands the session crate this core's value of an item, whenever it changes.
pub fn set_match<T: Serialize>(cx: &Cx, item: MatchItem<T>, value: &T) {
    cx.call(
        Session::match_value,
        (item.number, Some(crate::encode(value))),
    );
}

/// Takes this core's value of an item back while it isn't known, such as a profile still
/// loading, so the crew sees no difference over it.
pub fn clear_match<T>(cx: &Cx, item: MatchItem<T>) {
    cx.call(Session::match_value, (item.number, None));
}

impl Session {
    fn match_value(me: &mut Session, (number, bytes): (u16, Option<Vec<u8>>), cx: &mut Cx) {
        if me.mine.get(&number) == bytes.as_ref() {
            return;
        }
        match bytes {
            Some(bytes) => me.mine.insert(number, bytes),
            None => me.mine.remove(&number),
        };
        write_mine(me, cx);
    }
}

/// Writes this member's `MATCH` key from its own values.
pub(crate) fn write_mine(me: &mut Session, cx: &Cx) {
    if !me.held() {
        return;
    }
    let values = MatchValues {
        items: me.mine.iter().map(|(&n, v)| (n, v.clone())).collect(),
    };
    me.write(wire::MATCH, Some(&values), cx);
}

/// The aircraft's facts changed: the session crate's own items take their new values, and
/// the status its title. A load starts the facts again, and an item holds no value until the
/// package search or the read of the title and livery comes back, so the crew sees no
/// difference over a fact not yet known. `A:TITLE` names every loaded aircraft, so a title
/// of `None` means that read hasn't come back.
pub(crate) fn aircraft_changed(me: &mut Session, _: &AircraftChanged, cx: &mut Cx) {
    if let Some(facts) = cx.read::<SimService>().aircraft_facts().cloned() {
        let installed = facts.location.map(|location| Installed {
            package: facts.package.clone(),
            location,
            version: facts.version.clone(),
        });
        let before = me.mine.clone();
        set_mine(me, wire::PACKAGE, installed.as_ref());
        set_mine(me, wire::VERSION, installed.as_ref());
        set_mine(
            me,
            wire::LIVERY,
            facts.title.is_some().then_some(&facts.livery),
        );
        if me.mine != before {
            write_mine(me, cx);
        }
    }
    me.settle(cx);
}

/// This core's value of one of the session crate's own items, or none while it isn't known.
fn set_mine<T: Serialize>(me: &mut Session, item: MatchItem<T>, value: Option<&T>) {
    match value {
        Some(value) => me.mine.insert(item.number, crate::encode(value)),
        None => me.mine.remove(&item.number),
    };
}

/// Every item's difference among the members in the flight, with each member named by the
/// display name its entry gives.
pub(crate) fn differences(me: &Session) -> Vec<Difference> {
    let flying: Vec<_> = me
        .members()
        .into_iter()
        .filter(|m| me.in_flight(m))
        .collect();
    let values: Vec<(String, MatchValues, bool)> = flying
        .iter()
        .filter_map(|m| {
            let mine = me.me() == Some(*m);
            Some((me.name_of(m), me.member_key(wire::MATCH, m)?, mine))
        })
        .collect();
    me.items
        .iter()
        .filter_map(|(&number, item)| {
            let of_item: Vec<(String, &[u8], bool)> = values
                .iter()
                .filter_map(|(name, v, mine)| {
                    let (_, bytes) = v.items.iter().find(|(n, _)| *n == number)?;
                    Some((name.clone(), bytes.as_slice(), *mine))
                })
                .collect();
            if of_item.len() < 2 {
                return None;
            }
            let found = (item.compare)(&of_item)?;
            Some(Difference {
                item: number,
                level: found.level,
                words: found.words,
                note: found.note,
            })
        })
        .collect()
}

/// Each member's name and its text for a value, as "James 1.0.8, Adam 1.0.9".
fn listed<T>(values: &[(String, T)], text: impl Fn(&T) -> String) -> String {
    values
        .iter()
        .map(|(name, v)| format!("{name} {}", text(v)))
        .collect::<Vec<_>>()
        .join(", ")
}

fn place(installed: &Installed) -> String {
    match installed.location {
        Location::Community => "in Community",
        Location::Community2024 => "in Community2024",
        Location::Official => "from the Marketplace",
        Location::Streamed => "streamed",
    }
    .to_string()
}

/// The aircraft's package and where it's installed, compared for equality, as a warning: two
/// stores can ship one version with different files
/// (record/areas/product/03-v1-scope.md, "Preflight match check"). The words name where each
/// copy is, and not its package, whose folder's name tells a pilot little (user, 2026-11-17).
pub(crate) fn compare_package(values: &[(String, Installed)], _: Option<usize>) -> Option<Found> {
    let first = values.first()?;
    // A streamed copy against an installed one is the version's warning to give, so the crew sees
    // one line for it, not two (user, 2026-11-17).
    let streamed = |v: &Installed| v.location == Location::Streamed;
    if values.iter().any(|(_, v)| streamed(v)) && values.iter().any(|(_, v)| !streamed(v)) {
        return None;
    }
    if values.iter().any(|(_, v)| v.location != first.1.location) {
        return Some(Found {
            level: Severity::Warning,
            words: format!(
                "Aircraft copies come from different places: {}",
                listed(values, place)
            ),
            note: Some("The same version can differ between stores".into()),
        });
    }
    values
        .iter()
        .any(|(_, v)| v.package != first.1.package)
        .then(|| Found {
            level: Severity::Warning,
            words: "Aircraft copies come from different packages".into(),
            note: None,
        })
}

/// The aircraft's version, where both copies have one, as an error. A streamed copy keeps no
/// version on disk, so a streamed copy against an installed one is a warning that this core
/// can't compare them, and two streamed copies show nothing (measured, 2026-10-16,
/// record/areas/aircraft/log.md, "2026-10-16: A streamed package keeps no version on disk,
/// while every installed one with a manifest has its `package_version`").
pub(crate) fn compare_version(values: &[(String, Installed)], _: Option<usize>) -> Option<Found> {
    let streamed = values
        .iter()
        .filter(|(_, v)| v.location == Location::Streamed)
        .count();
    if streamed == values.len() {
        return None;
    }
    if streamed > 0 {
        return Some(Found {
            level: Severity::Warning,
            words: format!(
                "A streamed copy of the aircraft keeps no version Dual Input can read: {}",
                listed(values, |v| v
                    .version
                    .clone()
                    .unwrap_or_else(|| "streamed".into()))
            ),
            note: Some("The two copies may differ and some controls may not sync".into()),
        });
    }
    let versions: Vec<&Option<String>> = values.iter().map(|(_, v)| &v.version).collect();
    let known: Vec<&String> = versions.iter().filter_map(|v| v.as_ref()).collect();
    let differs = known.len() == versions.len() && known.windows(2).any(|w| w[0] != w[1]);
    differs.then(|| Found {
        level: Severity::Error,
        words: format!(
            "Aircraft versions differ: {}",
            listed(values, |v| v.version.clone().unwrap_or_default())
        ),
        note: None,
    })
}

/// The livery, `A:LIVERY NAME`, compared for equality, as a warning.
pub(crate) fn compare_livery(
    values: &[(String, Option<String>)],
    _: Option<usize>,
) -> Option<Found> {
    let first = &values.first()?.1;
    let same = values.iter().all(|(_, v)| v == first);
    (!same).then(|| Found {
        level: Severity::Warning,
        words: format!(
            "Liveries differ: {}",
            listed(values, |v| v.clone().unwrap_or_else(|| "none".into()))
        ),
        note: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copy(location: Location, version: Option<&str>) -> Installed {
        Installed {
            package: (location != Location::Streamed).then(|| "bksq-aircraft-baronpro".into()),
            location,
            version: version.map(str::to_string),
        }
    }

    fn crew(a: Installed, b: Installed) -> Vec<(String, Installed)> {
        vec![("James".into(), a), ("Adam".into(), b)]
    }

    #[test]
    fn a_streamed_copy_against_an_installed_one_is_a_warning() {
        let found = compare_version(
            &crew(
                copy(Location::Community, Some("0.1.1")),
                copy(Location::Streamed, None),
            ),
            None,
        )
        .unwrap();
        assert_eq!(found.level, Severity::Warning);
        assert!(found.words.contains("keeps no version"), "{}", found.words);
        assert_eq!(
            found.note.as_deref(),
            Some("The two copies may differ and some controls may not sync")
        );
    }

    #[test]
    fn a_streamed_copy_against_an_installed_one_is_one_warning_not_two() {
        let crew = crew(
            copy(Location::Community, Some("0.1.1")),
            copy(Location::Streamed, None),
        );
        assert!(compare_version(&crew, None).is_some());
        assert_eq!(compare_package(&crew, None), None);
    }

    #[test]
    fn two_streamed_copies_show_nothing() {
        assert_eq!(
            compare_version(
                &crew(
                    copy(Location::Streamed, None),
                    copy(Location::Streamed, None)
                ),
                None
            ),
            None
        );
    }

    #[test]
    fn two_installed_versions_that_differ_are_an_error() {
        let found = compare_version(
            &crew(
                copy(Location::Community, Some("1.0.8")),
                copy(Location::Official, Some("1.0.9")),
            ),
            None,
        )
        .unwrap();
        assert_eq!(found.level, Severity::Error);
        assert!(
            found.words == "Aircraft versions differ: James 1.0.8, Adam 1.0.9",
            "{}",
            found.words
        );
    }

    #[test]
    fn the_same_version_from_two_places_differs_only_in_package() {
        let crew = crew(
            copy(Location::Community, Some("1.0.8")),
            copy(Location::Official, Some("1.0.8")),
        );
        assert_eq!(compare_version(&crew, None), None);
        let found = compare_package(&crew, None).unwrap();
        assert_eq!(found.level, Severity::Warning);
        assert_eq!(
            found.words,
            "Aircraft copies come from different places: James in Community, Adam from the Marketplace"
        );
    }

    #[test]
    fn two_packages_in_one_place_say_so_without_naming_them() {
        let mut other = copy(Location::Community, Some("1.0.8"));
        other.package = Some("another-baron".into());
        let found = compare_package(&crew(copy(Location::Community, Some("1.0.8")), other), None);
        assert_eq!(
            found.unwrap().words,
            "Aircraft copies come from different packages"
        );
    }

    #[test]
    fn liveries_that_differ_are_a_warning() {
        let found = compare_livery(
            &[
                ("James".into(), Some("N515MR".into())),
                ("Adam".into(), Some("N58P".into())),
            ],
            None,
        )
        .unwrap();
        assert_eq!(found.level, Severity::Warning);
        assert_eq!(found.words, "Liveries differ: James N515MR, Adam N58P");
    }
}
