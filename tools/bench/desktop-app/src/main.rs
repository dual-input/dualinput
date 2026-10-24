//! The bench's stand-in for the desktop app's program. The core starts the desktop app's
//! program from its own folder for the EFB app's button, and tools/bench.ts copies this there
//! as `dualinput-desktop.exe`. Each start appends its arguments, as one line of JSON, to the
//! file `DUALINPUT_BENCH_DESKTOP_APP` names, which the core passes on from the environment the
//! scenario gave it. Then the program exits. A start whose environment names no file writes
//! nothing (record/areas/interface/01-apps.md, "Bringing the desktop app forward").

use std::io::Write;

fn main() {
    let Some(file) = std::env::var_os("DUALINPUT_BENCH_DESKTOP_APP") else {
        return;
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let line = serde_json::to_string(&args).expect("a list of strings should encode as JSON");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
        .expect("the file DUALINPUT_BENCH_DESKTOP_APP names should open");
    writeln!(file, "{line}").expect("the start should write to its file");
}
