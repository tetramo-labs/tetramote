use audiopus::coder::{Decoder, Encoder};
use audiopus::packet::Packet;
use audiopus::{Application, Bitrate, Channels, MutSignals, SampleRate};

use crate::{MediaError, Result};

pub const OPUS_SAMPLE_RATE: u32 = 48_000;
pub const OPUS_CHANNELS: usize = 2;
/// 20 ms per packet, the frame size every side of the protocol uses.
pub const OPUS_FRAME_SAMPLES: usize = 960;

const MAX_PACKET: usize = 4000;

fn failed(what: &str, e: audiopus::Error) -> MediaError {
    MediaError::Failed(format!("Opus {what} failed: {e}"))
}

/// Interleaved stereo f32 in, one packet per 20 ms frame out.
pub struct OpusEncoder {
    encoder: Encoder,
    pending: Vec<f32>,
}

impl OpusEncoder {
    pub fn new(bitrate_bps: i32) -> Result<Self> {
        let mut encoder =
            Encoder::new(SampleRate::Hz48000, Channels::Stereo, Application::LowDelay)
                .map_err(|e| failed("encoder", e))?;
        encoder
            .set_bitrate(Bitrate::BitsPerSecond(bitrate_bps))
            .map_err(|e| failed("bitrate", e))?;
        Ok(Self {
            encoder,
            pending: Vec::with_capacity(OPUS_FRAME_SAMPLES * OPUS_CHANNELS * 2),
        })
    }

    /// Buffers `samples` and returns every whole packet they complete.
    pub fn push(&mut self, samples: &[f32]) -> Result<Vec<Vec<u8>>> {
        self.pending.extend_from_slice(samples);
        let frame = OPUS_FRAME_SAMPLES * OPUS_CHANNELS;
        let mut packets = Vec::new();
        while self.pending.len() >= frame {
            let mut out = vec![0u8; MAX_PACKET];
            let len = self
                .encoder
                .encode_float(&self.pending[..frame], &mut out)
                .map_err(|e| failed("encode", e))?;
            out.truncate(len);
            packets.push(out);
            self.pending.drain(..frame);
        }
        Ok(packets)
    }
}

pub struct OpusDecoder {
    decoder: Decoder,
}

impl OpusDecoder {
    pub fn new() -> Result<Self> {
        Ok(Self {
            decoder: Decoder::new(SampleRate::Hz48000, Channels::Stereo)
                .map_err(|e| failed("decoder", e))?,
        })
    }

    /// Interleaved stereo f32 for one packet; `None` conceals one lost 20 ms
    /// packet (concealment fills whatever buffer it gets, so it gets one frame).
    pub fn decode(&mut self, packet: Option<&[u8]>) -> Result<Vec<f32>> {
        let capacity = if packet.is_some() { 6 } else { 1 };
        let mut out = vec![0f32; OPUS_FRAME_SAMPLES * OPUS_CHANNELS * capacity];
        let packet = packet
            .map(Packet::try_from)
            .transpose()
            .map_err(|e| failed("packet", e))?;
        let signals = MutSignals::try_from(&mut out[..]).map_err(|e| failed("buffer", e))?;
        let samples = self
            .decoder
            .decode_float(packet, signals, false)
            .map_err(|e| failed("decode", e))?;
        out.truncate(samples * OPUS_CHANNELS);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_tone_in_20_ms_packets() {
        let mut encoder = OpusEncoder::new(128_000).unwrap();
        let tone: Vec<f32> = (0..OPUS_FRAME_SAMPLES * 3)
            .flat_map(|i| {
                let v = (i as f32 * 440.0 * std::f32::consts::TAU / 48_000.0).sin() * 0.3;
                [v, v]
            })
            .collect();
        let packets = encoder.push(&tone[..tone.len() - 10]).unwrap();
        assert_eq!(packets.len(), 2);
        let mut decoder = OpusDecoder::new().unwrap();
        let pcm = decoder.decode(Some(&packets[0])).unwrap();
        assert_eq!(pcm.len(), OPUS_FRAME_SAMPLES * OPUS_CHANNELS);
        assert_eq!(
            decoder.decode(None).unwrap().len(),
            OPUS_FRAME_SAMPLES * OPUS_CHANNELS
        );
    }
}
