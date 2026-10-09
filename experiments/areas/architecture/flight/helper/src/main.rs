// p08's helper: the take-control input the core's helper would read, through
// Raw Input in sink mode, which gets a copy of input with any window in front.
// p02's helper got only keys another program sent, with its own window behind
// another (measured on our development machine, 2026-10-08,
// record/areas/architecture/log.md); this one runs while a person presses keys
// and a flight-hardware button with the sim in front.
//
//   p08-helper <seconds>
//
// It reports on stdout, one tab-separated line each, the first field the time
// in whole µs on QueryPerformanceCounter, as p08's client stamps:
//   KEY      <virtual key> <down|up> <device> <the program in front>
//   BUTTONS  <device> <the buttons now down, by number> <the program in front>
// A HID device sends reports whether or not anyone touches it, 1,447 in 4s from
// four untouched devices in p02's run, so a BUTTONS line comes only when the set
// of buttons down changes. Devices are named by their vendor and product IDs.

#![windows_subsystem = "windows"]

use std::collections::HashMap;
use std::io::Write;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Devices::HumanInterfaceDevice::{HidP_GetUsages, HidP_Input, HIDP_STATUS_SUCCESS, HID_USAGE_PAGE_BUTTON};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows_sys::Win32::UI::Input::{GetRawInputData, GetRawInputDeviceInfoW, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK, RIDI_DEVICENAME, RIDI_PREPARSEDDATA, RID_INPUT, RIM_TYPEHID, RIM_TYPEKEYBOARD};
use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, SetTimer, MSG, RI_KEY_BREAK, WM_INPUT, WM_TIMER};

fn now(freq: i64) -> u64 {
    let mut t = 0i64;
    unsafe { QueryPerformanceCounter(&mut t) };
    ((t as u128) * 1_000_000 / freq as u128) as u64
}

fn say(freq: i64, line: &str) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{}\t{line}", now(freq));
    let _ = out.flush();
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

// The program in front, by its file name alone, since its path can hold a home
// folder (CLAUDE.md, Nothing personal in the tree).
unsafe fn foreground() -> String {
    let mut pid = 0u32;
    GetWindowThreadProcessId(GetForegroundWindow(), &mut pid);
    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if process.is_null() {
        return format!("pid {pid}");
    }
    let mut buf = [0u16; 512];
    let mut len = buf.len() as u32;
    let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
    CloseHandle(process);
    if ok == 0 {
        return format!("pid {pid}");
    }
    let path = String::from_utf16_lossy(&buf[..len as usize]);
    path.rsplit('\\').next().unwrap_or("?").to_string()
}

// A device's name is a path such as \\?\HID#VID_044F&PID_B10A&...; its vendor
// and product IDs are enough to tell devices apart.
unsafe fn device_name(device: HANDLE) -> String {
    let mut len = 0u32;
    GetRawInputDeviceInfoW(device, RIDI_DEVICENAME, null_mut(), &mut len);
    let mut buf = vec![0u16; len as usize + 1];
    if GetRawInputDeviceInfoW(device, RIDI_DEVICENAME, buf.as_mut_ptr().cast(), &mut len) == u32::MAX {
        return "?".into();
    }
    let name = String::from_utf16_lossy(&buf).to_uppercase();
    let part = |key: &str| name.find(key).map(|i| name[i..].chars().take(key.len() + 4).collect::<String>());
    match (part("VID_"), part("PID_")) {
        (Some(v), Some(p)) => format!("{v}&{p}"),
        _ => "no VID".into(),
    }
}

unsafe fn preparsed(device: HANDLE) -> Option<Vec<u8>> {
    let mut len = 0u32;
    GetRawInputDeviceInfoW(device, RIDI_PREPARSEDDATA, null_mut(), &mut len);
    if len == 0 {
        return None;
    }
    let mut buf = vec![0u8; len as usize];
    if GetRawInputDeviceInfoW(device, RIDI_PREPARSEDDATA, buf.as_mut_ptr().cast(), &mut len) == u32::MAX {
        return None;
    }
    Some(buf)
}

fn main() {
    let secs: u32 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(60);
    let mut freq = 0i64;
    unsafe { QueryPerformanceFrequency(&mut freq) };
    unsafe {
        // Raw Input in sink mode needs a window to deliver to, though it never has the focus.
        let class = wide("STATIC");
        let hwnd = CreateWindowExW(0, class.as_ptr(), class.as_ptr(), 0, 0, 0, 0, 0, null_mut(), null_mut(), null_mut(), null());
        // Generic desktop page: 6 keyboard, 4 joystick, 5 gamepad.
        let devices = [6u16, 4, 5].map(|usage| RAWINPUTDEVICE { usUsagePage: 1, usUsage: usage, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd });
        if RegisterRawInputDevices(devices.as_ptr(), devices.len() as u32, std::mem::size_of::<RAWINPUTDEVICE>() as u32) == 0 {
            say(freq, &format!("ERROR\tRegisterRawInputDevices failed: {}", std::io::Error::last_os_error()));
            std::process::exit(1);
        }
        SetTimer(null_mut(), 0, secs * 1000, None);
        say(freq, "READY");
        let header = std::mem::size_of::<RAWINPUTHEADER>() as u32;
        let mut names: HashMap<isize, String> = HashMap::new();
        let mut parsers: HashMap<isize, Option<Vec<u8>>> = HashMap::new();
        let mut down: HashMap<isize, Vec<u16>> = HashMap::new();
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            if msg.message == WM_TIMER {
                break;
            }
            if msg.message == WM_INPUT {
                let handle = msg.lParam as HRAWINPUT;
                let mut size = 0u32;
                GetRawInputData(handle, RID_INPUT, null_mut(), &mut size, header);
                // u64s, so the buffer is aligned for RAWINPUT.
                let mut buf = vec![0u64; (size as usize + 7) / 8];
                if GetRawInputData(handle, RID_INPUT, buf.as_mut_ptr().cast(), &mut size, header) == size {
                    let raw = &*(buf.as_ptr() as *const RAWINPUT);
                    let device = raw.header.hDevice;
                    let key = device as isize;
                    let name = names.entry(key).or_insert_with(|| device_name(device)).clone();
                    if raw.header.dwType == RIM_TYPEKEYBOARD {
                        let k = raw.data.keyboard;
                        let up = (k.Flags as u32) & RI_KEY_BREAK != 0;
                        say(freq, &format!("KEY\t{:#04x}\t{}\t{name}\t{}", k.VKey, if up { "up" } else { "down" }, foreground()));
                    } else if raw.header.dwType == RIM_TYPEHID {
                        if let Some(parser) = parsers.entry(key).or_insert_with(|| preparsed(device)).as_ref() {
                        let hid = raw.data.hid;
                        let report_len = hid.dwSizeHid as usize;
                        let base = std::ptr::addr_of!(raw.data.hid.bRawData) as *const u8 as *mut u8;
                        for r in 0..hid.dwCount as usize {
                            let mut usages = [0u16; 128];
                            let mut count = usages.len() as u32;
                            let status = HidP_GetUsages(HidP_Input, HID_USAGE_PAGE_BUTTON, 0, usages.as_mut_ptr(), &mut count, parser.as_ptr() as isize, base.add(r * report_len), report_len as u32);
                            if status != HIDP_STATUS_SUCCESS {
                                continue;
                            }
                            let mut now_down: Vec<u16> = usages[..count as usize].to_vec();
                            now_down.sort_unstable();
                            let before = down.entry(key).or_default();
                            if *before != now_down {
                                let list: Vec<String> = now_down.iter().map(|u| u.to_string()).collect();
                                say(freq, &format!("BUTTONS\t{name}\t{}\t{}", if list.is_empty() { "none".into() } else { list.join(",") }, foreground()));
                                *before = now_down;
                            }
                        }
                        }
                    }
                }
            }
            DispatchMessageW(&msg);
        }
    }
    say(freq, "DONE");
}
