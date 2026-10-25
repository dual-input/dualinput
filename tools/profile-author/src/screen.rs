//! What the tool reads beside the sim: the cursor's place in the sim's main window, Page Down
//! and Page Up, and the clock; and the beeps it plays, since the author's eyes are on the sim.

use std::time::Duration;

use windows_sys::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows_sys::Win32::Graphics::Gdi::ScreenToClient;
use windows_sys::Win32::System::Diagnostics::Debug::Beep;
use windows_sys::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_NEXT, VK_PRIOR};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetClientRect, GetCursorPos, GetForegroundWindow, GetWindowTextW,
};
use windows_sys::core::BOOL;

/// The sim's main window is a top-level window of class `AceApp` whose title starts
/// `Microsoft Flight Simulator 2024`, as the core helper finds it in
/// src/apps/core-helper/src/input/windows_of.rs, so change both together.
const CLASS: &str = "AceApp";
const MAIN_TITLE: &str = "Microsoft Flight Simulator 2024";

/// How often the keys are read. Our guided probes read them every 20ms and missed no press,
/// where FS Copilot's exerciser, reading every 250ms, missed a 120ms tap (read in
/// experiments/tools/guide.mjs; FS Copilot fork, record/exerciser/docs/log.md).
const POLL: Duration = Duration::from_millis(15);

/// The cursor's place in the sim's main window: −1 to 1 right and up across its client area,
/// as the core helper gives it, and that area's size in pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cursor {
    pub x: f32,
    pub y: f32,
    pub width: u32,
    pub height: u32,
}

impl Cursor {
    /// The view's width for each unit of its height, which the ray's field of view needs.
    pub fn aspect(&self) -> f32 {
        if self.height == 0 {
            1.0
        } else {
            self.width as f32 / self.height as f32
        }
    }

    pub fn over_window(&self) -> bool {
        (-1.0..=1.0).contains(&self.x) && (-1.0..=1.0).contains(&self.y)
    }
}

/// The cursor's place in a client area `width` by `height` pixels, from its pixel in that area,
/// by the core helper's `mouse::place` in src/apps/core-helper/src/input/mouse.rs, so change
/// both together.
fn place(x: i32, y: i32, width: u32, height: u32) -> (f32, f32) {
    let across = |p: i32, size: u32| {
        if size == 0 {
            0.0
        } else {
            2.0 * p as f32 / size as f32 - 1.0
        }
    };
    (across(x, width), -across(y, height))
}

/// The cursor's place now, or `None` while the sim has no main window.
pub fn cursor() -> Option<Cursor> {
    let window = main_window()?;
    let mut point = POINT { x: 0, y: 0 };
    let mut area = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    // SAFETY: each call writes the one struct it's given, for a window that exists.
    unsafe {
        if GetCursorPos(&mut point) == 0
            || ScreenToClient(window, &mut point) == 0
            || GetClientRect(window, &mut area) == 0
        {
            return None;
        }
    }
    let width = (area.right - area.left).max(0) as u32;
    let height = (area.bottom - area.top).max(0) as u32;
    let (x, y) = place(point.x, point.y, width, height);
    Some(Cursor {
        x,
        y,
        width,
        height,
    })
}

/// Whether a window of the sim is in front, so Page Down in a terminal, which scrolls it,
/// marks nothing.
pub fn sim_in_front() -> bool {
    // SAFETY: GetForegroundWindow takes nothing.
    let front = unsafe { GetForegroundWindow() };
    !front.is_null() && class_of(front) == CLASS
}

fn main_window() -> Option<HWND> {
    let mut found: HWND = std::ptr::null_mut();
    // SAFETY: the callback writes the window it finds through the pointer EnumWindows hands
    // it, which lives on this stack frame until EnumWindows returns.
    unsafe { EnumWindows(Some(each), &mut found as *mut HWND as LPARAM) };
    (!found.is_null()).then_some(found)
}

unsafe extern "system" fn each(window: HWND, found: LPARAM) -> BOOL {
    if class_of(window) == CLASS && title_of(window).starts_with(MAIN_TITLE) {
        // SAFETY: `found` points at the HWND `main_window` gave EnumWindows.
        unsafe { *(found as *mut HWND) = window };
        return 0;
    }
    1
}

fn class_of(window: HWND) -> String {
    let mut class = [0u16; 64];
    // SAFETY: GetClassNameW writes at most the buffer's length.
    let length = unsafe { GetClassNameW(window, class.as_mut_ptr(), class.len() as i32) };
    String::from_utf16_lossy(&class[..length.max(0) as usize])
}

fn title_of(window: HWND) -> String {
    let mut title = [0u16; 128];
    // SAFETY: GetWindowTextW writes at most the buffer's length.
    let length = unsafe { GetWindowTextW(window, title.as_mut_ptr(), title.len() as i32) };
    String::from_utf16_lossy(&title[..length.max(0) as usize])
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    /// Page Down.
    Mark,
    /// Page Up.
    Skip,
}

/// Reads Page Down and Page Up on a thread of its own, and hands up each press with whether
/// the sim was in front for it. `GetAsyncKeyState` reads a key without taking it, so the sim
/// sees the press too, and End stays out, since it switches to the outside camera on our
/// development machine (read in experiments/tools/guide.mjs).
pub fn watch_keys(mut press: impl FnMut(Key, bool) + Send + 'static) {
    std::thread::spawn(move || {
        let mut down = [false; 2];
        loop {
            for (i, (key, code)) in [(Key::Mark, VK_NEXT), (Key::Skip, VK_PRIOR)]
                .into_iter()
                .enumerate()
            {
                // SAFETY: GetAsyncKeyState takes any key code.
                let now = unsafe { GetAsyncKeyState(i32::from(code)) } as u16 & 0x8000 != 0;
                if now && !down[i] {
                    press(key, sim_in_front());
                }
                down[i] = now;
            }
            std::thread::sleep(POLL);
        }
    });
}

/// A short tone, high for a mark and low for a press that marked nothing, on a thread of its
/// own, since `Beep` returns only once the tone ends.
pub fn beep(high: bool) {
    let frequency = if high { 1_320 } else { 330 };
    std::thread::spawn(move || {
        // SAFETY: Beep takes any frequency and length.
        unsafe { Beep(frequency, 90) };
    });
}

/// Now, in µs on the PC's performance counter, the clock `Figure`'s slot header carries, as the
/// core's `clock::now` in src/apps/core/src/clock.rs reads it, so change both together.
pub fn now() -> u64 {
    let (mut ticks, mut frequency) = (0, 0);
    // SAFETY: each call writes one i64 to the pointer it's given.
    unsafe {
        QueryPerformanceCounter(&mut ticks);
        QueryPerformanceFrequency(&mut frequency);
    }
    let micros =
        u128::from(ticks.unsigned_abs()) * 1_000_000 / u128::from(frequency.unsigned_abs().max(1));
    u64::try_from(micros).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cursors_place_runs_from_minus_1_to_1_right_and_up() {
        assert_eq!(place(0, 0, 1920, 1080), (-1.0, 1.0));
        assert_eq!(place(960, 540, 1920, 1080), (0.0, 0.0));
        let c = Cursor {
            x: 1.2,
            y: 0.0,
            width: 1920,
            height: 1080,
        };
        assert!(!c.over_window());
        assert!((c.aspect() - 16.0 / 9.0).abs() < 1e-6);
    }
}
