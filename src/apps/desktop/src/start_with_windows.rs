//! Starting with Windows, a value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` that runs the desktop app with
//! `--tray`, so it comes up as a tray icon alone (record/areas/install/01-installing-and-updating.md, "One program from
//! login"). Windows' own switch for the value sits apart, under `StartupApproved`, and following it is unsettled, so this
//! reads and writes the value alone.

use windows_sys::Win32::Foundation::ERROR_SUCCESS;
use windows_sys::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_SZ, RegCloseKey, RegDeleteValueW,
    RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE: &str = "Dual Input";

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The Run key, closed when this goes.
struct RunKey(HKEY);

impl RunKey {
    fn open(access: u32) -> Option<Self> {
        let mut key = std::ptr::null_mut();
        // SAFETY: the path is a NUL-terminated string that outlives the call, and the call writes the handle it's given.
        let opened = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                wide(RUN_KEY).as_ptr(),
                0,
                access,
                &mut key,
            )
        };
        (opened == ERROR_SUCCESS).then_some(Self(key))
    }
}

impl Drop for RunKey {
    fn drop(&mut self) {
        // SAFETY: the handle came from RegOpenKeyExW, and nothing else closes it.
        unsafe { RegCloseKey(self.0) };
    }
}

/// What the value runs: this program, with `--tray`.
fn command() -> Result<String, String> {
    let program = std::env::current_exe().map_err(|error| error.to_string())?;
    Ok(format!("\"{}\" --tray", program.display()))
}

/// What the value holds, if it exists and fits a path's longest length.
fn value() -> Option<String> {
    let key = RunKey::open(KEY_READ)?;
    let mut text = [0u16; 1024];
    let mut bytes = u32::try_from(size_of_val(&text)).ok()?;
    // SAFETY: the name is a NUL-terminated string that outlives the call, and `bytes` is the length of the buffer it writes to.
    let read = unsafe {
        RegQueryValueExW(
            key.0,
            wide(VALUE).as_ptr(),
            std::ptr::null(),
            std::ptr::null_mut(),
            text.as_mut_ptr().cast(),
            &mut bytes,
        )
    };
    if read != ERROR_SUCCESS {
        return None;
    }
    let held = &text[..bytes as usize / 2];
    let end = held
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(held.len());
    Some(String::from_utf16_lossy(&held[..end]))
}

/// Whether Windows would run this program: a development build, under a worktree that may be gone, has written the value
/// for itself, so another's value says nothing about this one.
pub fn is_on() -> bool {
    value().is_some_and(|held| command().is_ok_and(|mine| mine == held))
}

/// Writes the value to run this program with `--tray`, or deletes it. It says so if Windows wouldn't, so the switch shows what holds.
pub fn set(on: bool) -> Result<(), String> {
    let key = RunKey::open(KEY_SET_VALUE).ok_or("the Run key wouldn't open")?;
    let name = wide(VALUE);
    if !on {
        // SAFETY: the name is a NUL-terminated string that outlives the call.
        let deleted = unsafe { RegDeleteValueW(key.0, name.as_ptr()) };
        return if deleted == ERROR_SUCCESS
            || deleted == windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND
        {
            Ok(())
        } else {
            Err(format!("Windows answered {deleted}"))
        };
    }
    let command = wide(&command()?);
    let bytes = u32::try_from(command.len() * 2).map_err(|error| error.to_string())?;
    // SAFETY: the name and the command are NUL-terminated strings that outlive the call, and `bytes` is the command's length in bytes.
    let written = unsafe {
        RegSetValueExW(
            key.0,
            name.as_ptr(),
            0,
            REG_SZ,
            command.as_ptr().cast(),
            bytes,
        )
    };
    if written == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!("Windows answered {written}"))
    }
}
