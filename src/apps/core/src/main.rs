//! `dualinput-core.exe`, the core, which the desktop app starts with the sim.

use std::process::ExitCode;

use kernel::Registry;

/// Every unit of the core, each crate's `register`, in the order they register: the
/// platform's crates from the kernel up, then the features
/// (record/areas/architecture/02-code-map.md, "The registry and moments"). When you add a
/// crate of the platform's or a feature, add its `register` here in that order.
const UNITS: &[fn(&mut Registry)] = &[
    clients::register,
    sim_service::register,
    core_helper_service::register,
    network::register,
    recording::register,
    session::register,
    profile_loader::register,
    cockpit_stream::register,
    pointer_sync::register,
    state_sync::register,
    take_control::register,
    rate_and_pause::register,
    go_to::register,
    avatars::register,
    flight_model::register,
    traffic::register,
    atc_audio::register,
];

fn main() -> ExitCode {
    dualinput_core::main(UNITS)
}
