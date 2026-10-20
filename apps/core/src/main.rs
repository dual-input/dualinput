//! `dualinput-core.exe`, the core, which the desktop app starts with the sim.

use std::process::ExitCode;

use kernel::Registry;

/// Every unit of the core, each crate's `register`, in the order they register: the
/// platform's crates from the kernel up, then the features
/// (record/areas/architecture/02-code-map.md, "The registry and moments"). When you add a
/// crate of the platform's or a feature, add its `register` here in that order.
const UNITS: &[fn(&mut Registry)] = &[];

fn main() -> ExitCode {
    dualinput_core::main(UNITS)
}
