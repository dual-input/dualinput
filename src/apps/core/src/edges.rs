//! The core's edges: the threads that wait, each pushing what it waited for into the queue
//! as an input, and what carries out the units' outputs. When you add an edge, add its
//! module here.

use std::path::PathBuf;

pub mod core_helper;
pub mod jobs;
pub mod network;
// A bench build puts the stand-in sim where the sim edge goes, and starts no sim thread.
#[cfg_attr(feature = "stand-in", allow(dead_code))]
pub mod sim;
pub mod sockets;
pub mod timer;

/// The program `name` in the core's own folder, where a release lays out the core helper beside
/// the core. An absolute `name`, such as a development setting's, stays as it is.
fn beside_core(name: &str) -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(PathBuf::from))
        .unwrap_or_default()
        .join(name)
}
