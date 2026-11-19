//! Drives the macOS encoders with synthetic input, so it needs no Screen
//! Recording or Accessibility grant and shows no prompt:
//!
//!     cargo run -p tetra_media --example encode_probe -- /tmp/encode_probe
//!
//! Lists the displays, encodes 3 s of a moving bar at 1280x800 and 60 fps with
//! VideoToolbox (and openh264 once it exists) into `<dir>/<encoder>.h264`, and
//! encodes a 1 s tone to Opus. Check the video with
//! `ffprobe -v error -count_frames -show_entries stream=codec_name,width,height,nb_read_frames <file>`.

#[cfg(target_os = "macos")]
#[allow(dead_code)]
#[path = "../src/macos/video.rs"]
mod video;

#[cfg(target_os = "macos")]
#[allow(dead_code)]
#[path = "../src/macos/audio.rs"]
mod audio;

#[cfg(target_os = "macos")]
use tetra_media::{
    software, AudioPacket, EncodedFrame, MediaError, OpusEncoder, Result, OPUS_CHANNELS,
    OPUS_FRAME_SAMPLES, OPUS_SAMPLE_RATE,
};

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("encode_probe drives the macOS encoders. Run it on a Mac.");
}

#[cfg(target_os = "macos")]
fn main() {
    let dir = std::env::args()
        .nth(1)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("encode_probe"));
    if let Err(error) = mac::run(&dir) {
        eprintln!("encode_probe failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::f32::consts::TAU;
    use std::ops::Range;
    use std::path::Path;
    use std::ptr::{null_mut, NonNull};
    use std::sync::{Arc, Mutex};

    use objc2_core_foundation::CFRetained;
    use objc2_core_video::{
        CVPixelBuffer, CVPixelBufferCreate, CVPixelBufferGetBaseAddress,
        CVPixelBufferGetBaseAddressOfPlane, CVPixelBufferGetBytesPerRow,
        CVPixelBufferGetBytesPerRowOfPlane, CVPixelBufferGetHeightOfPlane,
        CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
    };
    use tetra_media::OpusDecoder;

    use super::audio::{stereo, AudioEncoder};
    use super::video::{FrameSink, VideoEncoder, BGRA, NV12};
    use super::{EncodedFrame, MediaError, Result};

    const WIDTH: usize = 1280;
    const HEIGHT: usize = 800;
    const FPS: u64 = 60;
    const FRAMES: u64 = 180;
    const BAR: usize = 96;

    type Start = fn(u32, u32, u32, u32, FrameSink) -> Result<VideoEncoder>;

    pub fn run(dir: &Path) -> std::result::Result<(), Box<dyn std::error::Error>> {
        std::fs::create_dir_all(dir)?;
        println!("permissions: {:?}", tetra_media::permissions());
        for display in tetra_media::displays()? {
            println!("display: {display:?}");
        }
        for (name, start, format) in [
            ("videotoolbox", VideoEncoder::videotoolbox as Start, NV12),
            ("openh264", VideoEncoder::software, BGRA),
        ] {
            if let Err(error) = encode(start, format, &dir.join(format!("{name}.h264"))) {
                println!("{name}: {error}");
            }
        }
        tone()?;
        Ok(())
    }

    fn encode(start: Start, format: u32, path: &Path) -> Result<()> {
        let results = Arc::new(Mutex::new(Vec::<Result<EncodedFrame>>::new()));
        let output: FrameSink = {
            let results = results.clone();
            Arc::new(move |frame| results.lock().unwrap().push(frame))
        };
        let mut encoder = start(WIDTH as u32, HEIGHT as u32, 8_000_000, FPS as u32, output)?;
        let name = encoder.name();
        for n in 0..FRAMES {
            let pixels = synthetic(format, n)?;
            encoder.encode(&pixels, 10_000_000 + n * 1_000_000 / FPS, n == 0 || n == 90)?;
            if n == 120 {
                encoder.set_bitrate(4_000_000);
            }
        }
        drop(encoder);
        let results = std::mem::take(&mut *results.lock().unwrap());
        let mut stream = Vec::new();
        let mut keyframes = Vec::new();
        let mut pts = Vec::new();
        for (index, result) in results.into_iter().enumerate() {
            let frame = result?;
            if frame.keyframe {
                keyframes.push(index);
            }
            pts.push(frame.pts_us);
            stream.extend_from_slice(&frame.data);
        }
        std::fs::write(path, &stream)
            .map_err(|e| MediaError::Failed(format!("Writing {}: {e}", path.display())))?;
        println!(
            "{name}: {} access units, keyframes at {keyframes:?}, {} bytes, pts {:?}..{:?} -> {}",
            pts.len(),
            stream.len(),
            pts.first(),
            pts.last(),
            path.display()
        );
        Ok(())
    }

    fn synthetic(format: u32, n: u64) -> Result<CFRetained<CVPixelBuffer>> {
        let mut buffer: *mut CVPixelBuffer = null_mut();
        let status = unsafe {
            CVPixelBufferCreate(
                None,
                WIDTH,
                HEIGHT,
                format,
                None,
                NonNull::from(&mut buffer),
            )
        };
        let buffer = NonNull::new(buffer)
            .filter(|_| status == 0)
            .map(|buffer| unsafe { CFRetained::from_raw(buffer) })
            .ok_or_else(|| MediaError::Failed(format!("CVPixelBufferCreate failed ({status})")))?;
        let bar = (n as usize * 7) % (WIDTH - BAR);
        unsafe {
            CVPixelBufferLockBaseAddress(&buffer, CVPixelBufferLockFlags::empty());
            if format == NV12 {
                let (luma, stride, rows) = plane(&buffer, 0);
                paint(luma, stride, rows, bar..bar + BAR, [16], [235]);
                let (chroma, stride, rows) = plane(&buffer, 1);
                paint(
                    chroma,
                    stride,
                    rows,
                    bar / 2..(bar + BAR) / 2,
                    [128, 128],
                    [128, 128],
                );
            } else {
                let base = CVPixelBufferGetBaseAddress(&buffer).cast::<u8>();
                let stride = CVPixelBufferGetBytesPerRow(&buffer);
                paint(
                    base,
                    stride,
                    HEIGHT,
                    bar..bar + BAR,
                    [48, 48, 48, 255],
                    [255, 255, 255, 255],
                );
            }
            CVPixelBufferUnlockBaseAddress(&buffer, CVPixelBufferLockFlags::empty());
        }
        Ok(buffer)
    }

    fn plane(buffer: &CVPixelBuffer, index: usize) -> (*mut u8, usize, usize) {
        (
            CVPixelBufferGetBaseAddressOfPlane(buffer, index).cast::<u8>(),
            CVPixelBufferGetBytesPerRowOfPlane(buffer, index),
            CVPixelBufferGetHeightOfPlane(buffer, index),
        )
    }

    /// `base` must point at `rows` locked rows of `stride` bytes.
    unsafe fn paint<const N: usize>(
        base: *mut u8,
        stride: usize,
        rows: usize,
        bar: Range<usize>,
        background: [u8; N],
        foreground: [u8; N],
    ) {
        let bytes = unsafe { std::slice::from_raw_parts_mut(base, stride * rows) };
        for row in bytes.chunks_exact_mut(stride) {
            for (column, pixel) in row.chunks_exact_mut(N).enumerate() {
                pixel.copy_from_slice(if bar.contains(&column) {
                    &foreground
                } else {
                    &background
                });
            }
        }
    }

    fn tone() -> Result<()> {
        let rate = super::OPUS_SAMPLE_RATE as usize;
        let wave = |frame: usize, hz: f32| (frame as f32 * hz * TAU / rate as f32).sin() * 0.3;
        let left: Vec<u8> = (0..rate)
            .flat_map(|f| wave(f, 440.0).to_ne_bytes())
            .collect();
        let right: Vec<u8> = (0..rate)
            .flat_map(|f| wave(f, 660.0).to_ne_bytes())
            .collect();
        let mut encoder = AudioEncoder::new()?;
        let mut packets: Vec<super::AudioPacket> = Vec::new();
        for start in (0..rate).step_by(1024) {
            let end = (start + 1024).min(rate);
            let pcm = stereo(&[
                (&left[start * 4..end * 4], 1),
                (&right[start * 4..end * 4], 1),
            ]);
            let pts = 10_000_000 + (start as u64 * 1_000_000 / rate as u64);
            packets.extend(encoder.push(&pcm, pts)?);
        }
        let mut decoder = OpusDecoder::new()?;
        let mut decoded = Vec::new();
        for packet in &packets {
            decoded.extend(decoder.decode(Some(&packet.data))?);
        }
        let rms = (decoded.iter().map(|s| s * s).sum::<f32>() / decoded.len().max(1) as f32).sqrt();
        println!(
            "opus: {} packets of {} frames from 1 s of tone, {} bytes, pts {:?}..{:?}, decoded {} samples ({} channels), rms {rms:.3}",
            packets.len(),
            super::OPUS_FRAME_SAMPLES,
            packets.iter().map(|p| p.data.len()).sum::<usize>(),
            packets.first().map(|p| p.pts_us),
            packets.last().map(|p| p.pts_us),
            decoded.len(),
            super::OPUS_CHANNELS,
        );
        Ok(())
    }
}
