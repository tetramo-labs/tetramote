//! System audio to Opus: ScreenCaptureKit's float PCM made interleaved stereo,
//! cut into 20 ms packets stamped with the capture time of their first sample.

use crate::{
    AudioPacket, OpusEncoder, Result, OPUS_CHANNELS, OPUS_FRAME_SAMPLES, OPUS_SAMPLE_RATE,
};

const PACKET_US: u64 = 20_000;

pub struct AudioEncoder {
    opus: OpusEncoder,
    buffered: u64,
}

impl AudioEncoder {
    pub fn new() -> Result<Self> {
        Ok(Self {
            opus: OpusEncoder::new(128_000)?,
            buffered: 0,
        })
    }

    /// `samples` is interleaved stereo whose first frame was captured at `pts_us`.
    pub fn push(&mut self, samples: &[f32], pts_us: u64) -> Result<Vec<AudioPacket>> {
        let first = pts_us.saturating_sub(self.buffered * 1_000_000 / u64::from(OPUS_SAMPLE_RATE));
        let packets = self.opus.push(samples)?;
        let frames = (samples.len() / OPUS_CHANNELS) as u64;
        self.buffered = (self.buffered + frames)
            .saturating_sub(packets.len() as u64 * OPUS_FRAME_SAMPLES as u64);
        Ok(packets
            .into_iter()
            .zip((0..).map(|n| first + n * PACKET_US))
            .map(|(data, pts_us)| AudioPacket { data, pts_us })
            .collect())
    }
}

/// Interleaved stereo from one sample buffer's audio buffers, each given as
/// native-endian f32 bytes and its channel count: planar buffers, packed ones
/// or mono (copied to both sides). Channels past the second are dropped.
pub fn stereo(buffers: &[(&[u8], usize)]) -> Vec<f32> {
    let channels: Vec<(&[u8], usize, usize)> = buffers
        .iter()
        .filter(|(_, count)| *count > 0)
        .flat_map(|&(data, count)| (0..count).map(move |index| (data, count, index)))
        .collect();
    let Some(&left) = channels.first() else {
        return Vec::new();
    };
    let right = channels.get(1).copied().unwrap_or(left);
    let frames = [left, right]
        .iter()
        .map(|(data, count, _)| data.len() / (4 * count))
        .min()
        .unwrap_or(0);
    (0..frames)
        .flat_map(|frame| [sample(left, frame), sample(right, frame)])
        .collect()
}

fn sample((data, count, index): (&[u8], usize, usize), frame: usize) -> f32 {
    let at = (frame * count + index) * 4;
    data.get(at..at + 4)
        .and_then(|bytes| bytes.try_into().ok())
        .map_or(0.0, f32::from_ne_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(samples: &[f32]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_ne_bytes()).collect()
    }

    #[test]
    fn interleaves_planar_buffers() {
        let left = bytes(&[0.1, 0.2, 0.3]);
        let right = bytes(&[-0.1, -0.2, -0.3]);
        assert_eq!(
            stereo(&[(&left, 1), (&right, 1)]),
            [0.1, -0.1, 0.2, -0.2, 0.3, -0.3]
        );
    }

    #[test]
    fn keeps_packed_stereo_and_widens_mono() {
        let packed = bytes(&[0.5, -0.5, 0.25, -0.25]);
        assert_eq!(stereo(&[(&packed, 2)]), [0.5, -0.5, 0.25, -0.25]);
        let mono = bytes(&[0.5, 0.25]);
        assert_eq!(stereo(&[(&mono, 1)]), [0.5, 0.5, 0.25, 0.25]);
    }

    #[test]
    fn drops_channels_past_the_second() {
        let packed = bytes(&[0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
        assert_eq!(stereo(&[(&packed, 3)]), [0.1, 0.2, 0.4, 0.5]);
        assert_eq!(stereo(&[]), Vec::<f32>::new());
    }

    #[test]
    fn stamps_each_packet_with_its_first_sample_time() {
        let mut encoder = AudioEncoder::new().unwrap();
        let chunk = vec![0.0f32; 480 * 2];
        let mut packets = Vec::new();
        for n in 0..100u64 {
            packets.extend(encoder.push(&chunk, 5_000_000 + n * 10_000).unwrap());
        }
        assert_eq!(packets.len(), 50);
        assert_eq!(packets[0].pts_us, 5_000_000);
        assert_eq!(packets[1].pts_us, 5_020_000);
        assert_eq!(packets[49].pts_us, 5_980_000);
    }

    #[test]
    fn follows_the_capture_clock_across_odd_buffer_sizes() {
        let mut encoder = AudioEncoder::new().unwrap();
        assert!(encoder
            .push(&vec![0.0f32; 600 * 2], 1_000_000)
            .unwrap()
            .is_empty());
        let packets = encoder.push(&vec![0.0f32; 600 * 2], 1_012_500).unwrap();
        assert_eq!(packets.len(), 1);
        assert_eq!(packets[0].pts_us, 1_000_000);
        let packets = encoder.push(&vec![0.0f32; 1000 * 2], 2_000_000).unwrap();
        assert_eq!(packets.len(), 1);
        assert_eq!(packets[0].pts_us, 1_995_000);
    }
}
