//! Which keys are down, so a held key whose press repeats crosses once
//! (record/areas/core/04-core-helper.md, "Raw Input").

use std::collections::BTreeSet;

/// A key by its scan code and whether it's an E0 key.
pub type Key = (u16, bool);

#[derive(Default)]
pub struct Keys {
    down: BTreeSet<Key>,
}

impl Keys {
    /// Whether a key's report changes it: a press of a key that isn't down, or a release.
    /// Windows repeats a held key's press, and those repeats change nothing.
    pub fn changes(&mut self, key: Key, down: bool) -> bool {
        if down {
            self.down.insert(key)
        } else {
            self.down.remove(&key)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_held_key_whose_press_repeats_crosses_as_one_press_and_one_release() {
        let mut keys = Keys::default();
        let a = (30, false);
        let crossed: Vec<bool> = [true, true, true, true, false]
            .into_iter()
            .filter(|&down| keys.changes(a, down))
            .collect();
        assert_eq!(crossed, [true, false]);
    }

    #[test]
    fn an_e0_key_is_another_key() {
        let mut keys = Keys::default();
        assert!(keys.changes((0x1d, false), true));
        assert!(keys.changes((0x1d, true), true));
    }
}
