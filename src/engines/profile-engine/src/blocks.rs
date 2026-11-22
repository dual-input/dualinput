//! Every block and field the format has, each with the level it came in at, which the checker,
//! the levels' schemas, their declarations, and an editor's completion and hovers all read, so a
//! field is added in one place.
//!
//! The format's own blocks are read by the checker's own code. A feature's block, such as
//! pointer sync's `displays`, or a field of an entry, such as avatars' `location`, is its
//! module's, in `features/`. A level only adds, so a line here never changes its level once a
//! release has shipped it (record/areas/profiles/01-format-and-delivery.md, "Levels").

use crate::features::MODULES;
use crate::names::Allowed;

/// A block at a file's top level, or a field of an entry or a map.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Field {
    pub key: &'static str,
    /// The level of the format it came in at.
    pub level: u32,
    /// A module, which has no variants, can't hold it.
    pub profile_only: bool,
    /// Wherever its table applies, the checker refuses a file without it, and the level's schema
    /// requires it; a top-level block is required in a profile. The checker requires some
    /// fields only beside others, such as `range` with `wrap: true`, which this leaves out.
    pub required: bool,
    /// The kinds of name it takes, where it takes a name.
    pub names: Option<Allowed>,
    /// The words it takes, where it takes one of a few, such as `owner`'s.
    pub words: &'static [&'static str],
    /// What it holds, in one line, which an editor shows on it.
    pub about: &'static str,
}

pub(crate) const fn field(key: &'static str, level: u32, about: &'static str) -> Field {
    Field {
        key,
        level,
        profile_only: false,
        required: false,
        names: None,
        words: &[],
        about,
    }
}

pub(crate) const fn profile_only(key: &'static str, level: u32, about: &'static str) -> Field {
    Field {
        profile_only: true,
        ..field(key, level, about)
    }
}

impl Field {
    pub(crate) const fn with_required(self) -> Field {
        Field {
            required: true,
            ..self
        }
    }

    pub(crate) const fn with_names(self, names: Allowed) -> Field {
        Field {
            names: Some(names),
            ..self
        }
    }

    pub(crate) const fn with_words(self, words: &'static [&'static str]) -> Field {
        Field { words, ..self }
    }
}

/// The top-level keys in the format's layout's order, the format's own and each feature's, which
/// a bundle writes and a formatter puts a file in. `seats` comes last, since an airliner's profile
/// may hold hundreds of seats (record/areas/profiles/01-format-and-delivery.md, "Layout").
pub const LAYOUT: &[&str] = &[
    "maker", "name", "maturity", "authors", "aircraft", "import", "displays", "state", "events",
    "seats",
];

pub(crate) const TOP: &[Field] = &[
    profile_only(
        "maker",
        1,
        "Who makes the aircraft, as the EFB app's list of supported aircraft shows it",
    )
    .with_required(),
    profile_only("name", 1, "The aircraft's model, as that list shows it").with_required(),
    profile_only(
        "maturity",
        1,
        "stable or experimental, which that list tags the aircraft with",
    )
    .with_required()
    .with_words(&["stable", "experimental"]),
    field(
        "authors",
        1,
        "Who wrote the profile, shown wherever it's credited",
    ),
    profile_only(
        "aircraft",
        1,
        "The variants the profile covers, and a pace for the whole aircraft",
    )
    .with_required(),
    field(
        "import",
        1,
        "The modules it uses, each by its path from profiles/ without .yaml",
    ),
    field(
        "state",
        1,
        "State entries: controls whose value every machine keeps the same",
    ),
    field(
        "events",
        1,
        "Event entries: occurrences every machine repeats",
    ),
];

pub(crate) const AIRCRAFT: &[Field] = &[
    field(
        "variants",
        1,
        "Each variant's short ID, and the SimObjects folders or presets it covers",
    )
    .with_required(),
    field(
        "pace",
        1,
        "The spacing of every write's steps: 1 frame, <n> frames, or <n>ms",
    ),
];

pub(crate) const STATE_ENTRY: &[Field] = &[
    field("name", 1, "The control's name for people").with_required(),
    field(
        "description",
        1,
        "What the checklist shows under the control's name",
    ),
    field(
        "watch",
        1,
        "A variable or an instrument() value every machine reads, or a map that counts events",
    )
    .with_required()
    .with_names(Allowed::StateWatch),
    field(
        "write",
        1,
        "How to change the control: a name, a map, a function, or none",
    )
    .with_required()
    .with_names(Allowed::Write)
    .with_words(&["none"]),
    field(
        "default",
        1,
        "With a counting watch, the shadow value's starting value",
    ),
    field("owner", 1, "pilot_flying, or shared, the default")
        .with_words(&["pilot_flying", "shared"]),
    profile_only("only", 1, "The variant IDs the entry applies to"),
    field("ignore", 1, "The names this entry's action also fires").with_names(Allowed::Ignore),
];

pub(crate) const EVENT_ENTRY: &[Field] = &[
    field("name", 1, "The event's name for people").with_required(),
    field(
        "watch",
        1,
        "A K:, H:, or B: event, or an L: variable, each rise from 0 one occurrence",
    )
    .with_required()
    .with_names(Allowed::EventWatch),
    field(
        "write",
        1,
        "What to do on the other machines: a name or a function",
    )
    .with_required()
    .with_names(Allowed::Write),
    profile_only("only", 1, "The variant IDs the entry applies to"),
    field("ignore", 1, "The names this entry's action also fires").with_names(Allowed::Ignore),
];

pub(crate) const TOGGLE: &[Field] = &[field(
    "toggle",
    1,
    "An event that flips the control, sent only when the wanted value differs from the local one",
)
.with_required()
.with_names(Allowed::Event)];

pub(crate) const STEPS: &[Field] = &[
    field("inc", 1, "The event that steps the control up")
        .with_required()
        .with_names(Allowed::Event),
    field("dec", 1, "The event that steps the control down")
        .with_required()
        .with_names(Allowed::Event),
    field(
        "step",
        1,
        "How far one event moves the control, 1 unless given",
    ),
    field(
        "wrap",
        1,
        "true for a control that goes from its top straight back to its bottom, false for one that stops",
    )
    .with_words(&["true", "false"]),
    field(
        "range",
        1,
        "The control's bottom and top, required with wrap: true",
    ),
    field(
        "pace",
        1,
        "The spacing of the steps: 1 frame, <n> frames, or <n>ms",
    ),
];

pub(crate) const COUNT: &[Field] = &[
    field("inc", 1, "An event that moves the shadow up a step").with_names(Allowed::Event),
    field("dec", 1, "An event that moves the shadow down a step").with_names(Allowed::Event),
    field(
        "step",
        1,
        "How far inc and dec move the shadow, 1 unless given",
    ),
    field("set", 1, "An event whose value becomes the shadow").with_names(Allowed::Event),
    field("count", 1, "A variable whose change is added to the shadow")
        .with_names(Allowed::Variable),
    field(
        "wrap",
        1,
        "Whether the count goes round at the ends of its range, or stops",
    )
    .with_required()
    .with_words(&["true", "false"]),
    field("range", 1, "The count's bottom and top").with_required(),
];

/// The field `key` names in `fields`, if it's there at all.
pub(crate) fn find<'a>(fields: &'a [Field], key: &str) -> Option<&'a Field> {
    fields.iter().find(|f| f.key == key)
}

/// A place in a file that takes fields, which picks their table.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Table<'a> {
    /// A file's top-level blocks.
    Top,
    Aircraft,
    StateEntry,
    EventEntry,
    /// A state entry's `write:` map that toggles, which holds `toggle`.
    Toggle,
    /// A state entry's `write:` map that steps.
    Steps,
    /// A state entry's `watch:` map, which counts events into a shadow value.
    Count,
    /// Each item of a feature's block, by the block's key, as each seat in `seats`; a block
    /// whose items are plain values, as `displays`' are, holds none.
    Item(&'a str),
}

/// The fields `table` holds, the format's own and each feature's: a file's top level in
/// `LAYOUT`'s order, and an entry's in the order a bundle writes them, each feature's after the
/// entry's own. An editor leaves out a field above its level, and in a module one only a profile
/// holds, as the checker refuses both.
pub fn fields(table: Table) -> Vec<Field> {
    let with_features = |own: &[Field], of: fn(&crate::features::Module) -> &'static [Field]| {
        own.iter()
            .chain(MODULES.iter().flat_map(|m| of(m)))
            .copied()
            .collect::<Vec<Field>>()
    };
    match table {
        Table::Top => {
            let mut top = with_features(TOP, |m| m.blocks);
            top.sort_by_key(|f| LAYOUT.iter().position(|k| *k == f.key));
            top
        }
        Table::Aircraft => AIRCRAFT.to_vec(),
        Table::StateEntry => with_features(STATE_ENTRY, |m| m.state_fields),
        Table::EventEntry => with_features(EVENT_ENTRY, |m| m.event_fields),
        Table::Toggle => TOGGLE.to_vec(),
        Table::Steps => STEPS.to_vec(),
        Table::Count => COUNT.to_vec(),
        Table::Item(block) => MODULES
            .iter()
            .find(|m| m.blocks.iter().any(|b| b.key == block))
            .map(|m| (m.items)(block).to_vec())
            .unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A bundle writes each top-level block at its key's place in `LAYOUT`, so a block missing
    /// from it would never be written.
    #[test]
    fn the_layout_holds_every_top_level_block_once() {
        let keys: Vec<&str> = fields(Table::Top).iter().map(|f| f.key).collect();
        assert_eq!(keys, LAYOUT);
        assert_eq!(LAYOUT.last(), Some(&"seats"));
    }

    /// The checker reads these fields as names with the names their table gives, and stops on
    /// one that gives none.
    #[test]
    fn every_field_read_as_a_name_says_which_names_it_takes() {
        for table in [
            Table::StateEntry,
            Table::EventEntry,
            Table::Toggle,
            Table::Steps,
            Table::Count,
        ] {
            for f in fields(table) {
                let named = matches!(
                    f.key,
                    "watch" | "write" | "ignore" | "toggle" | "inc" | "dec" | "set" | "count"
                );
                assert_eq!(f.names.is_some(), named, "{table:?} {}", f.key);
            }
        }
    }

    #[test]
    fn an_entrys_fields_put_each_features_after_its_own() {
        let keys: Vec<&str> = fields(Table::StateEntry).iter().map(|f| f.key).collect();
        assert_eq!(
            keys,
            [
                "name",
                "description",
                "watch",
                "write",
                "default",
                "owner",
                "only",
                "ignore",
                "location",
                "deadband"
            ]
        );
        let seat: Vec<&str> = fields(Table::Item("seats")).iter().map(|f| f.key).collect();
        assert_eq!(seat[..5], ["name", "hip", "knees", "feet", "eye"]);
        assert!(fields(Table::Item("displays")).is_empty());
    }
}
