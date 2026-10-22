//! Each flight-hardware device's buttons that are down, so only a change crosses, since four
//! devices nobody touched sent 1,447 reports in 4s (measured on our development machine,
//! 2026-10-08, record/areas/architecture/log.md).

use std::collections::{BTreeMap, BTreeSet};

/// A button that went down or up on one device.
#[derive(Debug, PartialEq, Eq)]
pub struct Change {
    pub button: u16,
    pub down: bool,
}

/// Each device's buttons, by the handle Raw Input names it with.
#[derive(Default)]
pub struct Buttons {
    devices: BTreeMap<isize, BTreeSet<u16>>,
}

impl Buttons {
    /// The changes since the device's last report. A device's first report after the helper
    /// starts, or after the device arrives, only sets which of its buttons are down, so a
    /// switch already on never counts as a press, nor gets bound.
    pub fn report(&mut self, device: isize, down: impl IntoIterator<Item = u16>) -> Vec<Change> {
        let now: BTreeSet<u16> = down.into_iter().collect();
        let Some(before) = self.devices.insert(device, now.clone()) else {
            return Vec::new();
        };
        let pressed = now
            .difference(&before)
            .map(|&button| Change { button, down: true });
        let released = before.difference(&now).map(|&button| Change {
            button,
            down: false,
        });
        pressed.chain(released).collect()
    }

    /// A device arrived or went, so its next report sets its buttons again.
    pub fn forget(&mut self, device: isize) {
        self.devices.remove(&device);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_first_report_sets_the_buttons_and_only_changes_cross_after() {
        let mut buttons = Buttons::default();
        // A throttle quadrant's switch, button 7, is already on as the helper starts.
        assert_eq!(buttons.report(1, [7]), []);
        assert_eq!(buttons.report(1, [7]), []);
        assert_eq!(
            buttons.report(1, [7, 3]),
            [Change {
                button: 3,
                down: true
            }]
        );
        assert_eq!(
            buttons.report(1, [7]),
            [Change {
                button: 3,
                down: false
            }]
        );
        buttons.forget(1);
        assert_eq!(buttons.report(1, [7, 3]), []);
    }
}
