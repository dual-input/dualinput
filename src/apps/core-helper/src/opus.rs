//! Opus, behind the three calls the helper makes: encode a frame, decode one, and conceal a
//! lost one. opus-rs is a young port of libopus, so if it falls short, `opus` 0.4.0, bindings
//! to libopus, takes its place here and nowhere else (record/areas/core/04-core-helper.md,
//! "Opus").

use opus_rs::{Application, OpusDecoder, OpusEncoder};

/// The helper runs Opus at 48 kHz, mono.
pub const RATE: u32 = 48_000;

/// 20ms at 48 kHz, every frame's length.
pub const FRAME: usize = 960;

/// RFC 6716's largest packet.
const MOST_BYTES: usize = 1276;

/// The longest packet's samples, 120ms, which a sound's packets may reach.
const MOST_SAMPLES: usize = 5760;

pub struct Encoder(OpusEncoder);

impl Encoder {
    /// A VBR encoder for speech at `bitrate` bits a second.
    pub fn new(bitrate: u32) -> Result<Encoder, String> {
        // The capture's 1% of a core holds only if encoding ATC speech stays cheap. Opus's
        // Voip mode filters and emphasizes speech for intelligibility, where its Audio mode
        // codes the signal as it is: on 90s of BeyondATC's speech, Voip took 165µs a frame,
        // about 0.8% of a core at 50 frames a second, and Audio 46µs to 55µs, and a listener
        // told no copy from the original (measured on our development machine, 2026-10-23,
        // record/areas/core/log.md).
        let mut encoder =
            OpusEncoder::new(RATE as i32, 1, Application::Audio).map_err(str::to_string)?;
        encoder.bitrate_bps = i32::try_from(bitrate).unwrap_or(i32::MAX);
        encoder.use_cbr = false;
        // Complexity sets how hard the encoder works for quality at its bitrate, not how much
        // it sends, and any decoder plays what any complexity makes. opus-rs's default, 9,
        // took 193µs a frame, about 1% of a core at 50 frames a second, the capture's whole
        // budget, and 5 took 119µs at the same 105 bytes a frame (measured on our development
        // machine, 2026-10-22, record/areas/core/log.md; user, 2026-10-22).
        encoder.complexity = 5;
        Ok(Encoder(encoder))
    }

    /// One 20ms frame, `FRAME` samples from −1 to 1.
    pub fn encode(&mut self, frame: &[f32]) -> Result<Vec<u8>, String> {
        let mut packet = vec![0; MOST_BYTES];
        let length = self
            .0
            .encode(frame, FRAME, &mut packet)
            .map_err(str::to_string)?;
        packet.truncate(length);
        Ok(packet)
    }
}

pub struct Decoder(OpusDecoder);

impl Decoder {
    pub fn new(channels: usize) -> Result<Decoder, String> {
        OpusDecoder::new(RATE as i32, channels)
            .map(Decoder)
            .map_err(str::to_string)
    }

    /// One packet's samples, each channel's interleaved.
    pub fn decode(&mut self, packet: &[u8], channels: usize) -> Result<Vec<f32>, String> {
        let mut samples = vec![0.0; MOST_SAMPLES * channels];
        let length = self
            .0
            .decode(packet, MOST_SAMPLES, &mut samples)
            .map_err(str::to_string)?;
        samples.truncate(length * channels);
        Ok(samples)
    }

    /// 20ms in place of a lost frame, as libopus conceals one, in the last packet's mode.
    pub fn conceal(&mut self) -> Vec<f32> {
        let mut samples = vec![0.0; FRAME];
        match self.0.decode(&[], FRAME, &mut samples) {
            Ok(length) => samples.truncate(length),
            Err(_) => samples.fill(0.0),
        }
        samples
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| 0.3 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / RATE as f32).sin())
            .collect()
    }

    #[test]
    #[ignore = "a timing, measured by hand in a release build"]
    fn encode_cost() {
        let signal = tone(FRAME * 500);
        for complexity in [9, 7, 5, 3, 1] {
            let mut encoder = Encoder::new(24_000).unwrap();
            encoder.0.complexity = complexity;
            let started = std::time::Instant::now();
            let bytes: usize = signal
                .chunks(FRAME)
                .map(|f| encoder.encode(f).unwrap().len())
                .sum();
            let per = started.elapsed().as_micros() / 500;
            println!(
                "complexity {complexity}: {per}us a frame, {} bytes a frame",
                bytes / 500
            );
        }
    }

    #[test]
    fn a_frame_encodes_and_decodes_to_20ms_and_a_lost_one_is_concealed() {
        let mut encoder = Encoder::new(24_000).unwrap();
        let mut decoder = Decoder::new(1).unwrap();
        let signal = tone(FRAME * 10);
        for frame in signal.chunks(FRAME) {
            let packet = encoder.encode(frame).unwrap();
            assert!(
                !packet.is_empty() && packet.len() < 200,
                "{} bytes",
                packet.len()
            );
            assert_eq!(decoder.decode(&packet, 1).unwrap().len(), FRAME);
        }
        assert_eq!(decoder.conceal().len(), FRAME);
    }
}
