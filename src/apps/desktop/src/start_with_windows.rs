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

/// Whether the value exists.
pub fn is_on() -> bool {
    let Some(key) = RunKey::open(KEY_READ) else {
        return false;
    };
    // SAFETY: the name is a NUL-terminated string that outlives the call, and null out-pointers ask only whether it exists.
    let found = unsafe {
        RegQueryValueExW(
            key.0,
            wide(VALUE).as_ptr(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    found == ERROR_SUCCESS
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
    let program = std::env::current_exe().map_err(|error| error.to_string())?;
    let command = wide(&format!("\"{}\" --tray", program.display()));
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
