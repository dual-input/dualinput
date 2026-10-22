//! The freeze, the one want that outlasts the frame that asked for it, so the one the host
//! undoes. It releases only a freeze it set: FS Copilot's module sent the unfreeze whoever
//! froze the aircraft, and kept writing poses into the aircraft it had unfrozen (read in the
//! FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `Update_StandAlone` and
//! `interpolate`; not run).

/// One of the sim's three freezes, each with its own variable and event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Flag {
    /// `A:IS LATITUDE LONGITUDE FREEZE ON`, set by `K:FREEZE_LATITUDE_LONGITUDE_SET`.
    LatitudeLongitude,
    /// `A:IS ALTITUDE FREEZE ON`, set by `K:FREEZE_ALTITUDE_SET`.
    Altitude,
    /// `A:IS ATTITUDE FREEZE ON`, set by `K:FREEZE_ATTITUDE_SET`.
    Attitude,
}

const FLAGS: [Flag; 3] = [Flag::LatitudeLongitude, Flag::Altitude, Flag::Attitude];

/// The sim, as the host reaches it: through the sim's own APIs in our module, and through
/// the stand-in's aircraft on the bench (record/areas/core/03-sim-seam-and-wasm-module.md,
/// "Wants and the sim's APIs").
pub trait Sim {
    /// Whether the pilot's aircraft has `flag` on.
    fn frozen(&mut self, flag: Flag) -> bool;
    /// Turns `flag` on or off on the pilot's aircraft.
    fn set_frozen(&mut self, flag: Flag, on: bool);
}

/// Which of the three flags the host turned on.
#[derive(Default)]
pub(crate) struct Freeze {
    set: [bool; 3],
}

impl Freeze {
    /// While a routine asks, turns on each flag that's off, every frame, so the aircraft
    /// stays frozen whatever turns a flag off; once none asks, turns off the flags it
    /// turned on.
    pub(crate) fn carry_out(&mut self, wanted: bool, sim: &mut dyn Sim) {
        for (flag, set) in FLAGS.into_iter().zip(&mut self.set) {
            if wanted && !sim.frozen(flag) {
                sim.set_frozen(flag, true);
                *set = true;
            } else if !wanted && *set {
                sim.set_frozen(flag, false);
                *set = false;
            }
        }
    }
}
