//! openh264, the software H.264 encoder every platform falls back to. It
//! writes Annex B with SPS and PPS ahead of every IDR, never B-frames, and
//! keyframes only on request.

use std::os::raw::{c_int, c_void};

use openh264::encoder::{
    BitRate, Complexity, Encoder, EncoderConfig, FrameRate, FrameType, IntraFramePeriod,
    RateControlMode, SpsPpsStrategy, UsageType, VuiConfig,
};
use openh264::formats::YUVSlices;
use openh264::{OpenH264API, Timestamp};

use crate::{EncodedFrame, MediaError, Result};

const MAX_LONG_EDGE: u32 = 3840;
const MAX_SHORT_EDGE: u32 = 2160;
const ENCODER_OPTION_BITRATE: c_int = 5;
const ENCODER_OPTION_MAX_BITRATE: c_int = 6;
const SPATIAL_LAYER_ALL: c_int = 4;

/// openh264's `SBitrateInfo`; the layout and the option ids above must match
/// codec_app_def.h, which the `openh264` crate doesn't re-export.
#[repr(C)]
struct BitrateInfo {
    layer: c_int,
    bitrate: c_int,
}

pub struct SoftwareEncoder {
    encoder: Box<Encoder>,
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u32,
    applied_bitrate: u32,
    started: bool,
    keyframe_pending: bool,
    yuv: Vec<u8>,
}

impl SoftwareEncoder {
    pub fn new(width: u32, height: u32, bitrate_bps: u32, fps: u32) -> Result<Self> {
        if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            return Err(MediaError::Unsupported(format!(
                "The software H.264 encoder needs an even, non-zero frame size, not {width}x{height}. Pick a stream size with even sides."
            )));
        }
        if width.max(height) > MAX_LONG_EDGE || width.min(height) > MAX_SHORT_EDGE {
            return Err(MediaError::Unsupported(format!(
                "The software H.264 encoder stops at 3840x2160, not {width}x{height}. Lower the stream's long edge."
            )));
        }
        Ok(Self {
            encoder: create(bitrate_bps, fps)?,
            width,
            height,
            fps,
            bitrate: bitrate_bps,
            applied_bitrate: bitrate_bps,
            started: false,
            keyframe_pending: true,
            yuv: Vec::new(),
        })
    }

    /// One BGRA frame (`stride` bytes per row) in, one Annex B access unit out;
    /// `None` when the encoder skipped the frame to hold its bitrate.
    pub fn encode_bgra(
        &mut self,
        bgra: &[u8],
        stride: usize,
        pts_us: u64,
        keyframe: bool,
    ) -> Result<Option<EncodedFrame>> {
        let (width, height) = (self.width as usize, self.height as usize);
        if stride < width * 4 || bgra.len() < stride * (height - 1) + width * 4 {
            return Err(MediaError::Failed(format!(
                "The captured frame is smaller than {width}x{height} BGRA ({} bytes, stride {stride}). Restart the stream.",
                bgra.len()
            )));
        }
        bgra_to_yuv420(bgra, width, height, stride, false, &mut self.yuv);
        if !self.started && self.bitrate != self.applied_bitrate {
            self.encoder = create(self.bitrate, self.fps)?;
            self.applied_bitrate = self.bitrate;
        }
        self.keyframe_pending |= keyframe;
        if self.keyframe_pending && self.started {
            self.encoder.force_intra_frame();
        }
        let luma = width * height;
        let chroma = luma / 4;
        let source = YUVSlices::new(
            (
                &self.yuv[..luma],
                &self.yuv[luma..luma + chroma],
                &self.yuv[luma + chroma..],
            ),
            (width, height),
            (width, width / 2, width / 2),
        );
        let stream = self
            .encoder
            .encode_at(&source, Timestamp::from_millis(pts_us / 1000))
            .map_err(|e| {
                MediaError::Failed(format!(
                    "openh264 failed to encode a frame: {e}. Restart the stream."
                ))
            })?;
        self.started = true;
        let frame_type = stream.frame_type();
        let data = stream.to_vec();
        if self.bitrate != self.applied_bitrate {
            self.apply_bitrate();
        }
        if matches!(frame_type, FrameType::Skip | FrameType::Invalid) || data.is_empty() {
            return Ok(None);
        }
        let keyframe = frame_type == FrameType::IDR;
        if keyframe {
            self.keyframe_pending = false;
        }
        Ok(Some(EncodedFrame {
            data,
            keyframe,
            pts_us,
        }))
    }

    pub fn set_bitrate(&mut self, bps: u32) {
        self.bitrate = bps.clamp(1, i32::MAX as u32);
        if self.started {
            self.apply_bitrate();
        }
    }

    fn apply_bitrate(&mut self) {
        let raising = self.bitrate > self.applied_bitrate;
        let order = if raising {
            [ENCODER_OPTION_MAX_BITRATE, ENCODER_OPTION_BITRATE]
        } else {
            [ENCODER_OPTION_BITRATE, ENCODER_OPTION_MAX_BITRATE]
        };
        for option in order {
            let mut info = BitrateInfo {
                layer: SPATIAL_LAYER_ALL,
                bitrate: self.bitrate as c_int,
            };
            let status = unsafe {
                self.encoder
                    .raw_api()
                    .set_option(option, (&mut info as *mut BitrateInfo).cast::<c_void>())
            };
            if status != 0 {
                log::warn!(
                    "openh264 refused bitrate {} (option {option}, status {status})",
                    self.bitrate
                );
            }
        }
        self.applied_bitrate = self.bitrate;
    }
}

fn create(bitrate_bps: u32, fps: u32) -> Result<Box<Encoder>> {
    let config = EncoderConfig::new()
        .bitrate(BitRate::from_bps(bitrate_bps))
        .max_frame_rate(FrameRate::from_hz(fps.max(1) as f32))
        .rate_control_mode(RateControlMode::Bitrate)
        .usage_type(UsageType::ScreenContentRealTime)
        .complexity(Complexity::Low)
        .adaptive_quantization(false)
        .background_detection(false)
        .skip_frames(true)
        .intra_frame_period(IntraFramePeriod::from_num_frames(0))
        .sps_pps_strategy(SpsPpsStrategy::ConstantId)
        .vui(VuiConfig::bt709());
    Encoder::with_api_config(OpenH264API::from_source(), config)
        .map(Box::new)
        .map_err(|e| {
            MediaError::Failed(format!(
                "openh264 failed to start: {e}. Restart the stream."
            ))
        })
}

/// BGRA to 4:2:0 (I420, or NV12 when `nv12`) in BT.709 limited range, the
/// colour space every encoder here declares in its SPS.
pub(crate) fn bgra_to_yuv420(
    bgra: &[u8],
    width: usize,
    height: usize,
    stride: usize,
    nv12: bool,
    out: &mut Vec<u8>,
) {
    let chroma_width = width.div_ceil(2);
    let chroma_height = height.div_ceil(2);
    let luma_len = width * height;
    let plane = chroma_width * chroma_height;
    out.clear();
    out.resize(luma_len + 2 * plane, 0);
    if width == 0 || height == 0 {
        return;
    }
    let (luma, chroma) = out.split_at_mut(luma_len);
    for (row, line) in luma.chunks_exact_mut(width).enumerate() {
        let src = &bgra[row * stride..row * stride + width * 4];
        for (y, px) in line.iter_mut().zip(src.as_chunks::<4>().0) {
            *y = luma_of(px[2] as i32, px[1] as i32, px[0] as i32);
        }
    }
    for cy in 0..chroma_height {
        let top = 2 * cy * stride;
        let bottom = (2 * cy + 1).min(height - 1) * stride;
        for cx in 0..chroma_width {
            let left = 8 * cx;
            let right = 4 * (2 * cx + 1).min(width - 1);
            let mut sums = [0i32; 3];
            for at in [top + left, top + right, bottom + left, bottom + right] {
                sums[0] += bgra[at] as i32;
                sums[1] += bgra[at + 1] as i32;
                sums[2] += bgra[at + 2] as i32;
            }
            let (u, v) = chroma_of(sums[2], sums[1], sums[0]);
            let i = cy * chroma_width + cx;
            if nv12 {
                chroma[2 * i] = u;
                chroma[2 * i + 1] = v;
            } else {
                chroma[i] = u;
                chroma[plane + i] = v;
            }
        }
    }
}

fn luma_of(r: i32, g: i32, b: i32) -> u8 {
    (((11966 * r + 40254 * g + 4064 * b + 32768) >> 16) + 16) as u8
}

/// Chroma from the sums of a 2x2 block's channels.
fn chroma_of(r: i32, g: i32, b: i32) -> (u8, u8) {
    let bias = (128 << 18) + (1 << 17);
    let u = (-6596 * r - 22189 * g + 28785 * b + bias) >> 18;
    let v = (28785 * r - 26146 * g - 2639 * b + bias) >> 18;
    (u.clamp(0, 255) as u8, v.clamp(0, 255) as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nal_types(data: &[u8]) -> Vec<u8> {
        let mut types = Vec::new();
        let mut i = 0;
        while i + 3 < data.len() {
            if data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
                types.push(data[i + 3] & 0x1f);
                i += 3;
            } else {
                i += 1;
            }
        }
        types
    }

    fn frame(width: usize, height: usize, shift: usize) -> Vec<u8> {
        let mut bgra = vec![0u8; width * height * 4];
        for y in 0..height {
            for x in 0..width {
                let p = (y * width + x) * 4;
                bgra[p] = ((x + shift) * 4) as u8;
                bgra[p + 1] = (y * 5) as u8;
                bgra[p + 2] = ((x + y + shift) * 3) as u8;
                bgra[p + 3] = 255;
            }
        }
        bgra
    }

    #[test]
    fn converts_bt709_limited_range() {
        let mut out = Vec::new();
        let white = [255u8; 16];
        bgra_to_yuv420(&white, 2, 2, 8, false, &mut out);
        assert_eq!(out, [235, 235, 235, 235, 128, 128]);
        let black = [0, 0, 0, 255].repeat(4);
        bgra_to_yuv420(&black, 2, 2, 8, false, &mut out);
        assert_eq!(out, [16, 16, 16, 16, 128, 128]);
        let red = [0, 0, 255, 255].repeat(4);
        bgra_to_yuv420(&red, 2, 2, 8, false, &mut out);
        assert_eq!(out, [63, 63, 63, 63, 102, 240]);
        let blue = [255, 0, 0, 255].repeat(4);
        bgra_to_yuv420(&blue, 2, 2, 8, true, &mut out);
        assert_eq!(out, [32, 32, 32, 32, 240, 118]);
    }

    #[test]
    fn honours_stride_and_chroma_layout() {
        let mut bgra = vec![9u8; 2 * 12];
        bgra[..8].copy_from_slice(&[255, 255, 255, 255, 0, 0, 0, 255]);
        bgra[12..20].copy_from_slice(&[255, 255, 255, 255, 0, 0, 0, 255]);
        let mut planar = Vec::new();
        bgra_to_yuv420(&bgra, 2, 2, 12, false, &mut planar);
        assert_eq!(planar, [235, 16, 235, 16, 128, 128]);
        let mut nv12 = Vec::new();
        bgra_to_yuv420(&[0, 0, 255, 255].repeat(16), 4, 4, 16, true, &mut nv12);
        assert_eq!(&nv12[16..], [102, 240, 102, 240, 102, 240, 102, 240]);
    }

    #[test]
    fn first_frame_is_an_idr_with_parameter_sets() {
        let (width, height) = (64, 48);
        let mut encoder = SoftwareEncoder::new(width, height, 2_000_000, 30).unwrap();
        let first = encoder
            .encode_bgra(&frame(64, 48, 0), 64 * 4, 0, false)
            .unwrap()
            .expect("the first frame is never skipped");
        assert!(first.keyframe);
        assert!(first.data.starts_with(&[0, 0, 0, 1]));
        let types = nal_types(&first.data);
        assert!(types.contains(&7), "SPS missing: {types:?}");
        assert!(types.contains(&8), "PPS missing: {types:?}");
        assert!(types.contains(&5), "IDR slice missing: {types:?}");
        assert_eq!(first.pts_us, 0);
    }

    #[test]
    fn forced_keyframes_are_idr_and_others_are_not() {
        let mut encoder = SoftwareEncoder::new(64, 48, 2_000_000, 30).unwrap();
        encoder
            .encode_bgra(&frame(64, 48, 0), 256, 0, false)
            .unwrap();
        let delta = encoder
            .encode_bgra(&frame(64, 48, 1), 256, 33_333, false)
            .unwrap()
            .expect("a delta frame at 2 Mbps");
        assert!(!delta.keyframe);
        assert!(!nal_types(&delta.data).contains(&5));
        encoder.set_bitrate(500_000);
        let forced = encoder
            .encode_bgra(&frame(64, 48, 2), 256, 66_666, true)
            .unwrap()
            .expect("a forced keyframe");
        assert!(forced.keyframe);
        let types = nal_types(&forced.data);
        assert!(types.contains(&5), "IDR slice missing: {types:?}");
        assert!(
            types.contains(&7) && types.contains(&8),
            "parameter sets missing: {types:?}"
        );
        assert_eq!(forced.pts_us, 66_666);
    }

    #[test]
    fn padded_rows_encode() {
        let mut encoder = SoftwareEncoder::new(32, 32, 1_000_000, 60).unwrap();
        let mut padded = vec![0u8; 40 * 4 * 32];
        for row in 0..32 {
            padded[row * 160..row * 160 + 128]
                .copy_from_slice(&frame(32, 32, 0)[row * 128..row * 128 + 128]);
        }
        assert!(encoder
            .encode_bgra(&padded, 160, 0, false)
            .unwrap()
            .is_some());
        assert!(encoder.encode_bgra(&padded[..100], 160, 1, false).is_err());
    }

    #[test]
    fn rejects_odd_and_oversized_frames() {
        assert!(SoftwareEncoder::new(641, 480, 1_000_000, 30).is_err());
        assert!(SoftwareEncoder::new(4096, 2160, 1_000_000, 30).is_err());
        assert!(SoftwareEncoder::new(2560, 1440, 1_000_000, 30).is_ok());
    }
}
