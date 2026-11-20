//! Each feature's module of the format: the blocks and the fields of an entry a feature adds,
//! with their checks, their lines in a bundle, and their schema, kept here so the core, CI,
//! and the IDE share them, and deleting a feature deletes its module with it
//! (record/areas/architecture/02-code-map.md, "Tiers").
//!
//! A feature's module is a file in `features/`, with its own types, and one `Module` value.
//! It joins the format through its lines here: its `mod`, its place in `MODULES`, its field in
//! `Blocks` with its line in `Blocks::resolve`, and its field in `EntryFields` if it adds fields
//! to an entry. When you delete a feature, delete those lines and its file. A level only adds, so
//! a block a released level holds stays after its feature goes
//! (record/areas/profiles/01-format-and-delivery.md, "Levels").

pub mod avatars;
pub mod pointer_sync;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::blocks::Field;
use crate::check::Checker;
use crate::tree::{Key, Node};

/// What a feature's module adds to the format.
pub(crate) struct Module {
    /// Its top-level blocks.
    pub(crate) blocks: &'static [Field],
    /// The fields it adds to a state entry, and to an event entry.
    pub(crate) state_fields: &'static [Field],
    pub(crate) event_fields: &'static [Field],
    /// Checks one of its blocks into the profile.
    pub(crate) check_block: fn(&mut Checker, &Key, &Node),
    /// Checks one of its fields of an entry into the entry's fields. A variant ID it reads goes
    /// into `Checker::variants_named`, which the checker holds to the profile's variants as it
    /// holds `only`.
    pub(crate) check_field: fn(&mut Checker, &Key, &Node, &mut EntryFields),
    /// Writes its blocks into a bundle, after the format's own.
    pub(crate) emit_blocks: fn(&Blocks, &mut crate::bundle::Out),
    /// Writes its fields of an entry into a bundle, after the entry's own.
    pub(crate) emit_fields: fn(&EntryFields, &mut crate::bundle::Out),
    /// The schema of one of its blocks or fields, by its key.
    pub(crate) schema: fn(&str) -> Value,
}

/// Every feature's module, in the order a bundle writes their blocks.
pub(crate) const MODULES: &[&Module] = &[&avatars::MODULE, &pointer_sync::MODULE];

/// Every feature's blocks, as a profile holds them.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Blocks {
    pub avatars: avatars::Blocks,
    pub pointer_sync: pointer_sync::Blocks,
}

/// Every feature's fields of one entry.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct EntryFields {
    pub avatars: avatars::EntryFields,
}

impl Blocks {
    /// The blocks as one variant has them.
    pub(crate) fn resolve(&self, variant: &str) -> Blocks {
        Blocks {
            avatars: self.avatars.resolve(variant),
            pointer_sync: self.pointer_sync.resolve(variant),
        }
    }
}

/// The feature's module whose blocks or fields hold `key`, among `table` of each.
pub(crate) fn owner(
    key: &str,
    table: fn(&Module) -> &'static [Field],
) -> Option<(&'static Module, &'static Field)> {
    MODULES
        .iter()
        .find_map(|m| table(m).iter().find(|f| f.key == key).map(|f| (*m, f)))
}
