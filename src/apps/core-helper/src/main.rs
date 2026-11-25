//! `dualinput-core-helper.exe`, the core helper: a program the core starts, which reads Raw
//! Input and runs Dual Input's audio, so a crash in that native code costs the pilot only
//! those features until the core starts it again (decision 019;
//! record/areas/core/04-core-helper.md).
//!
//! It reads each `ToHelper` from its standard input and hands it to the thread it's for,
//! and each thread sends its `FromHelper`s to the writer. Its standard input closing tells
//! it the core is gone, so it exits, after a core that crashed too.

// A Windows program with no console, as our probe p08's helper was, so starting it opens no
// window.
#![windows_subsystem = "windows"]

mod audio;
mod clock;
mod input;
mod opus;
mod pipe;

use messages::core_helper::{FromHelper, ToHelper};
use windows::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext,
};

use crate::pipe::Ended;

fn main() {
    // Aware of each monitor's DPI before any window, so the cursor's place and the sim's
    // window's size are both in physical pixels on a monitor scaled above 100%.
    // SAFETY: SetProcessDpiAwarenessContext takes one of Windows' own contexts.
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let out = pipe::Out::start(std::io::stdout());
    // The core counts a helper that said `Hello` as running, so the `Hello` waits for the input
    // thread, which exits the helper if its window doesn't open.
    let input = input::Input::start(out.clone());
    out.send(FromHelper::Hello {
        version: messages::VERSION.into(),
        hash: messages::HASH.into(),
    });
    let mut audio = audio::Audio::new(out);
    let mut stdin = std::io::stdin().lock();
    loop {
        match pipe::read(&mut stdin) {
            Ok(ToHelper::Wants(wants)) => {
                input.set(&wants);
                audio.set(&wants);
            }
            Ok(ToHelper::Sound { sound, ogg_opus }) => audio.sound(sound, &ogg_opus),
            Ok(ToHelper::Play { sound }) => audio.play(sound),
            Ok(ToHelper::Frame {
                stream,
                number,
                at,
                opus,
            }) => audio.frame(stream, number, at, opus),
            Err(Ended::Closed) => std::process::exit(0),
            // Only a bug in our one build sends either, so the helper exits with a code the
            // core logs, and starts it again.
            Err(Ended::TooLong) => std::process::exit(2),
            Err(Ended::DidntParse) => std::process::exit(3),
        }
    }
}
