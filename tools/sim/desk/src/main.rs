//! The desk's stand-ins for what surrounds the core helper, for its cases on a desk
//! (record/areas/build/plan.md, "6 The core helper"). tools/sim/core-helper.ts runs it.
//!
//!   desk window <class> <title>
//!       opens a window of that class and title, its client area about 1280 by 720, brings it
//!       to the front, prints `ready <dpi> <width> <height>` with the client area's real size,
//!       since a frame sized at one DPI comes out another size at another, then takes one
//!       command a line on its standard input,
//!       and prints `done` after each, or `not-front` when it couldn't bring its window to the
//!       front first:
//!         front               brings its window to the front
//!         key <keys> <ms>     holds keys by their scan codes for `ms`, repeating the last
//!                             one's press every 33ms as Windows does, then releases them
//!                             last first; `29+67` is Ctrl+F9, and a code of 0xE000 or
//!                             more is an E0 key, as 57373, 0xE01D, is the right Ctrl
//!         down <keys>         presses keys and leaves them down
//!         up <keys>           releases keys
//!         click <x> <y>       clicks the left button at that pixel of its client area
//!   desk front
//!       prints the class and title of the window in front, tab-separated
//!   desk key <keys> <ms>
//!       holds keys into whatever window is in front, as `key` above
//!   desk devices
//!       prints each output device that's connected, its endpoint ID and name tab-separated
//!   desk usage <process> <ms>
//!       prints `cpu <percent of one core> private <MB>`: the process's CPU over `ms`, and its
//!       private working set, as Task Manager's Memory column shows
//!   desk frames <in> <out.wav> <loss percent>
//!       decodes the Opus frames in `in`, one hex line each, losing that share of them, into
//!       a 48 kHz WAV, and prints `frames <n> small <n> level <dBFS> decode <µs a frame>`

use std::io::BufRead;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::ProcessStatus::{
    GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX2,
};
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::WindowsProgramming::QueryProcessCycleTime;
use windows::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForWindow, SetProcessDpiAwarenessContext,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY,
    KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEINPUT,
    SendInput, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AdjustWindowRect, BringWindowToTop, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, CreateWindowExW,
    DefWindowProcW, DispatchMessageW, GetClassNameW, GetClientRect, GetForegroundWindow,
    GetMessageW, GetWindowTextW, GetWindowThreadProcessId, MSG, RegisterClassExW, SW_SHOW,
    SetCursorPos, SetForegroundWindow, ShowWindow, WINDOW_EX_STYLE, WNDCLASSEXW,
    WS_OVERLAPPEDWINDOW,
};
use windows::core::{HSTRING, PCWSTR};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    // SAFETY: SetProcessDpiAwarenessContext takes one of Windows' own contexts.
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let result = match args[..] {
        ["window", class, title] => window(class, title),
        ["front"] => {
            front();
            Ok(())
        }
        ["key", keys, ms] => {
            key(&scans(keys), ms.parse().unwrap_or(0));
            Ok(())
        }
        ["devices"] => devices(),
        ["usage", process, ms] => usage(process, ms),
        ["frames", input, output, loss] => frames(input, output, loss),
        _ => Err("usage: desk window <class> <title> | front | key <keys> <ms> | devices | usage <process> <ms> | frames <in> <out.wav> <loss percent>".into()),
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

unsafe extern "system" fn procedure(window: HWND, message: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    // SAFETY: the window's own messages, handed on as Windows gave them.
    unsafe { DefWindowProcW(window, message, w, l) }
}

fn window(class: &str, title: &str) -> Result<(), String> {
    let (opened, window) = mpsc::channel::<isize>();
    let (class, title) = (HSTRING::from(class), HSTRING::from(title));
    std::thread::spawn(move || {
        // SAFETY: a window class and a window of this thread's, with strings that outlive them.
        unsafe {
            let instance = GetModuleHandleW(None).unwrap_or_default();
            let class_info = WNDCLASSEXW {
                cbSize: size_of::<WNDCLASSEXW>() as u32,
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(procedure),
                hInstance: instance.into(),
                lpszClassName: PCWSTR(class.as_ptr()),
                ..Default::default()
            };
            RegisterClassExW(&class_info);
            let mut area = RECT {
                left: 0,
                top: 0,
                right: 1280,
                bottom: 720,
            };
            let _ = AdjustWindowRect(&mut area, WS_OVERLAPPEDWINDOW, false);
            let Ok(made) = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                PCWSTR(class.as_ptr()),
                PCWSTR(title.as_ptr()),
                WS_OVERLAPPEDWINDOW,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                area.right - area.left,
                area.bottom - area.top,
                None,
                None,
                Some(instance.into()),
                None,
            ) else {
                let _ = opened.send(0);
                return;
            };
            let _ = ShowWindow(made, SW_SHOW);
            let _ = opened.send(made.0 as isize);
            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).as_bool() {
                DispatchMessageW(&message);
            }
        }
    });
    let window = HWND(window.recv().map_err(|e| e.to_string())? as _);
    if window.is_invalid() {
        return Err("the window didn't open".into());
    }
    let front = to_front(window);
    let mut client = RECT::default();
    // SAFETY: GetDpiForWindow and GetClientRect read a window of ours.
    let dpi = unsafe {
        let _ = GetClientRect(window, &mut client);
        GetDpiForWindow(window)
    };
    println!(
        "ready {dpi} {} {}{}",
        client.right - client.left,
        client.bottom - client.top,
        if front { "" } else { " not-front" }
    );
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let words: Vec<&str> = line.split_whitespace().collect();
        if !to_front(window) {
            println!("not-front");
            continue;
        }
        match words[..] {
            ["front"] => {}
            ["key", keys, ms] => key(&scans(keys), ms.parse().unwrap_or(0)),
            ["down", keys] => send(&each(&scans(keys), false)),
            ["up", keys] => send(&each(&scans(keys), true)),
            ["click", x, y] => click(window, x.parse().unwrap_or(0), y.parse().unwrap_or(0)),
            _ => {
                println!("unknown {line}");
                continue;
            }
        }
        println!("done");
    }
    Ok(())
}

/// Brings `window` to the front: Windows lets a thread do it while attached to the input
/// of the thread whose window is in front.
fn to_front(window: HWND) -> bool {
    // SAFETY: each call takes windows and threads that exist, and the attachment is undone.
    unsafe {
        if GetForegroundWindow() == window {
            return true;
        }
        let front = GetWindowThreadProcessId(GetForegroundWindow(), None);
        let me = GetCurrentThreadId();
        let _ = AttachThreadInput(me, front, true);
        let _ = BringWindowToTop(window);
        let _ = SetForegroundWindow(window);
        let _ = AttachThreadInput(me, front, false);
        std::thread::sleep(Duration::from_millis(150));
        GetForegroundWindow() == window
    }
}

fn front() {
    let (mut class, mut title) = ([0u16; 128], [0u16; 256]);
    // SAFETY: each call writes at most its buffer's length, for the window in front.
    let (class_length, title_length) = unsafe {
        let window = GetForegroundWindow();
        (
            GetClassNameW(window, &mut class),
            GetWindowTextW(window, &mut title),
        )
    };
    let text =
        |buffer: &[u16], length: i32| String::from_utf16_lossy(&buffer[..length.max(0) as usize]);
    println!(
        "{}\t{}",
        text(&class, class_length),
        text(&title, title_length)
    );
}

fn send(inputs: &[INPUT]) {
    // SAFETY: whole INPUTs of the size given.
    unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
}

/// The scan codes in `29+67`, each in decimal, where 0xE000 or more is an E0 key.
fn scans(keys: &str) -> Vec<u16> {
    keys.split('+')
        .map(|scan| scan.parse().unwrap_or(0))
        .collect()
}

/// Each key's press, or each one's release, in the order given.
fn each(keys: &[u16], up: bool) -> Vec<INPUT> {
    keys.iter().map(|&scan| key_input(scan, up)).collect()
}

fn key_input(scan: u16, up: bool) -> INPUT {
    let mut flags = KEYEVENTF_SCANCODE;
    if up {
        flags |= KEYEVENTF_KEYUP;
    }
    if scan >= 0xe000 {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: scan & 0xff,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn key(keys: &[u16], ms: u64) {
    let Some(&last) = keys.last() else { return };
    let until = Instant::now() + Duration::from_millis(ms);
    send(&each(keys, false));
    while Instant::now() < until {
        std::thread::sleep(Duration::from_millis(33));
        send(&[key_input(last, false)]);
    }
    let reversed: Vec<u16> = keys.iter().rev().copied().collect();
    send(&each(&reversed, true));
}

fn click(window: HWND, x: i32, y: i32) {
    let mut point = POINT { x, y };
    // SAFETY: ClientToScreen and SetCursorPos take a window of ours and a point.
    unsafe {
        let _ = ClientToScreen(window, &mut point);
        let _ = SetCursorPos(point.x, point.y);
    }
    std::thread::sleep(Duration::from_millis(30));
    let button = |flags| INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dwFlags: flags,
                ..Default::default()
            },
        },
    };
    send(&[button(MOUSEEVENTF_LEFTDOWN)]);
    std::thread::sleep(Duration::from_millis(30));
    send(&[button(MOUSEEVENTF_LEFTUP)]);
}

fn devices() -> Result<(), String> {
    let _ = wasapi::initialize_mta();
    let enumerator = wasapi::DeviceEnumerator::new().map_err(|e| e.to_string())?;
    let devices = enumerator
        .get_device_collection(&wasapi::Direction::Render)
        .map_err(|e| e.to_string())?;
    for device in &devices {
        let device = device.map_err(|e| e.to_string())?;
        let id = device.get_id().map_err(|e| e.to_string())?;
        let name = device.get_friendlyname().map_err(|e| e.to_string())?;
        println!("{id}\t{name}");
    }
    Ok(())
}

fn usage(process: &str, ms: &str) -> Result<(), String> {
    let process: u32 = process.parse().map_err(|_| "a process ID is a number")?;
    let ms: u64 = ms.parse().map_err(|_| "a time is a number of ms")?;
    // SAFETY: a handle that reads the process's times and memory; Windows closes it at exit.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process) }
        .map_err(|e| e.to_string())?;
    // A process's cycles, which Windows counts exactly, against the time-stamp counter's,
    // which tick at the rate cycles are counted in. Its times from GetProcessTimes grow a whole
    // 15.6ms clock tick at a time, charged to whichever thread runs at the tick, so a helper
    // that wakes 100 times a second for a few µs read anywhere from 0.31% to 1.25% of a core
    // in three runs of the same 10s (measured on our development machine, 2026-10-22,
    // record/areas/core/log.md, "Stage 6's helper passes on nothing it wasn't asked for and
    // comes back 2s after a kill, but capturing a continuous tone takes 1.4% of a core against
    // 1%").
    let cycles = || {
        let mut cycles = 0;
        // SAFETY: QueryProcessCycleTime writes one u64.
        let _ = unsafe { QueryProcessCycleTime(handle, &mut cycles) };
        cycles
    };
    // SAFETY: reading the time-stamp counter has no effects.
    let tsc = || unsafe { std::arch::x86_64::_rdtsc() };
    let (before, tsc_before) = (cycles(), tsc());
    std::thread::sleep(Duration::from_millis(ms));
    let (busy, counted) = (cycles() - before, tsc() - tsc_before);
    let share = busy as f64 / counted as f64 * 100.0;
    let mut counters = PROCESS_MEMORY_COUNTERS_EX2 {
        cb: size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32,
        ..Default::default()
    };
    // SAFETY: the call writes `cb` bytes of counters.
    unsafe {
        GetProcessMemoryInfo(
            handle,
            (&raw mut counters).cast::<PROCESS_MEMORY_COUNTERS>(),
            counters.cb,
        )
    }
    .map_err(|e| e.to_string())?;
    println!(
        "cpu {share:.2} private {:.1}",
        counters.PrivateWorkingSetSize as f64 / 1e6
    );
    Ok(())
}

fn frames(input: &str, output: &str, loss: &str) -> Result<(), String> {
    let loss: u64 = loss.parse().map_err(|_| "a loss is a percentage")?;
    let text = std::fs::read_to_string(input).map_err(|e| e.to_string())?;
    let packets: Vec<Vec<u8>> = text
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| {
            (0..l.len() / 2)
                .filter_map(|i| u8::from_str_radix(&l[i * 2..i * 2 + 2], 16).ok())
                .collect()
        })
        .collect();
    let mut decoder = opus_rs::OpusDecoder::new(48_000, 1).map_err(str::to_string)?;
    let mut samples = Vec::new();
    let mut frame = vec![0.0f32; 960];
    let started = Instant::now();
    // The same frames lost on each run: a fixed spread rather than a seeded generator.
    for (i, packet) in packets.iter().enumerate() {
        let lost = (i as u64 * 37) % 100 < loss;
        let decoded = decoder
            .decode(if lost { &[] } else { packet }, 960, &mut frame)
            .map_err(str::to_string)?;
        samples.extend_from_slice(&frame[..decoded]);
    }
    let decode = started.elapsed().as_micros() as f64 / packets.len().max(1) as f64;
    let small = packets.iter().filter(|p| p.len() <= 6).count();
    let mean = samples.iter().map(|s| s * s).sum::<f32>() / samples.len().max(1) as f32;
    let mut wav = Vec::with_capacity(44 + samples.len() * 2);
    let data = (samples.len() * 2) as u32;
    wav.extend(b"RIFF");
    wav.extend((36 + data).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(48_000u32.to_le_bytes());
    wav.extend(96_000u32.to_le_bytes());
    wav.extend(2u16.to_le_bytes());
    wav.extend(16u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend(data.to_le_bytes());
    for s in &samples {
        wav.extend(((s.clamp(-1.0, 1.0) * 32_767.0) as i16).to_le_bytes());
    }
    std::fs::write(output, wav).map_err(|e| e.to_string())?;
    println!(
        "frames {} small {small} level {:.1} decode {decode:.0}",
        packets.len(),
        10.0 * mean.max(1e-20).log10()
    );
    Ok(())
}
