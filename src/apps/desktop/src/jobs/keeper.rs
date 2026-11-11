//! When the app starts a core. It wants one while the sim runs or a session file exists, so a pilot whose sim closed while
//! the crew flies on keeps a core that comes back after a crash. A core that exits with a code other than 0 crashed, and
//! starts again 2s later; one that exits with 0 chose to stop, by a quit or once the sim had closed, and none starts until
//! the sim next starts (record/areas/install/01-installing-and-updating.md, "The sim and the core").
//!
//! A core can exit with 0 for a run of the sim that closed while the next run was already starting, since the core takes a
//! moment to exit, and that next run needs a core. So an exit with 0 stops nothing when the sim the app holds started while
//! that core ran.

use std::time::{Duration, Instant};

/// How long after a crash the core starts again.
pub const AGAIN_AFTER: Duration = Duration::from_secs(2);

#[derive(Default)]
pub struct Keeper {
    /// Set by an exit with 0, and cleared when the sim next starts.
    stopped: bool,
    /// When a crashed core may start again.
    again_at: Option<Instant>,
    /// Whether the sim the app holds started while the core it holds ran.
    sim_started_in_its_life: bool,
}

impl Keeper {
    /// The app found the sim's process.
    pub fn sim_started(&mut self, core_running: bool) {
        self.stopped = false;
        if core_running {
            self.sim_started_in_its_life = true;
        }
    }

    /// The app started a core, or found one running that it hadn't started.
    pub fn core_held(&mut self) {
        self.again_at = None;
        self.sim_started_in_its_life = false;
    }

    /// The core the app held exited with `code`, which is none when Windows wouldn't say.
    pub fn core_exited(&mut self, code: Option<u32>, now: Instant, sim_running: bool) {
        if code == Some(0) {
            self.stopped = !(sim_running && self.sim_started_in_its_life);
        } else {
            self.again_at = Some(now + AGAIN_AFTER);
        }
        self.sim_started_in_its_life = false;
    }

    /// Whether to start a core now, with none running.
    pub fn should_start(&self, now: Instant, sim_running: bool, session_held: bool) -> bool {
        (sim_running || session_held) && !self.stopped && self.again_at.is_none_or(|at| now >= at)
    }

    /// When the next start is due after a crash, so the jobs wake for it.
    pub fn again_at(&self) -> Option<Instant> {
        self.again_at
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sim_or_a_session_wants_a_core() {
        let keeper = Keeper::default();
        let now = Instant::now();
        assert!(keeper.should_start(now, true, false));
        assert!(keeper.should_start(now, false, true));
        assert!(!keeper.should_start(now, false, false));
    }

    #[test]
    fn a_crash_starts_the_core_again_2s_later() {
        let mut keeper = Keeper::default();
        let now = Instant::now();
        keeper.core_held();
        keeper.core_exited(Some(1), now, true);
        assert!(!keeper.should_start(now + Duration::from_millis(1999), true, false));
        assert!(keeper.should_start(now + AGAIN_AFTER, true, false));
        // A crash Windows gave no code for counts as one.
        keeper.core_held();
        keeper.core_exited(None, now, true);
        assert_eq!(keeper.again_at(), Some(now + AGAIN_AFTER));
    }

    #[test]
    fn a_crash_with_the_sim_closed_and_a_session_held_starts_it_again() {
        let mut keeper = Keeper::default();
        let now = Instant::now();
        keeper.core_held();
        keeper.core_exited(Some(0xC000_0409), now, false);
        assert!(keeper.should_start(now + AGAIN_AFTER, false, true));
    }

    #[test]
    fn an_exit_with_0_starts_none_until_the_sim_next_starts() {
        let mut keeper = Keeper::default();
        let now = Instant::now();
        keeper.sim_started(false);
        keeper.core_held();
        // A quit while the sim runs.
        keeper.core_exited(Some(0), now, true);
        assert!(!keeper.should_start(now, true, false));
        keeper.sim_started(false);
        assert!(keeper.should_start(now, true, false));
    }

    #[test]
    fn a_core_that_exits_for_the_last_run_while_the_next_starts_is_started_for_it() {
        let mut keeper = Keeper::default();
        let now = Instant::now();
        keeper.sim_started(false);
        keeper.core_held();
        // The sim closes, and the next run starts while the core is still exiting.
        keeper.sim_started(true);
        keeper.core_exited(Some(0), now, true);
        assert!(keeper.should_start(now, true, false));
    }

    #[test]
    fn a_core_that_exits_for_the_last_run_before_the_next_starts_waits_for_it() {
        let mut keeper = Keeper::default();
        let now = Instant::now();
        keeper.sim_started(false);
        keeper.core_held();
        keeper.core_exited(Some(0), now, false);
        assert!(!keeper.should_start(now, false, true));
        keeper.sim_started(false);
        assert!(keeper.should_start(now, true, false));
    }
}
