//! How ATC speech sounds through Opus at each setting.
//!
//!   opus-quality record <pid> <secs> <out.wav>
//!       captures the process and its tree as the core helper does, through process loopback
//!       at 48 kHz stereo float with Windows converting, for `secs`, into a 32-bit float WAV,
//!       and prints the probe's own CPU while it captured, with no Opus at all
//!   opus-quality encode <in.wav> <out folder>
//!       makes each setting's copy of the recording, mixed to mono as the helper mixes it,
//!       encoded and decoded, at the original's loudness, and prints each one's cost

use std::time::{Duration, Instant};

use wasapi::{AudioClient, Direction, SampleType, StreamMode, WaveFormat};
use windows::Win32::System::Threading::GetCurrentProcess;
use windows::Win32::System::WindowsProgramming::QueryProcessCycleTime;

const RATE: usize = 48_000;
const FRAME: usize = 960;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let result = match args[..] {
        ["record", pid, secs, out] => record(pid.parse().unwrap_or(0), secs.parse().unwrap_or(60), out),
        ["encode", input, out] => encode(input, out),
        _ => Err("usage: opus-quality record <pid> <secs> <out.wav> | encode <in.wav> <out folder>".into()),
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn cycles() -> u64 {
    let mut cycles = 0;
    // SAFETY: QueryProcessCycleTime writes one u64 for our own process.
    let _ = unsafe { QueryProcessCycleTime(GetCurrentProcess(), &mut cycles) };
    cycles
}

fn tsc() -> u64 {
    // SAFETY: reading the time-stamp counter has no effects.
    unsafe { std::arch::x86_64::_rdtsc() }
}

fn record(pid: u32, secs: u64, out: &str) -> Result<(), String> {
    wasapi::initialize_mta().ok().map_err(|e| e.to_string())?;
    let format = WaveFormat::new(32, 32, &SampleType::Float, RATE, 2, None);
    let mut client = AudioClient::new_application_loopback_client(pid, true).map_err(|e| e.to_string())?;
    client
        .initialize_client(&format, &Direction::Capture, &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 2_000_000 })
        .map_err(|e| e.to_string())?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let reader = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
    client.start_stream().map_err(|e| e.to_string())?;
    let mut samples: Vec<f32> = Vec::with_capacity(RATE * 2 * secs as usize);
    let mut packet = vec![0u8; RATE * 8];
    let (mut packets, mut silent, mut wakes) = (0u64, 0u64, 0u64);
    let (cycles_before, tsc_before) = (cycles(), tsc());
    // It records until `secs` of speech, frames above −60 dBFS, have come, or 10 minutes pass,
    // and keeps what came from the first speech on.
    let (started, mut said) = (Instant::now(), Instant::now());
    // Seconds of speech in the 20ms frames up to `counted`.
    let (mut speech, mut counted) = (0.0f64, 0usize);
    while started.elapsed() < Duration::from_secs(600) && speech < secs as f64 {
        while samples.len() - counted >= FRAME * 2 {
            if dbfs_of(&samples[counted..counted + FRAME * 2]) > -60.0 {
                speech += 0.02;
            }
            counted += FRAME * 2;
        }
        if said.elapsed() >= Duration::from_secs(10) {
            said = Instant::now();
            println!("{:.0}s in, {speech:.1}s of speech so far", started.elapsed().as_secs_f64());
        }
        let _ = event.wait_for_event(100);
        wakes += 1;
        loop {
            let (frames, info) = reader.read_from_device(&mut packet).map_err(|e| e.to_string())?;
            if frames == 0 {
                break;
            }
            packets += 1;
            let new: Vec<f32> = if info.flags.silent {
                silent += 1;
                vec![0.0; frames as usize * 2]
            } else {
                packet[..frames as usize * 8].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
            };
            if !samples.is_empty() || dbfs_of(&new) > -60.0 {
                samples.extend(new);
            }
        }
    }
    let share = (cycles() - cycles_before) as f64 / (tsc() - tsc_before) as f64 * 100.0;
    let _ = client.stop_stream();
    write_wav(out, &samples, 2, true)?;
    let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    println!(
        "recorded {:.1}s: {packets} packets on {wakes} wakes, {silent} silent; level {:.1} dBFS, peak {:.1} dBFS; the probe took {share:.2}% of one CPU core capturing, with no Opus",
        samples.len() as f64 / (RATE * 2) as f64,
        dbfs(&samples),
        20.0 * peak.max(1e-10).log10()
    );
    Ok(())
}

/// The mean power of a stretch of samples, in dBFS.
fn dbfs_of(samples: &[f32]) -> f64 {
    let power = samples.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / samples.len().max(1) as f64;
    10.0 * power.max(1e-20).log10()
}

/// The mean power of the samples above silence, in dBFS, so pauses don't lower a recording's level.
fn dbfs(samples: &[f32]) -> f64 {
    let loud: Vec<f64> = samples.chunks(FRAME).map(|f| f.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / f.len() as f64).filter(|p| *p > 1e-7).collect();
    let mean = loud.iter().sum::<f64>() / loud.len().max(1) as f64;
    10.0 * mean.max(1e-20).log10()
}

#[derive(Clone, Copy)]
enum Mode {
    Voip,
    Audio,
}

/// opus-rs, the port the helper ships, or libopus, the reference it ports, through `opus`.
#[derive(Clone, Copy)]
enum Codec {
    Port,
    Libopus,
}

struct Setting {
    name: &'static str,
    codec: Codec,
    mode: Mode,
    bitrate: i32,
    complexity: i32,
}

/// One setting's encoder and decoder, behind one call: a frame in, its packet's length and
/// the decoded frame out.
type Coder = Box<dyn FnMut(&[f32], &mut [u8], &mut [f32]) -> Result<(usize, usize, Duration), String>>;

fn coder(s: &Setting) -> Result<Coder, String> {
    Ok(match s.codec {
        Codec::Port => {
            let application = match s.mode {
                Mode::Voip => opus_rs::Application::Voip,
                Mode::Audio => opus_rs::Application::Audio,
            };
            let mut encoder = opus_rs::OpusEncoder::new(RATE as i32, 1, application).map_err(str::to_string)?;
            encoder.bitrate_bps = s.bitrate;
            encoder.use_cbr = false;
            encoder.complexity = s.complexity;
            let mut decoder = opus_rs::OpusDecoder::new(RATE as i32, 1).map_err(str::to_string)?;
            Box::new(move |frame, packet, pcm| {
                let started = Instant::now();
                let length = encoder.encode(frame, FRAME, packet).map_err(str::to_string)?;
                let took = started.elapsed();
                let n = decoder.decode(&packet[..length], FRAME, pcm).map_err(str::to_string)?;
                Ok((length, n, took))
            })
        }
        Codec::Libopus => {
            let application = match s.mode {
                Mode::Voip => opus::Application::Voip,
                Mode::Audio => opus::Application::Audio,
            };
            let mut encoder = opus::Encoder::new(RATE as u32, opus::Channels::Mono, application).map_err(|e| e.to_string())?;
            encoder.set_bitrate(opus::Bitrate::Bits(s.bitrate)).map_err(|e| e.to_string())?;
            encoder.set_vbr(true).map_err(|e| e.to_string())?;
            encoder.set_complexity(s.complexity).map_err(|e| e.to_string())?;
            let mut decoder = opus::Decoder::new(RATE as u32, opus::Channels::Mono).map_err(|e| e.to_string())?;
            Box::new(move |frame, packet, pcm| {
                let started = Instant::now();
                let length = encoder.encode_float(frame, packet).map_err(|e| e.to_string())?;
                let took = started.elapsed();
                let n = decoder.decode_float(&packet[..length], pcm, false).map_err(|e| e.to_string())?;
                Ok((length, n, took))
            })
        }
    })
}

fn encode(input: &str, out: &str) -> Result<(), String> {
    let (stereo, channels) = read_wav(input)?;
    // The helper mixes the program to mono, as the left and right channels' mean.
    let mono: Vec<f32> = if channels == 2 { stereo.chunks_exact(2).map(|f| (f[0] + f[1]) / 2.0).collect() } else { stereo };
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let original = dbfs(&mono);
    write_wav(&format!("{out}/original.wav"), &mono, 1, true)?;
    println!("original, mixed to mono: level {original:.1} dBFS");
    use Codec::{Libopus, Port};
    use Mode::{Audio, Voip};
    let settings = [
        Setting { name: "port-voip-24k-c5-as-shipped", codec: Port, mode: Voip, bitrate: 24_000, complexity: 5 },
        Setting { name: "port-voip-48k-c5", codec: Port, mode: Voip, bitrate: 48_000, complexity: 5 },
        Setting { name: "port-audio-32k-c5", codec: Port, mode: Audio, bitrate: 32_000, complexity: 5 },
        Setting { name: "port-audio-48k-c5", codec: Port, mode: Audio, bitrate: 48_000, complexity: 5 },
        Setting { name: "port-audio-64k-c5", codec: Port, mode: Audio, bitrate: 64_000, complexity: 5 },
        Setting { name: "port-audio-48k-c9", codec: Port, mode: Audio, bitrate: 48_000, complexity: 9 },
        Setting { name: "libopus-voip-24k-c5", codec: Libopus, mode: Voip, bitrate: 24_000, complexity: 5 },
        Setting { name: "libopus-audio-32k-c5", codec: Libopus, mode: Audio, bitrate: 32_000, complexity: 5 },
        Setting { name: "libopus-audio-48k-c5", codec: Libopus, mode: Audio, bitrate: 48_000, complexity: 5 },
        Setting { name: "libopus-audio-48k-c9", codec: Libopus, mode: Audio, bitrate: 48_000, complexity: 9 },
    ];
    for s in &settings {
        let mut code = coder(s)?;
        let (mut decoded, mut bytes, mut frames) = (Vec::with_capacity(mono.len()), 0usize, 0usize);
        let mut packet = vec![0u8; 1276];
        let mut pcm = vec![0.0f32; FRAME];
        let mut encoding = Duration::ZERO;
        for frame in mono.chunks_exact(FRAME) {
            let (length, n, took) = code(frame, &mut packet, &mut pcm)?;
            encoding += took;
            decoded.extend_from_slice(&pcm[..n]);
            bytes += length;
            frames += 1;
        }
        // At the original's loudness, so a listener hears the codec, not a level.
        let gain = 10f64.powf((original - dbfs(&decoded)) / 20.0) as f32;
        let matched: Vec<f32> = decoded.iter().map(|s| s * gain).collect();
        write_wav(&format!("{out}/{}.wav", s.name), &matched, 1, true)?;
        println!(
            "{}: {:.1} kbps sent, {}us a frame to encode, {:.2}% of one core at 50 frames a second, level matched by {:+.1} dB",
            s.name,
            bytes as f64 * 8.0 / (frames as f64 * 0.02) / 1000.0,
            encoding.as_micros() / frames.max(1) as u128,
            encoding.as_secs_f64() / (frames as f64 * 0.02) * 100.0,
            20.0 * (gain as f64).log10()
        );
    }
    Ok(())
}

fn write_wav(path: &str, samples: &[f32], channels: u16, float: bool) -> Result<(), String> {
    let data = (samples.len() * 4) as u32;
    let mut wav = Vec::with_capacity(44 + data as usize);
    wav.extend(b"RIFF");
    wav.extend((36 + data).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes());
    wav.extend((if float { 3u16 } else { 1u16 }).to_le_bytes());
    wav.extend(channels.to_le_bytes());
    wav.extend((RATE as u32).to_le_bytes());
    wav.extend((RATE as u32 * 4 * channels as u32).to_le_bytes());
    wav.extend((4 * channels).to_le_bytes());
    wav.extend(32u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend(data.to_le_bytes());
    for s in samples {
        wav.extend(s.to_le_bytes());
    }
    std::fs::write(path, wav).map_err(|e| e.to_string())
}

/// A 32-bit float WAV this program wrote, as its samples and channel count.
fn read_wav(path: &str) -> Result<(Vec<f32>, usize), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || u16::from_le_bytes([bytes[20], bytes[21]]) != 3 {
        return Err(format!("{path} isn't a float WAV this probe wrote"));
    }
    let channels = u16::from_le_bytes([bytes[22], bytes[23]]) as usize;
    let samples = bytes[44..].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    Ok((samples, channels))
}
