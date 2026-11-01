//! Every block and field the format has, each with the level it came in at, which the checker,
//! the levels' schemas, and their declarations all read, so a field is added in one place.
//!
//! The format's own blocks are read by the checker's own code. A feature's block, such as
//! pointer sync's `displays`, or a field of an entry, such as avatars' `location`, is its
//! module's, in `features/`. A level only adds, so a line here never changes its level once a
//! release has shipped it (record/areas/profiles/01-format-and-delivery.md, "Levels").

#[derive(Clone, Copy, Debug)]
pub(crate) struct Field {
    pub(crate) key: &'static str,
    pub(crate) level: u32,
    /// A module, which has no variants, can't hold it.
    pub(crate) profile_only: bool,
    pub(crate) about: &'static str,
}

const fn field(key: &'static str, level: u32, about: &'static str) -> Field {
    Field {
        key,
        level,
        profile_only: false,
        about,
    }
}

const fn profile_only(key: &'static str, level: u32, about: &'static str) -> Field {
    Field {
        key,
        level,
        profile_only: true,
        about,
    }
}

pub(crate) const TOP: &[Field] = &[
    profile_only(
        "name",
        1,
        "The aircraft's name as the EFB app's list of supported aircraft shows it",
    ),
    profile_only(
        "maturity",
        1,
        "stable or experimental, which that list tags the aircraft with",
    ),
    field(
        "authors",
        1,
        "Who wrote the profile, shown wherever it's credited",
    ),
    profile_only(
        "aircraft",
        1,
        "The variants the profile covers, and a pace for the whole aircraft",
    ),
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
    ),
    field(
        "pace",
        1,
        "The spacing of every write's steps: 1 frame, <n> frames, or <n>ms",
    ),
];

pub(crate) const STATE_ENTRY: &[Field] = &[
    field("name", 1, "The control's name for people"),
    field(
        "description",
        1,
        "What the checklist shows under the control's name",
    ),
    field(
        "watch",
        1,
        "A variable or an instrument() value every machine reads, or a map that counts events",
    ),
    field(
        "write",
        1,
        "How to change the control: a name, a map, a function, or none",
    ),
    field(
        "default",
        1,
        "With a counting watch, the shadow value's starting value",
    ),
    field("owner", 1, "pilot_flying, or shared, the default"),
    profile_only("only", 1, "The variant IDs the entry applies to"),
    field("ignore", 1, "The names this entry's action also fires"),
];

pub(crate) const EVENT_ENTRY: &[Field] = &[
    field("name", 1, "The event's name for people"),
    field(
        "watch",
        1,
        "A K:, H:, or B: event, or an L: variable, each rise from 0 one occurrence",
    ),
    field(
        "write",
        1,
        "What to do on the other machines: a name, a map, or a function",
    ),
    profile_only("only", 1, "The variant IDs the entry applies to"),
    field("ignore", 1, "The names this entry's action also fires"),
];

pub(crate) const TOGGLE: &[Field] = &[field(
    "toggle",
    1,
    "An event that flips the control, sent only when the wanted value differs from the local one",
)];

pub(crate) const STEPS: &[Field] = &[
    field("inc", 1, "The event that steps the control up"),
    field("dec", 1, "The event that steps the control down"),
    field(
        "step",
        1,
        "How far one event moves the control, 1 unless given",
    ),
    field(
        "wrap",
        1,
        "true for a control that goes from its top straight back to its bottom, false for one that stops",
    ),
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
    field("inc", 1, "An event that moves the shadow up a step"),
    field("dec", 1, "An event that moves the shadow down a step"),
    field(
        "step",
        1,
        "How far inc and dec move the shadow, 1 unless given",
    ),
    field("set", 1, "An event whose value becomes the shadow"),
    field("count", 1, "A variable whose change is added to the shadow"),
    field(
        "wrap",
        1,
        "Whether the count goes round at the ends of its range, or stops",
    ),
    field("range", 1, "The count's bottom and top"),
];

/// The field `key` names in `fields`, if it's there at all.
pub(crate) fn find<'a>(fields: &'a [Field], key: &str) -> Option<&'a Field> {
    fields.iter().find(|f| f.key == key)
}
