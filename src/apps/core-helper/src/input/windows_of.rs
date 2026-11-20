//! The sim's windows, found by class and title rather than by its process, so the helper
//! needs nothing from the core to find them (record/areas/core/04-core-helper.md, "Raw
//! Input"). The sim's main window and each popped-out display is a top-level window of class
//! `AceApp`, and the main window's title starts `Microsoft Flight Simulator 2024` (measured on
//! MSFS 2024 1.8.16.0, record/learn/foundations/06-03-display-kinds-input-and-pop-outs.md,
//! "Pop-out windows").

use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetClientRect, GetCursorPos, GetForegroundWindow, GetWindowTextW,
    IsWindow,
};
use windows::core::BOOL;

use super::mouse;
use crate::clock;

/// tools/profile-author's screen.rs finds the main window by the same class and title, so
/// change both together.
const CLASS: &str = "AceApp";
const MAIN_TITLE: &str = "Microsoft Flight Simulator 2024";

/// How often, at most, the helper looks for the sim's main window while it has none, in µs,
/// since a mouse can report 1,000 times a second.
const LOOK_EVERY: u64 = 1_000_000;

fn class_of(window: HWND) -> String {
    let mut class = [0u16; 64];
    // SAFETY: GetClassNameW writes at most the buffer's length.
    let length = unsafe { GetClassNameW(window, &mut class) };
    String::from_utf16_lossy(&class[..length.max(0) as usize])
}

fn title_of(window: HWND) -> String {
    let mut title = [0u16; 128];
    // SAFETY: GetWindowTextW writes at most the buffer's length.
    let length = unsafe { GetWindowTextW(window, &mut title) };
    String::from_utf16_lossy(&title[..length.max(0) as usize])
}

/// Whether a window of the sim is in front: its main window or a popped-out display.
pub fn sim_in_front() -> bool {
    // SAFETY: GetForegroundWindow takes nothing.
    let front = unsafe { GetForegroundWindow() };
    !front.is_invalid() && class_of(front) == CLASS
}

/// The cursor's place in the sim's main window, and its client area's size.
pub struct Place {
    pub x: f32,
    pub y: f32,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
pub struct SimWindow {
    window: Option<isize>,
    looked: u64,
}

impl SimWindow {
    /// The cursor's place, while the sim's main window is itself in front.
    pub fn place_if_in_front(&mut self) -> Option<Place> {
        let window = self.find()?;
        // SAFETY: GetForegroundWindow takes nothing.
        if unsafe { GetForegroundWindow() } != window {
            return None;
        }
        let mut cursor = POINT::default();
        let mut area = RECT::default();
        // SAFETY: each call writes the one struct it's given, for a window that exists.
        unsafe {
            GetCursorPos(&mut cursor).ok()?;
            if !ScreenToClient(window, &mut cursor).as_bool() {
                return None;
            }
            GetClientRect(window, &mut area).ok()?;
        }
        let width = (area.right - area.left).max(0) as u32;
        let height = (area.bottom - area.top).max(0) as u32;
        let (x, y) = mouse::place(cursor.x, cursor.y, width, height);
        Some(Place {
            x,
            y,
            width,
            height,
        })
    }

    fn find(&mut self) -> Option<HWND> {
        if let Some(window) = self.window.map(|w| HWND(w as _)) {
            // SAFETY: IsWindow takes any handle.
            if unsafe { IsWindow(Some(window)) }.as_bool() {
                return Some(window);
            }
            self.window = None;
        }
        let now = clock::now();
        if self.looked != 0 && now.saturating_sub(self.looked) < LOOK_EVERY {
            return None;
        }
        self.looked = now;
        let mut found: isize = 0;
        // SAFETY: the callback writes the window it finds through the pointer EnumWindows
        // hands it, which lives on this stack frame until EnumWindows returns.
        let _ = unsafe { EnumWindows(Some(each), LPARAM(&mut found as *mut isize as isize)) };
        self.window = (found != 0).then_some(found);
        self.window.map(|w| HWND(w as _))
    }
}

unsafe extern "system" fn each(window: HWND, found: LPARAM) -> BOOL {
    if class_of(window) == CLASS && title_of(window).starts_with(MAIN_TITLE) {
        // SAFETY: `found` points at the isize `find` gave EnumWindows.
        unsafe { *(found.0 as *mut isize) = window.0 as isize };
        return BOOL(0);
    }
    BOOL(1)
}
