//! The desktop app's log, `%APPDATA%\DualInput\app\desktop.log`, which is what a pilot can send us: a release has no console,
//! so what the app reports would otherwise go nowhere, and a registry refusal or a held port would leave no trace.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use windows_sys::Win32::Globalization::{GetTimeFormatEx, TIME_NOSECONDS};
use windows_sys::Win32::System::SystemInformation::GetLocalTime;

/// A log past this starts over when the app next starts, so it never grows without end.
const MOST_BYTES: u64 = 1024 * 1024;
const NAME: &str = "desktop.log";

static FILE: OnceLock<Mutex<File>> = OnceLock::new();

fn open(folder: &Path) -> io::Result<File> {
    fs::create_dir_all(folder)?;
    let path = folder.join(NAME);
    if fs::metadata(&path).is_ok_and(|file| file.len() > MOST_BYTES) {
        fs::remove_file(&path)?;
    }
    OpenOptions::new().create(true).append(true).open(path)
}

/// Opens the log in the app's folder, and sends a panic there too, since one on a task of the port's would otherwise end only
/// that task, with no word. Velopack's own lines come here too, since a failed update is what a pilot most needs to send us.
pub fn start() {
    match open(&crate::places::app_folder()) {
        Ok(file) => {
            let _ = FILE.set(Mutex::new(file));
        }
        Err(error) => eprintln!("the log didn't open: {error}"),
    }
    std::panic::set_hook(Box::new(|panic| line(&format!("a panic: {panic}"))));
    if ::log::set_logger(&VELOPACK).is_ok() {
        ::log::set_max_level(::log::LevelFilter::Info);
    }
}

/// Velopack's lines, which it writes through the `log` crate, at info and above.
struct Velopack;

static VELOPACK: Velopack = Velopack;

impl ::log::Log for Velopack {
    fn enabled(&self, metadata: &::log::Metadata) -> bool {
        metadata.level() <= ::log::Level::Info
    }

    fn log(&self, record: &::log::Record) {
        if self.enabled(record.metadata()) {
            line(&format!("velopack: {}", record.args()));
        }
    }

    fn flush(&self) {}
}

/// The time on the pilot's clock, as they'd read it beside what happened.
fn now() -> String {
    // SAFETY: an all-zero SYSTEMTIME is valid, and the call only writes to the one it's given.
    let time = unsafe {
        let mut time = std::mem::zeroed();
        GetLocalTime(&mut time);
        time
    };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        time.wYear, time.wMonth, time.wDay, time.wHour, time.wMinute, time.wSecond
    )
}

/// When an update check finished, in the pilot's words, as "Up to date, checked at 14:05" shows it: the time in the format
/// Windows gives the pilot's locale.
pub fn checked_at() -> String {
    let mut text = [0u16; 64];
    // SAFETY: null asks for the pilot's locale, the current time, and its default format, and the call writes at most the
    // buffer's length.
    let written = unsafe {
        GetTimeFormatEx(
            std::ptr::null(),
            TIME_NOSECONDS,
            std::ptr::null(),
            std::ptr::null(),
            text.as_mut_ptr(),
            text.len() as i32,
        )
    };
    let time = match written {
        // The count includes the terminating zero.
        1.. => String::from_utf16_lossy(&text[..written as usize - 1]),
        _ => now()[11..16].to_string(),
    };
    format!("at {time}")
}

/// One line in the log, and on a debug build's console.
pub fn line(message: &str) {
    let text = format!("{} {message}", now());
    eprintln!("{text}");
    if let Some(file) = FILE.get()
        && let Ok(mut file) = file.lock()
    {
        let _ = writeln!(file, "{text}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> std::path::PathBuf {
        let folder =
            std::env::temp_dir().join(format!("dualinput-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        folder
    }

    #[test]
    fn a_log_keeps_what_it_holds_until_it_passes_its_limit() {
        let folder = folder("limit");
        writeln!(open(&folder).unwrap(), "first").unwrap();
        writeln!(open(&folder).unwrap(), "second").unwrap();
        let path = folder.join(NAME);
        assert_eq!(fs::read_to_string(&path).unwrap().lines().count(), 2);

        fs::write(&path, vec![b'x'; MOST_BYTES as usize + 1]).unwrap();
        writeln!(open(&folder).unwrap(), "fresh").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "fresh\n");
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_line_starts_with_the_date_and_time() {
        let stamp = now();
        assert_eq!(stamp.len(), "2026-11-02 11:03:00".len());
        assert_eq!(&stamp[4..5], "-");
        assert_eq!(&stamp[13..14], ":");
    }
}
