//! The core's data folder, `%APPDATA%\DualInput\`, which holds the pilot's settings, the
//! session file, and each run's recording, and of which one core runs at a time.

use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use windows_sys::Win32::Foundation::{CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, HANDLE};
use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};
use windows_sys::Win32::System::Com::CoTaskMemFree;
use windows_sys::Win32::System::Threading::CreateMutexW;
use windows_sys::Win32::UI::Shell::{
    FOLDERID_RoamingAppData, KF_FLAG_DEFAULT, SHGetKnownFolderPath,
};

/// `%APPDATA%\DualInput\`, outside the folder Velopack installs into, whose contents an
/// uninstall deletes (record/areas/install/01-installing-and-updating.md, "On disk").
pub fn default_folder() -> PathBuf {
    let mut path = std::ptr::null_mut();
    // SAFETY: SHGetKnownFolderPath writes a string it allocated to `path`, which we read up to
    // its terminating zero and then free with CoTaskMemFree, as its documentation asks.
    let roaming = unsafe {
        let result = SHGetKnownFolderPath(
            &FOLDERID_RoamingAppData,
            KF_FLAG_DEFAULT as u32,
            std::ptr::null_mut(),
            &mut path,
        );
        let roaming = (result >= 0).then(|| {
            let length = (0..).take_while(|&i| *path.add(i) != 0).count();
            String::from_utf16_lossy(std::slice::from_raw_parts(path, length))
        });
        CoTaskMemFree(path as _);
        roaming
    };
    PathBuf::from(roaming.expect("Windows should give every account a roaming AppData folder"))
        .join("DualInput")
}

/// The named mutex that marks a data folder as taken. Windows releases it when the process
/// ends, however it ends.
pub struct Lock(HANDLE);

// SAFETY: a mutex's handle may be closed from any thread.
unsafe impl Send for Lock {}

impl Drop for Lock {
    fn drop(&mut self) {
        // SAFETY: the handle came from CreateMutexW and is closed once.
        unsafe { CloseHandle(self.0) };
    }
}

/// Takes the data folder, or returns `None` when another core holds it, so two cores
/// started at once for one folder can't both run (record/areas/core/01-loop-and-edge.md,
/// "Starting and stopping"). The mutex is named for the folder's full path, hashed, since a
/// mutex's name can't hold a `\` and stops at 260 characters.
pub fn lock(folder: &Path) -> Option<Lock> {
    let full = std::fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
    let digest = Sha256::digest(full.to_string_lossy().to_lowercase().as_bytes());
    let hex: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
    let name: Vec<u16> = format!(r"Local\DualInput-core-{hex}")
        .encode_utf16()
        .chain([0])
        .collect();
    // SAFETY: `name` is a zero-terminated UTF-16 string that outlives the call.
    let (handle, error) = unsafe {
        let handle = CreateMutexW(std::ptr::null(), 0, name.as_ptr());
        (handle, GetLastError())
    };
    if handle.is_null() {
        return None;
    }
    let lock = Lock(handle);
    (error != ERROR_ALREADY_EXISTS).then_some(lock)
}

/// A new folder for this run's recording and log, in `recordings\`, named by the run's
/// start in UTC, as in `2026-10-20_14-02-11`, with `-2` and on after it for a second run
/// within the same second (record/areas/recording/01-recording-and-bug-reports.md, "The
/// files").
pub fn run_folder(data: &Path) -> std::io::Result<PathBuf> {
    let recordings = data.join("recordings");
    std::fs::create_dir_all(&recordings)?;
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let name = utc(seconds);
    for n in 1.. {
        let folder = if n == 1 {
            recordings.join(&name)
        } else {
            recordings.join(format!("{name}-{n}"))
        };
        match std::fs::create_dir(&folder) {
            Ok(()) => return Ok(folder),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    unreachable!("some n makes a folder that doesn't exist yet")
}

/// Creates one of a run's files, `inputs.zst` or `log.txt`, which other programs may read
/// and write but not delete while the core holds it. A delete of the run in progress then
/// fails rather than taking its recording and log from under the core, should the recording
/// crate's guess at which run is in progress be wrong; std opens a file that may be deleted
/// unless told otherwise (documented, `std::os::windows::fs::OpenOptionsExt::share_mode`).
pub fn create_run_file(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(path)
}

/// Seconds since 1970 in UTC, as `YYYY-MM-DD_HH-MM-SS`, by Howard Hinnant's
/// `civil_from_days` ("chrono-Compatible Low-Level Date Algorithms").
fn utc(seconds: u64) -> String {
    let days = seconds / 86_400;
    let time = seconds % 86_400;
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}_{:02}-{:02}-{:02}",
        time / 3_600,
        time / 60 % 60,
        time % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_a_run_by_its_start_in_utc() {
        assert_eq!(utc(0), "1970-01-01_00-00-00");
        assert_eq!(utc(951_782_400), "2000-02-29_00-00-00");
        assert_eq!(utc(1_792_504_931), "2026-10-20_14-02-11");
    }

    #[test]
    fn a_run_file_cant_be_deleted_while_open() {
        let path = std::env::temp_dir().join(format!("dualinput-run-file-{}", std::process::id()));
        let file = create_run_file(&path).unwrap();
        assert!(
            std::fs::remove_file(&path).is_err(),
            "the open file was deleted"
        );
        drop(file);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn one_core_holds_a_data_folder() {
        let folder = std::env::temp_dir().join(format!("dualinput-lock-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let held = lock(&folder).expect("nobody holds a new folder");
        assert!(
            lock(&folder).is_none(),
            "a second core finds the folder taken"
        );
        drop(held);
        assert!(
            lock(&folder).is_some(),
            "the folder is free once its core has gone"
        );
        std::fs::remove_dir(&folder).unwrap();
    }
}
