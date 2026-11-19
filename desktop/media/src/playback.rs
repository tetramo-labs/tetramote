//! Plays the far end's Opus audio on the default output device. The stream
//! lives on its own thread because cpal streams are not `Send` everywhere.

use std::collections::VecDeque;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::opus::{OpusDecoder, OPUS_CHANNELS, OPUS_SAMPLE_RATE};
use crate::{MediaError, Result};

/// Beyond this much buffered audio the oldest is dropped, so latency can't grow.
const MAX_BUFFERED_MS: usize = 200;

enum Command {
    Packet(Vec<u8>),
    Lost,
    Stop,
}

pub struct AudioPlayer {
    tx: mpsc::Sender<Command>,
}

impl AudioPlayer {
    pub fn start() -> Result<Self> {
        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("tetra-playback".into())
            .spawn(move || run(rx, ready_tx))
            .map_err(|e| MediaError::Failed(format!("audio thread failed to start: {e}")))?;
        ready_rx
            .recv()
            .map_err(|_| MediaError::Failed("audio output failed to start".into()))??;
        Ok(Self { tx })
    }

    pub fn push(&self, packet: &[u8]) {
        let _ = self.tx.send(Command::Packet(packet.to_vec()));
    }

    pub fn conceal(&self) {
        let _ = self.tx.send(Command::Lost);
    }
}

impl Drop for AudioPlayer {
    fn drop(&mut self) {
        let _ = self.tx.send(Command::Stop);
    }
}

fn run(rx: mpsc::Receiver<Command>, ready: mpsc::Sender<Result<()>>) {
    let opened = open();
    let (stream, buffer, rate) = match opened {
        Ok(v) => v,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    let mut decoder = match OpusDecoder::new() {
        Ok(d) => d,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    let _ = ready.send(Ok(()));
    let max = rate as usize * OPUS_CHANNELS * MAX_BUFFERED_MS / 1000;
    while let Ok(command) = rx.recv() {
        let pcm = match command {
            Command::Packet(p) => decoder.decode(Some(&p)),
            Command::Lost => decoder.decode(None),
            Command::Stop => break,
        };
        let Ok(pcm) = pcm else { continue };
        let pcm = resample(&pcm, OPUS_SAMPLE_RATE, rate);
        let mut buf = buffer.lock().unwrap();
        buf.extend(pcm);
        let excess = buf.len().saturating_sub(max);
        buf.drain(..excess);
    }
    drop(stream);
}

type Opened = (cpal::Stream, Arc<Mutex<VecDeque<f32>>>, u32);

fn open() -> Result<Opened> {
    let device = cpal::default_host()
        .default_output_device()
        .ok_or_else(|| {
            MediaError::Unsupported(
                "No audio output device. Connect speakers or headphones.".into(),
            )
        })?;
    let default = device
        .default_output_config()
        .map_err(|e| MediaError::Failed(format!("reading the audio output format failed: {e}")))?;
    let rate = default.sample_rate();
    let channels = default.channels() as usize;
    let config = cpal::StreamConfig {
        channels: default.channels(),
        sample_rate: rate,
        buffer_size: cpal::BufferSize::Default,
    };
    let buffer: Arc<Mutex<VecDeque<f32>>> = Arc::new(Mutex::new(VecDeque::new()));
    let source = buffer.clone();
    let stream = device
        .build_output_stream(
            config,
            move |out: &mut [f32], _| {
                let mut buf = source.lock().unwrap();
                for frame in out.chunks_mut(channels) {
                    let l = buf.pop_front().unwrap_or(0.0);
                    let r = buf.pop_front().unwrap_or(l);
                    for (i, s) in frame.iter_mut().enumerate() {
                        *s = if i % 2 == 0 { l } else { r };
                    }
                }
            },
            |e| log::warn!("audio output error: {e}"),
            None,
        )
        .map_err(|e| MediaError::Failed(format!("opening the audio output failed: {e}")))?;
    stream
        .play()
        .map_err(|e| MediaError::Failed(format!("starting the audio output failed: {e}")))?;
    Ok((stream, buffer, sample_rate_hz(rate)))
}

fn sample_rate_hz<T: Into<u32>>(rate: T) -> u32 {
    rate.into()
}

/// Linear resampling of interleaved stereo; good enough for monitoring audio.
fn resample(pcm: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to {
        return pcm.to_vec();
    }
    let frames = pcm.len() / OPUS_CHANNELS;
    let out_frames = frames * to as usize / from as usize;
    let mut out = Vec::with_capacity(out_frames * OPUS_CHANNELS);
    for i in 0..out_frames {
        let pos = i as f64 * from as f64 / to as f64;
        let a = (pos.floor() as usize).min(frames.saturating_sub(1));
        let b = (a + 1).min(frames.saturating_sub(1));
        let t = (pos - a as f64) as f32;
        for c in 0..OPUS_CHANNELS {
            out.push(pcm[a * OPUS_CHANNELS + c] * (1.0 - t) + pcm[b * OPUS_CHANNELS + c] * t);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::resample;

    #[test]
    fn resamples_48k_to_44k1() {
        let pcm = vec![0.5f32; 960 * 2];
        let out = resample(&pcm, 48_000, 44_100);
        assert_eq!(out.len(), 882 * 2);
        assert!(out.iter().all(|&s| (s - 0.5).abs() < 1e-6));
        assert_eq!(resample(&pcm, 48_000, 48_000), pcm);
    }
}
