//! A feature's sound, an Ogg Opus file at 48 kHz that the core sends once after each `Hello`,
//! which the helper decodes then, so `Play` mixes it in at once
//! (record/areas/core/04-core-helper.md, "Playing").

use std::io::Cursor;

use ogg::PacketReader;

use crate::opus::Decoder;

/// A sound's samples at 48 kHz, mono.
pub fn decode(ogg_opus: &[u8]) -> Result<Vec<f32>, String> {
    let mut reader = PacketReader::new(Cursor::new(ogg_opus));
    let mut next = || -> Result<Option<Vec<u8>>, String> {
        Ok(reader
            .read_packet()
            .map_err(|e| format!("its Ogg didn't read: {e}"))?
            .map(|p| p.data))
    };
    // RFC 7845: an identification header, then a comment header, then the audio.
    let head = next()?.ok_or("it has no packets")?;
    if !head.starts_with(b"OpusHead") || head.len() < 19 {
        return Err("its first packet isn't an OpusHead".into());
    }
    let channels = usize::from(head[9]);
    if !(1..=2).contains(&channels) {
        return Err(format!(
            "it has {channels} channels, where a sound has 1 or 2"
        ));
    }
    let pre_skip = usize::from(u16::from_le_bytes([head[10], head[11]]));
    match next()? {
        Some(tags) if tags.starts_with(b"OpusTags") => {}
        _ => return Err("its second packet isn't an OpusTags".into()),
    }
    let mut decoder = Decoder::new(channels)?;
    let mut samples = Vec::new();
    while let Some(packet) = next()? {
        let decoded = decoder.decode(&packet, channels)?;
        if channels == 2 {
            samples.extend(decoded.chunks_exact(2).map(|c| (c[0] + c[1]) / 2.0));
        } else {
            samples.extend(decoded);
        }
    }
    samples.drain(..pre_skip.min(samples.len()));
    Ok(samples)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opus::{Encoder, FRAME, RATE};

    /// The bench's sound, which its test unit registers, so a core on the real helper
    /// plays something we know: 2s of 440Hz and 554Hz, each for half a second, at −20dBFS RMS.
    /// It stays short, since the core sends every sound in each Hello, and a desk run plays
    /// it again and again while a person changes Windows' default output device.
    const TONE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../core/src/bench/tone.opus");

    /// Writes the bench's sound. Run it by hand, with `cargo test -p dualinput-core-helper
    /// -- --ignored writes_the_bench_tone`, when the sound should change.
    #[test]
    #[ignore = "it writes apps/core/src/bench/tone.opus, which is committed"]
    fn writes_the_bench_tone() {
        use ogg::writing::{PacketWriteEndInfo, PacketWriter};
        let amplitude = 10f32.powf(-20.0 / 20.0) * std::f32::consts::SQRT_2;
        let samples: Vec<f32> = (0..RATE as usize * 2)
            .map(|i| {
                let hz = if (i / (RATE as usize / 2)).is_multiple_of(2) {
                    440.0
                } else {
                    554.0
                };
                amplitude * (2.0 * std::f32::consts::PI * hz * i as f32 / RATE as f32).sin()
            })
            .collect();
        let mut encoder = Encoder::new(24_000).unwrap();
        let mut file = Vec::new();
        let mut writer = PacketWriter::new(&mut file);
        let mut head = b"OpusHead".to_vec();
        head.extend([1, 1]);
        head.extend(0u16.to_le_bytes());
        head.extend(RATE.to_le_bytes());
        head.extend([0, 0, 0]);
        writer
            .write_packet(head, 1, PacketWriteEndInfo::EndPage, 0)
            .unwrap();
        let mut tags = b"OpusTags".to_vec();
        let vendor = b"Dual Input";
        tags.extend((vendor.len() as u32).to_le_bytes());
        tags.extend(vendor);
        tags.extend(0u32.to_le_bytes());
        writer
            .write_packet(tags, 1, PacketWriteEndInfo::EndPage, 0)
            .unwrap();
        let frames: Vec<&[f32]> = samples.chunks_exact(FRAME).collect();
        for (i, frame) in frames.iter().enumerate() {
            let end = if i + 1 == frames.len() {
                PacketWriteEndInfo::EndStream
            } else {
                PacketWriteEndInfo::NormalPacket
            };
            let granule = ((i + 1) * FRAME) as u64;
            writer
                .write_packet(encoder.encode(frame).unwrap(), 1, end, granule)
                .unwrap();
        }
        std::fs::write(TONE, file).unwrap();
    }

    #[test]
    fn the_bench_tone_decodes_to_2s_at_its_level() {
        let samples = decode(&std::fs::read(TONE).unwrap()).unwrap();
        assert_eq!(samples.len(), RATE as usize * 2);
        let level = crate::audio::gate::level_dbfs(&samples[RATE as usize / 10..]);
        assert!(
            (level + 20.0).abs() < 1.5,
            "the tone decoded at {level} dBFS"
        );
    }

    #[test]
    fn a_file_that_isnt_ogg_opus_is_refused() {
        assert!(decode(b"not a sound").is_err());
    }
}
