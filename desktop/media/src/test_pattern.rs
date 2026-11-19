//! A synthetic display for tests: a moving pattern through the software
//! encoder and silent Opus audio, so a host runs end to end without screen
//! recording permission and without showing anyone's real screen.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::opus::{OpusEncoder, OPUS_CHANNELS, OPUS_SAMPLE_RATE};
use crate::software::SoftwareEncoder;
use crate::{AudioPacket, DisplayInfo, Result, ScreenStream, StreamConfig, StreamInfo, StreamSink};

pub const WIDTH: u32 = 1280;
pub const HEIGHT: u32 = 800;
const FPS: u32 = 30;

pub fn display() -> DisplayInfo {
    DisplayInfo {
        id: 0,
        name: "Test pattern".into(),
        width: WIDTH,
        height: HEIGHT,
        point_width: WIDTH,
        point_height: HEIGHT,
        main: true,
    }
}

struct Pattern {
    info: StreamInfo,
    stop: Arc<AtomicBool>,
    keyframe: Arc<AtomicBool>,
    bitrate: Arc<AtomicU32>,
}

impl ScreenStream for Pattern {
    fn info(&self) -> &StreamInfo {
        &self.info
    }

    fn request_keyframe(&self) {
        self.keyframe.store(true, Ordering::Relaxed);
    }

    fn set_bitrate(&self, bps: u32) {
        self.bitrate.store(bps, Ordering::Relaxed);
    }
}

impl Drop for Pattern {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Bands that scroll a pixel column per frame, plus a frame counter in binary.
pub fn draw(frame: u64, bgra: &mut [u8]) {
    let (w, h) = (WIDTH as usize, HEIGHT as usize);
    for y in 0..h {
        for x in 0..w {
            let band = ((x + frame as usize * 4) / 160) % 6;
            let [b, g, r] = [
                [0x2b, 0x4d, 0xfc],
                [0x86, 0xac, 0xff],
                [0xf5, 0xf5, 0xf5],
                [0x40, 0x40, 0x40],
                [0x4a, 0xde, 0x80],
                [0x24, 0xbf, 0xfb],
            ][band];
            let shade = if y > h * 3 / 4 { 0.6 } else { 1.0 };
            let i = (y * w + x) * 4;
            bgra[i] = (b as f32 * shade) as u8;
            bgra[i + 1] = (g as f32 * shade) as u8;
            bgra[i + 2] = (r as f32 * shade) as u8;
            bgra[i + 3] = 0xff;
        }
    }
    for bit in 0..16 {
        let on = frame >> bit & 1 == 1;
        for y in 20..44 {
            for x in 20 + bit * 30..44 + bit * 30 {
                let i = (y * w + x) * 4;
                let v = if on { 0xff } else { 0x10 };
                bgra[i..i + 3].copy_from_slice(&[v, v, v]);
            }
        }
    }
}

pub fn start(config: StreamConfig, sink: Arc<dyn StreamSink>) -> Result<Box<dyn ScreenStream>> {
    let mut encoder = SoftwareEncoder::new(WIDTH, HEIGHT, config.bitrate_bps, FPS)?;
    let mut opus = OpusEncoder::new(64_000)?;
    let stop = Arc::new(AtomicBool::new(false));
    let keyframe = Arc::new(AtomicBool::new(true));
    let bitrate = Arc::new(AtomicU32::new(config.bitrate_bps));
    let info = StreamInfo {
        display: display(),
        width: WIDTH,
        height: HEIGHT,
        encoder: "openh264",
    };
    let pattern = Pattern {
        info,
        stop: stop.clone(),
        keyframe: keyframe.clone(),
        bitrate: bitrate.clone(),
    };
    let audio = config.audio;
    std::thread::Builder::new()
        .name("tetra-test-pattern".into())
        .spawn(move || {
            let started = Instant::now();
            let mut bgra = vec![0u8; (WIDTH * HEIGHT * 4) as usize];
            let silence = vec![0f32; (OPUS_SAMPLE_RATE / FPS) as usize * OPUS_CHANNELS];
            let mut reported = false;
            let mut applied = bitrate.load(Ordering::Relaxed);
            let mut frame = 0u64;
            while !stop.load(Ordering::Relaxed) {
                let pts_us = started.elapsed().as_micros() as u64;
                let wanted = bitrate.load(Ordering::Relaxed);
                if wanted != applied {
                    encoder.set_bitrate(wanted);
                    applied = wanted;
                }
                if sink.should_encode() {
                    draw(frame, &mut bgra);
                    let key = keyframe.swap(false, Ordering::Relaxed);
                    match encoder.encode_bgra(&bgra, (WIDTH * 4) as usize, pts_us, key) {
                        Ok(Some(encoded)) => sink.on_video(encoded),
                        Ok(None) => {}
                        Err(e) => {
                            if !reported {
                                reported = true;
                                sink.on_error(e);
                            }
                        }
                    }
                }
                if audio {
                    for data in opus.push(&silence).unwrap_or_default() {
                        sink.on_audio(AudioPacket { data, pts_us });
                    }
                }
                frame += 1;
                let due = started + Duration::from_secs_f64(frame as f64 / FPS as f64);
                std::thread::sleep(due.saturating_duration_since(Instant::now()));
            }
        })
        .map_err(|e| {
            crate::MediaError::Failed(format!("the test pattern thread failed to start: {e}"))
        })?;
    Ok(Box::new(pattern))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draws_opaque_pixels_and_the_frame_counter() {
        let mut bgra = vec![0u8; (WIDTH * HEIGHT * 4) as usize];
        draw(1, &mut bgra);
        let px = |x: usize, y: usize| {
            &bgra[(y * WIDTH as usize + x) * 4..(y * WIDTH as usize + x) * 4 + 4]
        };
        assert_eq!(px(30, 30), [0xff, 0xff, 0xff, 0xff]);
        assert_eq!(px(60, 30), [0x10, 0x10, 0x10, 0xff]);
        assert_eq!(px(600, 100)[3], 0xff);
    }
}
