//! What the Windows and Linux hosts share: stream sizing, the capture clock,
//! BGRA scaling, the wire's Mac key and click semantics turned into plain
//! presses, and system audio cut into 20 ms Opus packets.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tetra_core::input::{FLAG_COMMAND, FLAG_CONTROL, FLAG_OPTION, FLAG_SHIFT};

use crate::opus::{OpusEncoder, OPUS_CHANNELS, OPUS_FRAME_SAMPLES, OPUS_SAMPLE_RATE};
use crate::{AudioPacket, Result};

const KEY_SHIFT: u16 = 0x38;
const KEY_OPTION: u16 = 0x3a;
const KEY_CONTROL: u16 = 0x3b;
const KEY_RIGHT_SHIFT: u16 = 0x3c;
const KEY_RIGHT_OPTION: u16 = 0x3d;
const KEY_RIGHT_CONTROL: u16 = 0x3e;
const MODIFIER_KEYS: [u16; 6] = [
    KEY_SHIFT,
    KEY_RIGHT_SHIFT,
    KEY_OPTION,
    KEY_RIGHT_OPTION,
    KEY_CONTROL,
    KEY_RIGHT_CONTROL,
];
const AUDIO_BITRATE: i32 = 128_000;
const AUDIO_RESYNC_US: u64 = 60_000;

/// Fits a display inside `max_long_edge` with even sides, as H.264's 4:2:0
/// subsampling needs; the same rule as the Mac host's `streamSize`.
pub fn stream_size(pixel_width: u32, pixel_height: u32, max_long_edge: u32) -> (u32, u32) {
    let long = pixel_width.max(pixel_height);
    let scale = if long > max_long_edge {
        max_long_edge as f64 / long as f64
    } else {
        1.0
    };
    let even = |v: u32| (((v as f64 * scale).floor() as u32) & !1).max(2);
    (even(pixel_width), even(pixel_height))
}

/// Microseconds on the clock both video and audio timestamps use.
pub fn now_us() -> u64 {
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    EPOCH.get_or_init(Instant::now).elapsed().as_micros() as u64
}

/// Bilinear resize of a BGRA frame into a tightly packed one.
pub fn scale_bgra(
    src: &[u8],
    width: usize,
    height: usize,
    stride: usize,
    out_width: usize,
    out_height: usize,
    out: &mut Vec<u8>,
) {
    out.clear();
    out.resize(out_width * out_height * 4, 0);
    if width == 0 || height == 0 {
        return;
    }
    let columns: Vec<(usize, usize, u32)> =
        (0..out_width).map(|x| taps(x, width, out_width)).collect();
    for (y, dst) in out.chunks_exact_mut(out_width * 4).enumerate() {
        let (y0, y1, wy) = taps(y, height, out_height);
        let top = &src[y0 * stride..];
        let bottom = &src[y1 * stride..];
        for (px, &(x0, x1, wx)) in dst.as_chunks_mut::<4>().0.iter_mut().zip(&columns) {
            for (c, value) in px.iter_mut().enumerate() {
                let upper = top[x0 * 4 + c] as u32 * (256 - wx) + top[x1 * 4 + c] as u32 * wx;
                let lower = bottom[x0 * 4 + c] as u32 * (256 - wx) + bottom[x1 * 4 + c] as u32 * wx;
                *value = ((upper * (256 - wy) + lower * wy + 32768) >> 16) as u8;
            }
        }
    }
}

fn taps(i: usize, from: usize, to: usize) -> (usize, usize, u32) {
    let center = ((i as f64 + 0.5) * from as f64 / to as f64 - 0.5).max(0.0);
    let first = (center.floor() as usize).min(from - 1);
    let second = (first + 1).min(from - 1);
    let weight = ((center - first as f64) * 256.0).round() as u32;
    (first, second, weight.min(256))
}

/// The Mac key code a Windows or Linux host posts for a wire key code:
/// Command becomes Control, so the phone's ⌘C copies there too.
pub fn host_key(mac: u16) -> u16 {
    match mac {
        0x37 => KEY_CONTROL,
        0x36 => KEY_RIGHT_CONTROL,
        other => other,
    }
}

/// Wire key records carry their modifiers as CGEventFlags, which no other OS
/// reads, so this presses the missing modifiers around the key and releases
/// them after it. Steps are Mac key codes after `host_key`.
#[derive(Default)]
pub struct KeyPresser {
    held: Vec<u16>,
    synthetic: Vec<u16>,
}

impl KeyPresser {
    pub fn key(&mut self, key_code: u16, down: bool, flags: u32) -> Vec<(u16, bool)> {
        let key = host_key(key_code);
        if MODIFIER_KEYS.contains(&key) {
            self.held.retain(|&k| k != key);
            if down {
                self.held.push(key);
            }
            return vec![(key, down)];
        }
        let mut steps = Vec::new();
        if !down {
            steps.push((key, false));
            while let Some(modifier) = self.synthetic.pop() {
                steps.push((modifier, false));
            }
            return steps;
        }
        let wanted = [
            (
                KEY_CONTROL,
                KEY_RIGHT_CONTROL,
                flags & (FLAG_COMMAND | FLAG_CONTROL) != 0,
            ),
            (KEY_OPTION, KEY_RIGHT_OPTION, flags & FLAG_OPTION != 0),
            (KEY_SHIFT, KEY_RIGHT_SHIFT, flags & FLAG_SHIFT != 0),
        ];
        for (left, right, want) in wanted {
            let held = self.held.contains(&left) || self.held.contains(&right);
            let pressed = self.synthetic.contains(&left);
            if want && !held && !pressed {
                steps.push((left, true));
                self.synthetic.push(left);
            } else if !want && pressed {
                steps.push((left, false));
                self.synthetic.retain(|&k| k != left);
            }
        }
        steps.push((key, true));
        steps
    }

    /// Key ups for every modifier still down, so none stays stuck when input stops.
    pub fn release_all(&mut self) -> Vec<(u16, bool)> {
        let mut steps: Vec<(u16, bool)> =
            self.synthetic.drain(..).rev().map(|k| (k, false)).collect();
        steps.extend(self.held.drain(..).map(|k| (k, false)));
        steps
    }
}

/// Windows and Linux count double clicks from timing alone, so a wire click
/// count the OS would miss (the taps crossed the network too far apart) needs
/// extra clicks posted right before the press.
pub struct ClickTimer {
    interval: Duration,
    last: Option<(u8, Instant, u8)>,
}

impl ClickTimer {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            last: None,
        }
    }

    /// Call on every button press; returns how many whole clicks to post first.
    pub fn extra_clicks(&mut self, button: u8, clicks: u8, now: Instant) -> u8 {
        let natural = match self.last {
            Some((last, at, count))
                if last == button && now.saturating_duration_since(at) <= self.interval =>
            {
                count.saturating_add(1)
            }
            _ => 1,
        };
        let extra = clicks.saturating_sub(natural);
        self.last = Some((button, now, natural + extra));
        extra
    }
}

/// System audio at any rate and channel count in, one 48 kHz stereo Opus
/// packet per 20 ms out, stamped on `now_us`. A gap in the input (Windows
/// loopback goes quiet when nothing plays) restarts the timeline.
pub struct AudioPacketizer {
    encoder: OpusEncoder,
    rate: u32,
    channels: usize,
    step: f64,
    position: f64,
    previous: Option<[f32; 2]>,
    stereo: Vec<f32>,
    origin_us: i64,
    frames_in: u64,
    frames_out: u64,
}

impl AudioPacketizer {
    pub fn new(rate: u32, channels: usize) -> Result<Self> {
        Ok(Self {
            encoder: OpusEncoder::new(AUDIO_BITRATE)?,
            rate: rate.max(1),
            channels: channels.max(1),
            step: rate.max(1) as f64 / OPUS_SAMPLE_RATE as f64,
            position: 0.0,
            previous: None,
            stereo: Vec::new(),
            origin_us: 0,
            frames_in: 0,
            frames_out: 0,
        })
    }

    /// `captured_at_us` is when the last frame of `samples` (interleaved) was captured.
    pub fn push(&mut self, samples: &[f32], captured_at_us: u64) -> Result<Vec<AudioPacket>> {
        let frames = samples.len() / self.channels;
        if frames == 0 {
            return Ok(Vec::new());
        }
        let start_us =
            captured_at_us as i64 - (frames as u64 * 1_000_000 / self.rate as u64) as i64;
        let expected_us = self.origin_us + self.frames_us(self.frames_in);
        if self.frames_in == 0 || expected_us.abs_diff(start_us) > AUDIO_RESYNC_US {
            self.origin_us = start_us - self.frames_us(self.frames_in);
        }
        self.mix(&samples[..frames * self.channels]);
        let packets = self.encoder.push(&self.stereo)?;
        self.frames_in += (self.stereo.len() / OPUS_CHANNELS) as u64;
        let mut out = Vec::with_capacity(packets.len());
        for data in packets {
            let pts_us = (self.origin_us + self.frames_us(self.frames_out)).max(0) as u64;
            self.frames_out += OPUS_FRAME_SAMPLES as u64;
            out.push(AudioPacket { data, pts_us });
        }
        Ok(out)
    }

    fn frames_us(&self, frames: u64) -> i64 {
        (frames * 1_000_000 / OPUS_SAMPLE_RATE as u64) as i64
    }

    fn mix(&mut self, samples: &[f32]) {
        let channels = self.channels;
        let frame = |f: &[f32]| {
            if channels == 1 {
                [f[0], f[0]]
            } else {
                [f[0], f[1]]
            }
        };
        self.stereo.clear();
        if self.rate == OPUS_SAMPLE_RATE {
            self.stereo
                .extend(samples.chunks_exact(channels).flat_map(frame));
            return;
        }
        let mut input = Vec::with_capacity(samples.len() / channels + 1);
        input.push(self.previous.unwrap_or_else(|| frame(samples)));
        input.extend(samples.chunks_exact(channels).map(frame));
        let last = (input.len() - 1) as f64;
        while self.position < last {
            let i = self.position as usize;
            let t = (self.position - i as f64) as f32;
            let (a, b) = (input[i], input[i + 1]);
            self.stereo
                .extend(a.iter().zip(b).map(|(a, b)| a + (b - a) * t));
            self.position += self.step;
        }
        self.position -= last;
        self.previous = input.last().copied();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_streams_like_the_mac_host() {
        assert_eq!(stream_size(3840, 2160, 2560), (2560, 1440));
        assert_eq!(stream_size(5120, 2880, 2560), (2560, 1440));
        assert_eq!(stream_size(1920, 1080, 2560), (1920, 1080));
        assert_eq!(stream_size(3456, 2234, 2560), (2560, 1654));
        assert_eq!(stream_size(1365, 767, 2560), (1364, 766));
        assert_eq!(stream_size(1440, 2560, 1280), (720, 1280));
    }

    #[test]
    fn the_capture_clock_never_runs_backwards() {
        let first = now_us();
        std::thread::sleep(Duration::from_millis(2));
        assert!(now_us() >= first + 2_000);
    }

    #[test]
    fn scales_bgra_bilinearly() {
        let row = |v: [u8; 4]| v.iter().flat_map(|&b| [b; 4]).collect::<Vec<u8>>();
        let src = [row([0, 100, 200, 50]), row([100, 200, 0, 250])].concat();
        let mut out = Vec::new();
        scale_bgra(&src, 4, 2, 16, 2, 1, &mut out);
        assert_eq!(out, [100, 100, 100, 100, 125, 125, 125, 125]);
        scale_bgra(&src, 4, 2, 16, 4, 2, &mut out);
        assert_eq!(out, src);
    }

    #[test]
    fn maps_command_to_control() {
        assert_eq!(host_key(0x37), 0x3b);
        assert_eq!(host_key(0x36), 0x3e);
        assert_eq!(host_key(0x08), 0x08);
    }

    #[test]
    fn presses_flag_modifiers_around_the_key() {
        let mut keys = KeyPresser::default();
        assert_eq!(
            keys.key(0x08, true, FLAG_COMMAND),
            [(0x3b, true), (0x08, true)]
        );
        assert_eq!(
            keys.key(0x08, false, FLAG_COMMAND),
            [(0x08, false), (0x3b, false)]
        );
        assert_eq!(
            keys.key(0x00, true, FLAG_OPTION | FLAG_SHIFT),
            [(0x3a, true), (0x38, true), (0x00, true)]
        );
        assert_eq!(
            keys.key(0x00, false, FLAG_OPTION | FLAG_SHIFT),
            [(0x00, false), (0x38, false), (0x3a, false)]
        );
        assert_eq!(keys.key(0x24, true, 0), [(0x24, true)]);
    }

    #[test]
    fn leaves_held_modifiers_alone() {
        let mut keys = KeyPresser::default();
        assert_eq!(keys.key(0x37, true, FLAG_COMMAND), [(0x3b, true)]);
        assert_eq!(keys.key(0x08, true, FLAG_COMMAND), [(0x08, true)]);
        assert_eq!(keys.key(0x08, false, FLAG_COMMAND), [(0x08, false)]);
        assert_eq!(
            keys.key(0x09, true, FLAG_COMMAND | FLAG_SHIFT),
            [(0x38, true), (0x09, true)]
        );
        assert_eq!(keys.release_all(), [(0x38, false), (0x3b, false)]);
        assert_eq!(keys.release_all(), []);
    }

    #[test]
    fn adds_clicks_the_os_would_miss() {
        let mut timer = ClickTimer::new(Duration::from_millis(500));
        let t0 = Instant::now();
        assert_eq!(timer.extra_clicks(0, 1, t0), 0);
        assert_eq!(timer.extra_clicks(0, 2, t0 + Duration::from_millis(300)), 0);
        assert_eq!(
            timer.extra_clicks(0, 3, t0 + Duration::from_millis(2000)),
            2
        );
        assert_eq!(
            timer.extra_clicks(1, 2, t0 + Duration::from_millis(2100)),
            1
        );
        assert_eq!(
            timer.extra_clicks(0, 1, t0 + Duration::from_millis(2200)),
            0
        );
    }

    #[test]
    fn packets_48k_audio_on_the_capture_clock() {
        let mut audio = AudioPacketizer::new(48_000, 2).unwrap();
        let chunk = vec![0.1f32; 960 * 2];
        let first = audio.push(&chunk, 20_000).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].pts_us, 0);
        let second = audio.push(&chunk, 40_000).unwrap();
        assert_eq!(second[0].pts_us, 20_000);
        let after_gap = audio.push(&chunk, 1_040_000).unwrap();
        assert_eq!(after_gap[0].pts_us, 1_020_000);
    }

    #[test]
    fn resamples_44k1_mono_to_48k_stereo_packets() {
        let mut audio = AudioPacketizer::new(44_100, 1).unwrap();
        let chunk = vec![0.25f32; 441];
        let mut packets = Vec::new();
        for k in 0..101u64 {
            packets.extend(audio.push(&chunk, 10_000 * (k + 1)).unwrap());
        }
        assert_eq!(packets.len(), 50);
        assert_eq!(packets[1].pts_us, 20_000);
        assert_eq!(packets[49].pts_us, 980_000);
    }
}
