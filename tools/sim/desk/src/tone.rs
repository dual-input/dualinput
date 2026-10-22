//! A program that plays audio for the core helper to capture, as an ATC app would: two
//! alternating tones on Windows' default output device, with its own level in the Windows
//! mixer set, until the time runs out or it's killed
//! (record/areas/core/04-core-helper.md, "Capturing a program").
//!
//!   desk-tone <seconds> <mixer level from 0 to 1>

use std::f32::consts::PI;
use std::time::{Duration, Instant};

use wasapi::{DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};
use windows::Win32::Media::Audio::{
    IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume,
    MMDeviceEnumerator, eConsole, eRender,
};
use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance};
use windows::core::Interface;

/// −20dBFS RMS, as a sine's peak.
const AMPLITUDE: f32 = 0.1 * std::f32::consts::SQRT_2;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let seconds: f32 = args.first().and_then(|s| s.parse().ok()).unwrap_or(30.0);
    let level: f32 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(1.0);
    if let Err(error) = play(seconds, level) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn play(seconds: f32, level: f32) -> Result<(), Box<dyn std::error::Error>> {
    let _ = wasapi::initialize_mta();
    let device = DeviceEnumerator::new()?.get_default_device(&Direction::Render)?;
    let mut client = device.get_iaudioclient()?;
    let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 1, None);
    client.initialize_client(
        &format,
        &Direction::Render,
        &StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: 400_000,
        },
    )?;
    let event = client.set_get_eventhandle()?;
    let render = client.get_audiorenderclient()?;
    client.start_stream()?;
    set_level(level)?;
    println!("playing at {level} in the mixer");
    let until = Instant::now() + Duration::from_secs_f32(seconds);
    let mut n: u64 = 0;
    while Instant::now() < until {
        let frames = client.get_available_space_in_frames()? as usize;
        let mut bytes = Vec::with_capacity(frames * 4);
        for _ in 0..frames {
            // 440Hz and 554Hz, each for half a second, so a listener hears where it is.
            let hz = if (n / 24_000).is_multiple_of(2) {
                440.0
            } else {
                554.0
            };
            let s = AMPLITUDE * (2.0 * PI * hz * n as f32 / 48_000.0).sin();
            bytes.extend(s.to_le_bytes());
            n += 1;
        }
        render.write_to_device(frames, &bytes, None)?;
        let _ = event.wait_for_event(100);
    }
    client.stop_stream()?;
    Ok(())
}

/// Sets this program's level in the Windows mixer: its audio session's volume on the default
/// output device, which its stream has opened.
fn set_level(level: f32) -> windows::core::Result<()> {
    // SAFETY: COM calls on interfaces Windows gave us, each released when dropped.
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let sessions = manager.GetSessionEnumerator()?;
        for i in 0..sessions.GetCount()? {
            let control = sessions.GetSession(i)?;
            if control.cast::<IAudioSessionControl2>()?.GetProcessId()? == std::process::id() {
                control
                    .cast::<ISimpleAudioVolume>()?
                    .SetMasterVolume(level, std::ptr::null())?;
            }
        }
    }
    Ok(())
}
