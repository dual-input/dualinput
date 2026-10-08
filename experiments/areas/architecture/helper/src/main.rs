// p02's helper: the native work the core's helper would do, from Rust, one
// subcommand per job, each reporting on stdout so p02-rust-helper.mjs can read it.
//
//   devices                       list the output and input devices
//   play <name|default> <s> <Hz>  play a quiet tone on the output device with that name
//   loopback <pid> <s>            capture one process's audio, and its children's, through
//                                 WASAPI's process loopback, and report the level each second
//   mic <s>                       capture the default input device, and report the level
//   keys <s>                      read the keyboard, joysticks, and gamepads through Raw Input
//                                 in sink mode, which gets a copy of input with any window in front
//   send                          press and release F24, which no application binds

#![windows_subsystem = "windows"]

use std::collections::VecDeque;
use std::error::Error;
use std::f32::consts::PI;
use std::io::Write;
use std::ptr::{null, null_mut};
use std::time::{Duration, Instant};

use wasapi::{initialize_mta, AudioClient, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP};
use windows_sys::Win32::UI::Input::{GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK, RID_INPUT, RIM_TYPEHID, RIM_TYPEKEYBOARD};
use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DispatchMessageW, GetMessageW, SetTimer, MSG, RI_KEY_BREAK, WM_INPUT, WM_TIMER};

type Res = Result<(), Box<dyn Error>>;

fn say(line: &str) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

// 48kHz stereo float, which the audio engine converts to and from the device's own format.
fn format() -> WaveFormat {
    WaveFormat::new(32, 32, &SampleType::Float, 48000, 2, None)
}

fn mode() -> StreamMode {
    StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 200_000 }
}

fn devices() -> Res {
    let e = DeviceEnumerator::new()?;
    for (dir, label) in [(Direction::Render, "output"), (Direction::Capture, "input")] {
        let default = e.get_default_device(&dir)?.get_friendlyname()?;
        for d in &e.get_device_collection(&dir)? {
            let name = d?.get_friendlyname()?;
            say(&format!("DEVICE {label} {name}{}", if name == default { " (default)" } else { "" }));
        }
    }
    Ok(())
}

fn play(name: &str, secs: f32, freq: f32) -> Res {
    let e = DeviceEnumerator::new()?;
    let name = if name == "default" { e.get_default_device(&Direction::Render)?.get_friendlyname()? } else { name.to_string() };
    // Looked up by name, as the pilot's choice of output device would be.
    let device = e.get_device_collection(&Direction::Render)?.get_device_with_name(&name)?;
    let mut client = device.get_iaudioclient()?;
    let fmt = format();
    client.initialize_client(&fmt, &Direction::Render, &mode())?;
    let event = client.set_get_eventhandle()?;
    let render = client.get_audiorenderclient()?;
    let block = fmt.get_blockalign() as usize;
    let (mut phase, step, amp) = (0f32, 2.0 * PI * freq / 48000.0, 0.05f32);
    client.start_stream()?;
    say(&format!("PLAYING {} on {}", std::process::id(), device.get_friendlyname()?));
    let end = Instant::now() + Duration::from_secs_f32(secs);
    while Instant::now() < end {
        let frames = client.get_available_space_in_frames()? as usize;
        if frames > 0 {
            let mut data = Vec::with_capacity(frames * block);
            for _ in 0..frames {
                let s = amp * phase.sin();
                phase = (phase + step) % (2.0 * PI);
                data.extend_from_slice(&s.to_le_bytes());
                data.extend_from_slice(&s.to_le_bytes());
            }
            render.write_to_device(frames, &data, None)?;
        }
        let _ = event.wait_for_event(1000);
    }
    client.stop_stream()?;
    say("DONE");
    Ok(())
}

fn capture(mut client: AudioClient, secs: u64, what: &str) -> Res {
    let fmt = format();
    client.initialize_client(&fmt, &Direction::Capture, &mode())?;
    let event = client.set_get_eventhandle()?;
    let cap = client.get_audiocaptureclient()?;
    let mut queue: VecDeque<u8> = VecDeque::new();
    client.start_stream()?;
    say(&format!("CAPTURING {what}"));
    let start = Instant::now();
    let (mut second, mut sum, mut count, mut peak, mut total) = (1u64, 0f64, 0u64, 0f32, 0u64);
    while start.elapsed() < Duration::from_secs(secs) {
        let _ = event.wait_for_event(1000);
        cap.read_from_device_to_deque(&mut queue)?;
        while queue.len() >= 4 {
            let b = [queue.pop_front().unwrap(), queue.pop_front().unwrap(), queue.pop_front().unwrap(), queue.pop_front().unwrap()];
            let s = f32::from_le_bytes(b);
            sum += (s * s) as f64;
            count += 1;
            peak = peak.max(s.abs());
        }
        if start.elapsed() >= Duration::from_secs(second) {
            let db = |x: f64| if x > 0.0 { format!("{:.1}", 20.0 * x.log10()) } else { "-inf".into() };
            let rms = if count > 0 { (sum / count as f64).sqrt() } else { 0.0 };
            say(&format!("LEVEL second={second} frames={} rms_dbfs={} peak_dbfs={}", count / 2, db(rms), db(peak as f64)));
            total += count / 2;
            (sum, count, peak) = (0.0, 0, 0.0);
            second += 1;
        }
    }
    client.stop_stream()?;
    say(&format!("DONE frames={total}"));
    Ok(())
}

fn keys(secs: u32) -> Res {
    unsafe {
        // Raw Input in sink mode needs a window to deliver to, though it never has the focus.
        let class = wide("STATIC");
        let hwnd = CreateWindowExW(0, class.as_ptr(), class.as_ptr(), 0, 0, 0, 0, 0, null_mut(), null_mut(), null_mut(), null());
        let devices = [6u16, 4, 5].map(|usage| RAWINPUTDEVICE { usUsagePage: 1, usUsage: usage, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd });
        if RegisterRawInputDevices(devices.as_ptr(), devices.len() as u32, std::mem::size_of::<RAWINPUTDEVICE>() as u32) == 0 {
            return Err(format!("RegisterRawInputDevices failed: {}", std::io::Error::last_os_error()).into());
        }
        SetTimer(null_mut(), 0, secs * 1000, None);
        say("READY");
        let header = std::mem::size_of::<RAWINPUTHEADER>() as u32;
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
                    if raw.header.dwType == RIM_TYPEKEYBOARD {
                        let k = raw.data.keyboard;
                        let up = (k.Flags as u32) & RI_KEY_BREAK != 0;
                        say(&format!("KEY vk={:#04x} {} device={:?}", k.VKey, if up { "up" } else { "down" }, raw.header.hDevice));
                    } else if raw.header.dwType == RIM_TYPEHID {
                        say(&format!("HID device={:?} reports={}", raw.header.hDevice, raw.data.hid.dwCount));
                    }
                }
            }
            DispatchMessageW(&msg);
        }
    }
    say("DONE");
    Ok(())
}

fn send() -> Res {
    let key = |flags| INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: 0x87, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } };
    let inputs = [key(0), key(KEYEVENTF_KEYUP)];
    let sent = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
    say(&format!("SENT {sent}"));
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| args.get(i).cloned().unwrap_or_default();
    let _ = initialize_mta();
    let result = match arg(0).as_str() {
        "devices" => devices(),
        "play" => play(&arg(1), arg(2).parse().unwrap_or(5.0), arg(3).parse().unwrap_or(440.0)),
        "loopback" => AudioClient::new_application_loopback_client(arg(1).parse().unwrap_or(0), true)
            .map_err(|e| e.into())
            .and_then(|c| capture(c, arg(2).parse().unwrap_or(5), &format!("process {}", arg(1)))),
        "mic" => DeviceEnumerator::new()
            .and_then(|e| e.get_default_device(&Direction::Capture))
            .and_then(|d| d.get_iaudioclient())
            .map_err(|e| e.into())
            .and_then(|c| capture(c, arg(1).parse().unwrap_or(4), "the default input device")),
        "keys" => keys(arg(1).parse().unwrap_or(5)),
        "send" => send(),
        other => Err(format!("unknown subcommand {other:?}").into()),
    };
    if let Err(e) = result {
        say(&format!("ERROR {e}"));
        std::process::exit(1);
    }
}
