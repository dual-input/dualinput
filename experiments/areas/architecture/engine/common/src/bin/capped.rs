//! Runs a command inside a job object capped at PROCESS_CAP, so p04's Node
//! runaways, which can't cap their own process, can't take the machine:
//!
//!   p04-capped.exe node --max-old-space-size=64 baseline.mjs <dist> alloc
//!
//! A child process joins its parent's job, so the command and everything it
//! starts run under the cap. The exit code is the command's.

use p04_common::{cap_process_memory, emit, Json};

fn main() {
    let mut args = std::env::args().skip(1);
    let program = args.next().expect("usage: p04-capped <program> [args...]");
    if !cap_process_memory() {
        emit("WARNING", &Json::new().str("warning", "no process memory cap").done());
    }
    let status = std::process::Command::new(program).args(args).status().expect("could not start the command");
    std::process::exit(status.code().unwrap_or(1));
}
