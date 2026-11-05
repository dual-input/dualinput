//! What the mouse reports cross as: the left and right buttons' presses and releases, the
//! right release with how far the mouse moved while it was held, wheel notches, and at most
//! one move every 16ms while the left is held, as our probes' `mouse.mjs` reports them
//! (record/areas/core/04-core-helper.md, "Raw Input"; record/areas/avatars/01-avatars.md,
//! "The mouse").

use messages::core_helper::MouseKind;

/// The fewest µs between two moves.
const MOVE_EVERY: u64 = 16_000;

/// Windows' units for one notch of the wheel.
const NOTCH: i32 = 120;

/// One raw mouse report.
#[derive(Clone, Copy, Debug, Default)]
pub struct Report {
    pub left_down: bool,
    pub left_up: bool,
    pub right_down: bool,
    pub right_up: bool,
    /// The wheel's turn in Windows' units, away from the pilot positive.
    pub wheel: i32,
    /// The mouse's own counts since its last report.
    pub dx: i32,
    pub dy: i32,
}

#[derive(Default)]
pub struct MouseState {
    left: bool,
    right: bool,
    travel: f64,
    last_move: u64,
    /// A high-resolution wheel turns less than a notch at a time, so its turns add up here.
    wheel: i32,
}

impl MouseState {
    /// What one report crosses as, at `at` µs.
    pub fn report(&mut self, report: Report, at: u64) -> Vec<MouseKind> {
        let step = f64::from(report.dx).hypot(f64::from(report.dy));
        if self.right {
            self.travel += step;
        }
        let mut kinds = Vec::new();
        if report.left_down {
            self.left = true;
            self.last_move = at;
            kinds.push(MouseKind::LeftDown);
        }
        if report.left_up {
            self.left = false;
            kinds.push(MouseKind::LeftUp);
        }
        if report.right_down {
            self.right = true;
            self.travel = 0.0;
            kinds.push(MouseKind::RightDown);
        }
        if report.right_up {
            self.right = false;
            kinds.push(MouseKind::RightUp {
                travel: self.travel.round() as u32,
            });
        }
        if report.wheel != 0 {
            self.wheel += report.wheel;
            let notches = self.wheel / NOTCH;
            if notches != 0 {
                self.wheel -= notches * NOTCH;
                kinds.push(MouseKind::Wheel {
                    notches: notches.clamp(i16::MIN.into(), i16::MAX.into()) as i16,
                });
            }
        }
        if self.left && !report.left_down && at.saturating_sub(self.last_move) >= MOVE_EVERY {
            self.last_move = at;
            kinds.push(MouseKind::Move);
        }
        kinds
    }
}

/// Whether `kind` crosses, with the cursor at `place` in the sim's main window, or `None` while
/// that window isn't in front, since a click in a popped-out display or another program is
/// none of the sim's. A click that takes the focus away reads as in front at its press and
/// not at its release, so a left release always crosses, or the hand its press brought would
/// stay until the next click. A press off the window's area is such a click on another monitor
/// (measured on MSFS 2024, 2026-11-05, record/areas/avatars/log.md, "A click that took the
/// focus from the sim left a figure's hand out").
pub fn crosses(kind: &MouseKind, place: Option<(f32, f32)>) -> bool {
    match kind {
        MouseKind::LeftUp => true,
        MouseKind::Move | MouseKind::RightUp { .. } => place.is_some(),
        MouseKind::LeftDown | MouseKind::RightDown | MouseKind::Wheel { .. } => {
            place.is_some_and(|(x, y)| x.abs() <= 1.0 && y.abs() <= 1.0)
        }
    }
}

/// The cursor's place in a client area `width` by `height` pixels, from its pixel in that
/// area: −1 to 1, right and up. `place` in tools/profile-author's screen.rs reads the cursor
/// the same way, so change both together.
pub fn place(x: i32, y: i32, width: u32, height: u32) -> (f32, f32) {
    let across = |p: i32, size: u32| {
        if size == 0 {
            0.0
        } else {
            2.0 * p as f32 / size as f32 - 1.0
        }
    };
    (across(x, width), -across(y, height))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_cross_at_most_every_16ms_while_the_left_is_held() {
        let mut mouse = MouseState::default();
        let moved = Report {
            dx: 3,
            ..Report::default()
        };
        assert_eq!(mouse.report(moved, 0), []);
        let press = Report {
            left_down: true,
            ..Report::default()
        };
        assert_eq!(mouse.report(press, 1_000), [MouseKind::LeftDown]);
        assert_eq!(mouse.report(moved, 10_000), []);
        assert_eq!(mouse.report(moved, 17_000), [MouseKind::Move]);
        assert_eq!(mouse.report(moved, 20_000), []);
        let release = Report {
            left_up: true,
            ..Report::default()
        };
        assert_eq!(mouse.report(release, 40_000), [MouseKind::LeftUp]);
        assert_eq!(mouse.report(moved, 80_000), []);
    }

    #[test]
    fn the_right_release_carries_the_counts_moved_while_it_was_held() {
        let mut mouse = MouseState::default();
        mouse.report(
            Report {
                right_down: true,
                ..Report::default()
            },
            0,
        );
        mouse.report(
            Report {
                dx: 3,
                dy: 4,
                ..Report::default()
            },
            1,
        );
        mouse.report(
            Report {
                dx: -6,
                dy: 8,
                ..Report::default()
            },
            2,
        );
        let up = mouse.report(
            Report {
                right_up: true,
                ..Report::default()
            },
            3,
        );
        assert_eq!(up, [MouseKind::RightUp { travel: 15 }]);
    }

    #[test]
    fn a_high_resolution_wheel_crosses_once_its_turns_make_a_notch() {
        let mut mouse = MouseState::default();
        let turn = |wheel| Report {
            wheel,
            ..Report::default()
        };
        assert_eq!(mouse.report(turn(60), 0), []);
        assert_eq!(mouse.report(turn(60), 1), [MouseKind::Wheel { notches: 1 }]);
        assert_eq!(
            mouse.report(turn(-240), 2),
            [MouseKind::Wheel { notches: -2 }]
        );
    }

    #[test]
    fn a_click_that_takes_the_focus_away_crosses_its_press_and_its_release() {
        let inside = Some((0.2, -0.4));
        assert!(crosses(&MouseKind::LeftDown, inside));
        assert!(crosses(&MouseKind::LeftUp, None));
    }

    #[test]
    fn with_the_sim_behind_or_the_cursor_off_its_window_only_a_left_release_crosses() {
        let off = Some((1.4, 0.0));
        assert!(!crosses(&MouseKind::LeftDown, off));
        assert!(!crosses(&MouseKind::RightDown, off));
        assert!(!crosses(&MouseKind::Wheel { notches: 1 }, off));
        for kind in [
            MouseKind::LeftDown,
            MouseKind::RightDown,
            MouseKind::Move,
            MouseKind::RightUp { travel: 0 },
            MouseKind::Wheel { notches: 1 },
        ] {
            assert!(!crosses(&kind, None), "{kind:?}");
        }
    }

    #[test]
    fn the_corners_of_the_client_area_are_minus_one_one_and_one_minus_one() {
        assert_eq!(place(0, 0, 1920, 1080), (-1.0, 1.0));
        assert_eq!(place(1920, 1080, 1920, 1080), (1.0, -1.0));
        assert_eq!(place(960, 540, 1920, 1080), (0.0, 0.0));
    }
}
