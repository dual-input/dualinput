//! Closing the sim and starting it again, for the EFB app's Install and restart and its Restart the sim, both of which leave
//! the pilot where the sim starts (record/areas/interface/decisions.md, "The desktop app tells the EFB app about updates and
//! the firewall over a fixed local port"). The Steam edition closed on the window message, asking the pilot nothing, and
//! started again through Steam (measured on MSFS 2024, 2026-11-10, record/areas/install/log.md); the Microsoft Store edition
//! is unverified until a run does each.

use std::path::Path;
use std::ptr::null;

use windows_sys::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GW_OWNER, GetWindow, GetWindowThreadProcessId, IsWindowVisible, PostMessageW,
    SW_SHOWNORMAL, WM_CLOSE,
};

/// Steam's address that starts MSFS 2024, which Steam's app ID for it names.
const STEAM: &str = "steam://rungameid/2537590";
/// The Microsoft Store edition's app, by its package family name and app ID (unverified: no run has started it this way).
const STORE: &str = r"shell:AppsFolder\Microsoft.Limitless_8wekyb3d8bbwe!App";

/// Asks the sim, the process `id`, to close, as its window's close button does, so it saves and exits by its own path. It
/// says whether it found a window to ask.
pub fn close(id: u32) -> bool {
    struct Search {
        id: u32,
        found: Vec<HWND>,
    }
    unsafe extern "system" fn each(window: HWND, search: LPARAM) -> i32 {
        // SAFETY: `search` is the pointer `close` passed, to a Search that outlives the walk.
        let search = unsafe { &mut *(search as *mut Search) };
        let mut owner = 0;
        // SAFETY: the window came from the walk, and the call writes the ID it's given.
        unsafe { GetWindowThreadProcessId(window, &mut owner) };
        // SAFETY: as above.
        let top = unsafe { GetWindow(window, GW_OWNER) }.is_null();
        // SAFETY: as above.
        if owner == search.id && top && unsafe { IsWindowVisible(window) } != 0 {
            search.found.push(window);
        }
        1
    }
    let mut search = Search {
        id,
        found: Vec::new(),
    };
    // SAFETY: the callback reads the Search through the pointer only during the walk.
    unsafe { EnumWindows(Some(each), &raw mut search as LPARAM) };
    for &window in &search.found {
        // SAFETY: a posted message takes the window and plain values.
        unsafe { PostMessageW(window, WM_CLOSE, 0 as WPARAM, 0 as LPARAM) };
    }
    !search.found.is_empty()
}

/// Starts the sim that ran from `program`: Steam's edition through Steam, so Steam's own checks run, the Store's through its
/// app, and any other by its program.
pub fn start(program: &Path) {
    let path = program.to_string_lossy().to_lowercase();
    let target = if path.contains(r"\steamapps\") {
        STEAM.to_string()
    } else if path.contains(r"\windowsapps\") {
        STORE.to_string()
    } else {
        program.to_string_lossy().into_owned()
    };
    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(std::iter::once(0)).collect() };
    let (verb, file) = (wide("open"), wide(&target));
    // SAFETY: both strings are NUL-terminated and outlive the call, and a null window, parameters, and folder are allowed.
    let done = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW gives a number over 32 when it worked.
    if (done as isize) <= 32 {
        crate::log::line(&format!(
            "the sim didn't start from {target}: Windows answered {}",
            done as isize
        ));
    } else {
        crate::log::line(&format!("started the sim from {target}"));
    }
}
