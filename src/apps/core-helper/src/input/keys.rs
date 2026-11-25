//! Which keys are down, so a held key whose press repeats crosses once, and a key pressed with
//! Shift, Ctrl, or Alt held binds and presses as that combination, such as Ctrl+F9
//! (record/areas/core/04-core-helper.md, "Raw Input").

use std::collections::BTreeSet;

use messages::core_helper::Input;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_RWIN,
};

/// A key by its scan code and whether it's an E0 key.
pub type Key = (u16, bool);

#[derive(Default)]
pub struct Keys {
    down: BTreeSet<Key>,
}

/// Each modifier as its real keys, the left and the right, each its own scan code, or E0 and a
/// code, in scan code set 1 (documented, Microsoft's "Keyboard Scan Code Specification"). A
/// combination holds Shift, Ctrl, or Alt on either side alike, as its name says nothing of a
/// side. `combination_name` in input.rs names a modifier by its first key, whose name says no
/// side, so keep the left key first. When you add a key here, give it its virtual-key code in
/// `virtual_key`.
pub const SHIFT: [Key; 2] = [(0x2a, false), (0x36, false)];
pub const CTRL: [Key; 2] = [(0x1d, false), (0x1d, true)];
pub const ALT: [Key; 2] = [(0x38, false), (0x38, true)];
/// Windows takes its own combinations with the Windows key, so a key pressed with it held
/// binds and presses nothing (user, 2026-11-25).
const WINDOWS: [Key; 2] = [(0x5b, true), (0x5c, true)];

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

    /// Lets go of each modifier and Windows key that `down`, Windows' own record of the keys by
    /// virtual-key code, says is up, so a release Raw Input never delivered doesn't leave one
    /// held. Raw Input brings no input from another desktop, so the releases of Win+L, which
    /// locks the PC, happen on the lock screen, and a Windows key left down here would stop
    /// every bound key until the pilot pressed it again (unverified: pressing the bound key
    /// after Win+L and unlocking, with this left out, settles it). Windows' record is read as
    /// the press is handled, later than Raw Input's order, so it only lets go: a release is
    /// all another desktop can take.
    pub fn let_go_of_released(&mut self, down: impl Fn(u16) -> bool) {
        for key in [SHIFT, CTRL, ALT, WINDOWS].into_iter().flatten() {
            if virtual_key(key).is_some_and(|code| !down(code)) {
                self.down.remove(&key);
            }
        }
    }

    /// What `key`, just reported down, binds and presses: the key with the modifiers held, so a
    /// binding of F9 never fires on Ctrl+F9, nor one of Ctrl+F9 on Ctrl+Shift+F9. A modifier
    /// itself, a Shift Windows made up, and any key with the Windows key held give nothing
    /// (record/areas/interface/decisions.md, "The Settings tab holds the binding, the output
    /// device, the recordings, and the version").
    pub fn combination(&self, key: Key) -> Option<Input> {
        let modifier = [SHIFT, CTRL, ALT, WINDOWS].iter().any(|m| m.contains(&key));
        if modifier || FAKE_SHIFTS.contains(&key) || self.any(&WINDOWS) {
            return None;
        }
        Some(Input::Key {
            scan: key.0,
            extended: key.1,
            ctrl: self.any(&CTRL),
            shift: self.any(&SHIFT),
            alt: self.any(&ALT),
        })
    }

    /// Whether every key of a bound combination is still down, so its hold goes on until the
    /// pilot lets go of any one of them. For a button, false.
    pub fn holds(&self, input: &Input) -> bool {
        let Input::Key {
            scan,
            extended,
            ctrl,
            shift,
            alt,
        } = *input
        else {
            return false;
        };
        self.down.contains(&(scan, extended))
            && (!ctrl || self.any(&CTRL))
            && (!shift || self.any(&SHIFT))
            && (!alt || self.any(&ALT))
    }

    fn any(&self, keys: &[Key]) -> bool {
        keys.iter().any(|key| self.down.contains(key))
    }
}

/// A modifier or Windows key's virtual-key code, VK_LSHIFT to VK_RWIN, which tells its left and
/// right keys apart, or `None` for any other key.
fn virtual_key(key: Key) -> Option<u16> {
    let code = match key {
        (0x2a, false) => VK_LSHIFT,
        (0x36, false) => VK_RSHIFT,
        (0x1d, false) => VK_LCONTROL,
        (0x1d, true) => VK_RCONTROL,
        (0x38, false) => VK_LMENU,
        (0x38, true) => VK_RMENU,
        (0x5b, true) => VK_LWIN,
        (0x5c, true) => VK_RWIN,
        _ => return None,
    };
    Some(code.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const F9: Key = (0x43, false);
    const LEFT_SHIFT: Key = (0x2a, false);
    const LEFT_CTRL: Key = (0x1d, false);
    const RIGHT_CTRL: Key = (0x1d, true);
    const RIGHT_ALT: Key = (0x38, true);
    const LEFT_WINDOWS: Key = (0x5b, true);

    fn pressed(keys: &mut Keys, held: &[Key], key: Key) -> Option<Input> {
        for &k in held {
            keys.changes(k, true);
        }
        keys.changes(key, true);
        keys.combination(key)
    }

    fn f9(ctrl: bool, shift: bool, alt: bool) -> Option<Input> {
        Some(Input::Key {
            scan: 0x43,
            extended: false,
            ctrl,
            shift,
            alt,
        })
    }

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
    fn a_key_presses_with_exactly_the_modifiers_held_on_either_side() {
        assert_eq!(
            pressed(&mut Keys::default(), &[], F9),
            f9(false, false, false)
        );
        assert_eq!(
            pressed(&mut Keys::default(), &[LEFT_CTRL], F9),
            f9(true, false, false)
        );
        assert_eq!(
            pressed(&mut Keys::default(), &[RIGHT_CTRL], F9),
            f9(true, false, false),
            "the right Ctrl is Ctrl too"
        );
        assert_eq!(
            pressed(
                &mut Keys::default(),
                &[LEFT_CTRL, LEFT_SHIFT, RIGHT_ALT],
                F9
            ),
            f9(true, true, true)
        );
    }

    #[test]
    fn a_modifier_alone_and_anything_with_the_windows_key_held_give_nothing() {
        let mut keys = Keys::default();
        for modifier in [LEFT_SHIFT, RIGHT_CTRL, RIGHT_ALT, LEFT_WINDOWS] {
            assert_eq!(pressed(&mut keys, &[], modifier), None, "{modifier:?}");
        }
        let mut keys = Keys::default();
        assert_eq!(pressed(&mut keys, &[LEFT_WINDOWS], F9), None);
        keys.changes(F9, false);
        assert_eq!(
            pressed(&mut keys, &[LEFT_CTRL], F9),
            None,
            "Ctrl with the Windows key still held"
        );
        keys.changes(F9, false);
        keys.changes(LEFT_WINDOWS, false);
        assert_eq!(
            pressed(&mut keys, &[], F9),
            f9(true, false, false),
            "with the Windows key up"
        );
    }

    #[test]
    fn a_modifier_whose_release_never_came_is_let_go_once_windows_says_it_is_up() {
        let mut keys = Keys::default();
        assert_eq!(
            pressed(&mut keys, &[LEFT_WINDOWS, LEFT_CTRL, RIGHT_ALT], F9),
            None
        );
        keys.changes(F9, false);
        keys.changes(F9, true);
        let right_alt = virtual_key(RIGHT_ALT).unwrap();
        keys.let_go_of_released(|code| code == right_alt);
        assert_eq!(keys.combination(F9), f9(false, false, true));
        keys.changes(F9, false);
        keys.changes(F9, true);
        keys.let_go_of_released(|_| true);
        assert_eq!(
            keys.combination(F9),
            f9(false, false, true),
            "Windows' record lets keys go and never holds one down"
        );
    }

    #[test]
    fn every_modifier_and_windows_key_has_its_own_virtual_key() {
        let codes: BTreeSet<u16> = [SHIFT, CTRL, ALT, WINDOWS]
            .into_iter()
            .flatten()
            .map(|key| virtual_key(key).expect("each modifier should have a virtual-key code"))
            .collect();
        assert_eq!(codes.len(), 8);
    }

    #[test]
    fn a_shift_windows_made_up_for_an_arrow_key_is_no_modifier() {
        let mut keys = Keys::default();
        let (fake, up) = ((0x2a, true), (0x48, true));
        assert_eq!(pressed(&mut keys, &[], fake), None);
        assert_eq!(
            pressed(&mut keys, &[], up),
            Some(Input::Key {
                scan: 0x48,
                extended: true,
                ctrl: false,
                shift: false,
                alt: false
            })
        );
    }

    #[test]
    fn a_combination_holds_until_any_of_its_keys_goes_up() {
        let mut keys = Keys::default();
        let ctrl_f9 = pressed(&mut keys, &[LEFT_CTRL, RIGHT_CTRL], F9).unwrap();
        keys.changes(LEFT_SHIFT, true);
        assert!(keys.holds(&ctrl_f9), "another modifier pressed after it");
        keys.changes(LEFT_CTRL, false);
        assert!(keys.holds(&ctrl_f9), "one Ctrl of two let go");
        keys.changes(RIGHT_CTRL, false);
        assert!(!keys.holds(&ctrl_f9), "both let go");
        let mut keys = Keys::default();
        let ctrl_f9 = pressed(&mut keys, &[LEFT_CTRL], F9).unwrap();
        keys.changes(F9, false);
        assert!(!keys.holds(&ctrl_f9), "the key let go");
    }

    #[test]
    fn an_e0_key_is_another_key() {
        let mut keys = Keys::default();
        assert!(keys.changes((0x1d, false), true));
        assert!(keys.changes((0x1d, true), true));
    }
}
