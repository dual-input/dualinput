//! One desktop app for each data folder. Without it, a second start, from the Start menu while the app sits in the tray, made
//! a second tray icon and a second writer to the usage file. The first app holds a named pipe named for its data folder, and
//! a second start that finds it writes what it was started for, and exits, so the running app opens its window
//! (record/areas/install/01-installing-and-updating.md, "One program from login").
//!
//! The pipe is the lock as well as the line: Windows lets only one process create a pipe's first instance, so two apps
//! started at once can't both take it. Its default security lets only this account's processes write to it, so another
//! user's program can't open a window here.

use std::path::Path;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_ACCESS_DENIED, ERROR_NO_DATA, ERROR_PIPE_BUSY, ERROR_PIPE_CONNECTED,
    GENERIC_WRITE, GetLastError, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, OPEN_EXISTING, PIPE_ACCESS_INBOUND, ReadFile,
    WriteFile,
};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE,
    PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    WaitNamedPipeW,
};

use crate::screens::Screen;

/// The longest a request is: one screen's name.
const LONGEST: usize = 64;
/// How long a second start waits for the running app to take its request while the app serves another.
const WAIT_MS: u32 = 2000;

/// What a start asks of the app: a screen to open, or nothing, as a start from the Run value at login asks.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Request {
    Open(Screen),
    Tray,
}

impl Request {
    fn word(self) -> &'static str {
        match self {
            Request::Open(screen) => screen.name(),
            Request::Tray => "tray",
        }
    }

    fn from_word(word: &str) -> Option<Self> {
        match word {
            "tray" => Some(Request::Tray),
            other => Screen::from_name(other).map(Request::Open),
        }
    }
}

/// The pipe's name, from the data folder's path, so a developer's app with a data folder of its own runs beside the
/// pilot's. FNV-1a gives the same name from every build, where the standard library's hasher may change between Rust
/// releases, and an installed app and a development one must agree.
fn pipe_name(data: &Path) -> Vec<u16> {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in data.to_string_lossy().to_lowercase().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!(r"\\.\pipe\dualinput-desktop-{hash:016x}")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect()
}

/// A pipe instance, closed when this goes.
struct Pipe(HANDLE);

// SAFETY: a pipe's handle may be used from any thread, and only the serving thread uses it once it's moved there.
unsafe impl Send for Pipe {}

impl Drop for Pipe {
    fn drop(&mut self) {
        // SAFETY: the handle came from the call that made it, and nothing else closes it.
        unsafe { CloseHandle(self.0) };
    }
}

fn instance(name: &[u16], first: bool) -> Option<Pipe> {
    let flags = PIPE_ACCESS_INBOUND
        | if first {
            FILE_FLAG_FIRST_PIPE_INSTANCE
        } else {
            0
        };
    // SAFETY: the name is a NUL-terminated string that outlives the call, and a null security attribute gives the default.
    let pipe = unsafe {
        CreateNamedPipeW(
            name.as_ptr(),
            flags,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            PIPE_UNLIMITED_INSTANCES,
            0,
            LONGEST as u32,
            0,
            null_mut(),
        )
    };
    (pipe != INVALID_HANDLE_VALUE).then_some(Pipe(pipe))
}

/// What a start found: it's the only app for its data folder, or it handed its request to the one that is.
pub enum Claim {
    First(Server),
    Handed,
}

/// The first instance of the pipe, which `serve` takes requests on.
pub struct Server {
    name: Vec<u16>,
    pipe: Pipe,
}

/// Takes the data folder's pipe, or hands `request` to the app that holds it. An error is one neither could do, such as
/// Windows refusing the pipe, in which case this start runs, as it would have with no check.
pub fn claim(data: &Path, request: Request) -> Result<Claim, String> {
    let name = pipe_name(data);
    if let Some(pipe) = instance(&name, true) {
        return Ok(Claim::First(Server { name, pipe }));
    }
    // SAFETY: the call reads the thread's last error.
    let refused = unsafe { GetLastError() };
    if refused != ERROR_ACCESS_DENIED {
        return Err(format!(
            "Windows refused the app's pipe with error {refused}"
        ));
    }
    hand(&name, request).map(|()| Claim::Handed)
}

/// Writes `request` to the running app, waiting while it serves another start.
fn hand(name: &[u16], request: Request) -> Result<(), String> {
    for _ in 0..3 {
        // SAFETY: the name is a NUL-terminated string that outlives the call.
        let pipe = unsafe {
            CreateFileW(
                name.as_ptr(),
                GENERIC_WRITE,
                0,
                null_mut(),
                OPEN_EXISTING,
                0,
                null_mut(),
            )
        };
        if pipe == INVALID_HANDLE_VALUE {
            // SAFETY: the call reads the thread's last error.
            if unsafe { GetLastError() } == ERROR_PIPE_BUSY {
                // SAFETY: as above.
                unsafe { WaitNamedPipeW(name.as_ptr(), WAIT_MS) };
                continue;
            }
            return Err("the running app's pipe wouldn't open".into());
        }
        let pipe = Pipe(pipe);
        let word = request.word().as_bytes();
        let mut written = 0;
        // SAFETY: the buffer and the count outlive the call, and the pipe is open for writing.
        let wrote = unsafe {
            WriteFile(
                pipe.0,
                word.as_ptr(),
                word.len() as u32,
                &mut written,
                null_mut(),
            )
        };
        return if wrote != 0 {
            Ok(())
        } else {
            Err("the running app's pipe took nothing".into())
        };
    }
    Err("the running app stayed busy".into())
}

/// Hands each request a later start writes to `take`, on a thread of its own, for as long as the app runs. A next instance
/// opens before a request is read, so a start always finds the pipe and never takes its first instance.
pub fn serve(server: Server, take: impl Fn(Request) + Send + 'static) {
    std::thread::spawn(move || {
        let Server { name, mut pipe } = server;
        loop {
            // A start that wrote and closed before this call came is still there to read: Windows says the pipe is
            // connected, or, once the start has closed it, that it's being closed.
            // SAFETY: the pipe is open, and a null overlapped makes the call wait for a start.
            let connected = unsafe { ConnectNamedPipe(pipe.0, null_mut()) } != 0
                // SAFETY: the call reads the thread's last error.
                || matches!(unsafe { GetLastError() }, ERROR_PIPE_CONNECTED | ERROR_NO_DATA);
            let Some(next) = instance(&name, false) else {
                crate::log::line("the app's pipe took no more starts");
                return;
            };
            if connected {
                let mut bytes = [0u8; LONGEST];
                let mut read = 0;
                // SAFETY: the buffer outlives the call, which writes at most its length.
                let ok = unsafe {
                    ReadFile(
                        pipe.0,
                        bytes.as_mut_ptr(),
                        bytes.len() as u32,
                        &mut read,
                        null_mut(),
                    )
                } != 0;
                let word = String::from_utf8_lossy(&bytes[..read as usize]);
                match Request::from_word(word.trim()) {
                    Some(request) if ok => take(request),
                    _ => crate::log::line(&format!(
                        "a second start asked for something this app doesn't know: {word:?}"
                    )),
                }
                // SAFETY: the pipe is open.
                unsafe { DisconnectNamedPipe(pipe.0) };
            }
            pipe = next;
        }
    });
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::time::Duration;

    use super::*;

    fn folder(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("dualinput-one-app-{name}-{}", std::process::id()))
    }

    #[test]
    fn a_second_start_hands_its_request_to_the_first() {
        let data = folder("hand");
        let Ok(Claim::First(server)) = claim(&data, Request::Tray) else {
            panic!("the first start should take the pipe");
        };
        let (heard, hear) = mpsc::channel();
        serve(server, move |request| {
            let _ = heard.send(request);
        });
        for request in [
            Request::Open(Screen::Main),
            Request::Tray,
            Request::Open(Screen::Welcome),
        ] {
            assert!(matches!(claim(&data, request), Ok(Claim::Handed)));
            assert_eq!(hear.recv_timeout(Duration::from_secs(5)), Ok(request));
        }
    }

    #[test]
    fn apps_on_two_data_folders_each_run() {
        assert!(matches!(
            claim(&folder("one"), Request::Tray),
            Ok(Claim::First(_))
        ));
        assert!(matches!(
            claim(&folder("two"), Request::Tray),
            Ok(Claim::First(_))
        ));
    }

    #[test]
    fn the_pipe_is_named_for_the_folder_whatever_its_case() {
        assert_eq!(
            pipe_name(Path::new(r"C:\Users\Pilot\AppData\Roaming\DualInput")),
            pipe_name(Path::new(r"c:\users\pilot\appdata\roaming\dualinput"))
        );
        assert_ne!(pipe_name(Path::new(r"C:\a")), pipe_name(Path::new(r"C:\b")));
    }
}
