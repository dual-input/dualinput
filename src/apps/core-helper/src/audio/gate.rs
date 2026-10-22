//! The gate that sends nothing in silence: a captured frame crosses only while its level is
//! above the gate, and for the hangover after it falls below, and the frame before an onset
//! crosses with it, so the onset isn't clipped, as FS Copilot's capture does (FS Copilot
//! fork, record/traffic-atc/docs/01-design.md, "Encoding and transport").

/// Every frame is 20ms.
const FRAME_MS: u32 = 20;

/// A frame's payload is anything: the capture gates its samples before it encodes them, so a
/// frame that never crosses costs no encoding.
pub struct Gate<T> {
    level_dbfs: f32,
    hangover: u32,
    /// The frames still to cross after the level fell below the gate.
    open_for: u32,
    /// The last frame below the gate, held in case the next is an onset.
    held: Option<(T, u64)>,
}

impl<T> Gate<T> {
    pub fn new(level_dbfs: f32, hangover_ms: u32) -> Gate<T> {
        Gate {
            level_dbfs,
            hangover: hangover_ms.div_ceil(FRAME_MS),
            open_for: 0,
            held: None,
        }
    }

    /// The frames that cross for one captured frame at `level_dbfs`, each with its stamp.
    pub fn frame(&mut self, level_dbfs: f32, frame: T, at: u64) -> Vec<(T, u64)> {
        if level_dbfs > self.level_dbfs {
            let onset = self.open_for == 0;
            self.open_for = self.hangover;
            let mut crossing = Vec::with_capacity(2);
            if let Some(held) = self.held.take().filter(|_| onset) {
                crossing.push(held);
            }
            crossing.push((frame, at));
            crossing
        } else if self.open_for > 0 {
            self.open_for -= 1;
            self.held = None;
            vec![(frame, at)]
        } else {
            self.held = Some((frame, at));
            Vec::new()
        }
    }
}

/// A frame's level, its RMS in dBFS.
pub fn level_dbfs(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return f32::NEG_INFINITY;
    }
    let mean = samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32;
    10.0 * mean.max(1e-20).log10()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_below_the_gate_never_crosses() {
        let mut gate: Gate<Vec<u8>> = Gate::new(-50.0, 300);
        for at in 0..100 {
            assert!(gate.frame(-60.0, vec![1], at).is_empty());
        }
    }

    #[test]
    fn an_onset_crosses_with_the_frame_before_it_and_the_hangover_after() {
        let mut gate: Gate<Vec<u8>> = Gate::new(-50.0, 60);
        assert!(gate.frame(-70.0, vec![0], 0).is_empty());
        assert_eq!(gate.frame(-20.0, vec![1], 1), [(vec![0], 0), (vec![1], 1)]);
        assert_eq!(gate.frame(-20.0, vec![2], 2), [(vec![2], 2)]);
        // 60ms of hangover is 3 frames.
        for n in 3..6 {
            assert_eq!(
                gate.frame(-70.0, vec![n], u64::from(n)),
                [(vec![n], u64::from(n))]
            );
        }
        assert!(gate.frame(-70.0, vec![6], 6).is_empty());
    }

    #[test]
    fn a_full_scale_sine_is_about_minus_3_dbfs() {
        let sine: Vec<f32> = (0..960).map(|i| (i as f32 * 0.1).sin()).collect();
        assert!(
            (level_dbfs(&sine) + 3.0).abs() < 0.2,
            "{}",
            level_dbfs(&sine)
        );
    }
}
