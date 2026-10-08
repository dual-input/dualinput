// A tray icon and nothing else, through Shell_NotifyIconW, for p01. Prints
// TRAY once the icon is in place.
#![windows_subsystem = "windows"]

use std::io::Write;
use std::ptr::null;
use windows_sys::Win32::UI::Shell::{Shell_NotifyIconW, NIF_ICON, NIF_TIP, NIM_ADD, NOTIFYICONDATAW};
use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DispatchMessageW, GetMessageW, LoadIconW, IDI_APPLICATION, MSG};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

fn main() {
    unsafe {
        // The predefined STATIC class needs no registration; the icon needs a window to belong to.
        let class = wide("STATIC");
        let name = wide("p01");
        let hwnd = CreateWindowExW(0, class.as_ptr(), name.as_ptr(), 0, 0, 0, 0, 0, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), null());
        let mut data: NOTIFYICONDATAW = std::mem::zeroed();
        data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        data.hWnd = hwnd;
        data.uID = 1;
        data.uFlags = NIF_ICON | NIF_TIP;
        data.hIcon = LoadIconW(std::ptr::null_mut(), IDI_APPLICATION);
        for (i, c) in "p01 tray: Rust".encode_utf16().enumerate() {
            data.szTip[i] = c;
        }
        let mut out = std::io::stdout();
        if Shell_NotifyIconW(NIM_ADD, &data) == 0 {
            let _ = writeln!(out, "ERROR Shell_NotifyIconW");
            return;
        }
        let _ = writeln!(out, "TRAY");
        let _ = out.flush();
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            DispatchMessageW(&msg);
        }
    }
}
