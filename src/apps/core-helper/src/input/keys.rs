//! Which keys are down, so a held key whose press repeats crosses once
//! (record/areas/core/04-core-helper.md, "Raw Input").

use std::collections::BTreeSet;

/// A key by its scan code and whether it's an E0 key.
pub type Key = (u16, bool);

#[derive(Default)]
pub struct Keys {
    down: BTreeSet<Key>,
}

/// A modifier as a real key: Shift, Ctrl, Alt, or Windows, on either side. Each is its own scan
/// code, or E0 and a code, in scan code set 1 (documented, Microsoft's "Keyboard Scan Code
/// Specification").
const MODIFIERS: [Key; 8] = [
    (0x2a, false),
    (0x36, false),
    (0x1d, false),
    (0x1d, true),
    (0x38, false),
    (0x38, true),
    (0x5b, true),
    (0x5c, true),
];

/// Windows brackets some keys, such as an arrow key with Num Lock on, in a press of Shift that
/// nobody made, which comes with the E0 flag (documented, Microsoft's "Keyboard Scan Code
/// Specification").
const FAKE_SHIFTS: [Key; 2] = [(0x2a, true), (0x36, true)];

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

    /// Whether `key`, just reported down, can be the next press: one key alone, so neither a
    /// modifier nor a combination binds (record/areas/interface/decisions.md, "The Settings tab
    /// holds the binding, the output device, the recordings, and the version").
    pub fn binds(&self, key: Key) -> bool {
        !MODIFIERS.contains(&key)
            && !FAKE_SHIFTS.contains(&key)
            && !MODIFIERS.iter().any(|m| self.down.contains(m))
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
    fn a_modifier_and_a_key_with_one_held_dont_bind_and_a_key_after_its_release_does() {
        let mut keys = Keys::default();
        let (shift, ctrl, k) = ((0x2a, false), (0x1d, true), (0x25, false));
        keys.changes(shift, true);
        assert!(!keys.binds(shift), "a modifier alone doesn't bind");
        keys.changes(k, true);
        assert!(!keys.binds(k), "a combination doesn't bind");
        keys.changes(k, false);
        keys.changes(shift, false);
        keys.changes(ctrl, true);
        assert!(!keys.binds(ctrl), "the right Ctrl is a modifier too");
        keys.changes(ctrl, false);
        keys.changes(k, true);
        assert!(keys.binds(k), "with the modifiers up, a key binds");
    }

    #[test]
    fn a_shift_windows_made_up_for_an_arrow_key_doesnt_bind_and_doesnt_stop_the_arrow_binding() {
        let mut keys = Keys::default();
        let (fake, up) = ((0x2a, true), (0x48, true));
        keys.changes(fake, true);
        assert!(!keys.binds(fake));
        keys.changes(up, true);
        assert!(keys.binds(up));
    }

    #[test]
    fn an_e0_key_is_another_key() {
        let mut keys = Keys::default();
        assert!(keys.changes((0x1d, false), true));
        assert!(keys.changes((0x1d, true), true));
    }
}
