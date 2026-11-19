//! H.264 for the stream: a VideoToolbox session, or openh264 when VideoToolbox
//! can't start one. Every keyframe leaves as Annex B with its SPS and PPS.

use std::ffi::{c_int, c_void};
use std::ptr::{null, null_mut, NonNull};
use std::sync::Arc;

use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType};
use objc2_core_media::{
    kCMVideoCodecType_H264, CMFormatDescription, CMSampleBuffer, CMTime, CMTimeFlags,
    CMVideoFormatDescriptionGetH264ParameterSetAtIndex,
};
use objc2_core_video::{
    kCVPixelFormatType_32BGRA, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, CVPixelBuffer,
    CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow, CVPixelBufferGetHeight,
    CVPixelBufferGetPixelFormatType, CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags,
    CVPixelBufferUnlockBaseAddress,
};
use objc2_video_toolbox::{
    kVTCompressionPropertyKey_AllowFrameReordering, kVTCompressionPropertyKey_AverageBitRate,
    kVTCompressionPropertyKey_ExpectedFrameRate, kVTCompressionPropertyKey_MaxKeyFrameInterval,
    kVTCompressionPropertyKey_ProfileLevel, kVTCompressionPropertyKey_RealTime,
    kVTEncodeFrameOptionKey_ForceKeyFrame, kVTProfileLevel_H264_High_AutoLevel,
    kVTProfileLevel_H264_Main_AutoLevel, kVTVideoEncoderSpecification_EnableLowLatencyRateControl,
    VTCompressionSession, VTEncodeInfoFlags, VTSessionSetProperty,
};

use crate::software::SoftwareEncoder;
use crate::{EncodedFrame, MediaError, Result};

pub const NV12: u32 = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;
pub const BGRA: u32 = kCVPixelFormatType_32BGRA;

/// Receives every encoded access unit, or the error that stopped one. Called
/// from VideoToolbox's own threads.
pub type FrameSink = Arc<dyn Fn(Result<EncodedFrame>) + Send + Sync>;

pub enum VideoEncoder {
    VideoToolbox(VtEncoder),
    Software(SoftwareEncoder, FrameSink),
}

impl VideoEncoder {
    pub fn new(
        width: u32,
        height: u32,
        bitrate_bps: u32,
        fps: u32,
        output: FrameSink,
    ) -> Result<Self> {
        Self::videotoolbox(width, height, bitrate_bps, fps, output.clone()).or_else(|hardware| {
            log::warn!("{hardware} Encoding with openh264 instead.");
            Self::software(width, height, bitrate_bps, fps, output).map_err(|software| {
                MediaError::Failed(format!(
                    "{hardware} The software encoder didn't start either: {software}"
                ))
            })
        })
    }

    pub fn videotoolbox(
        width: u32,
        height: u32,
        bitrate_bps: u32,
        fps: u32,
        output: FrameSink,
    ) -> Result<Self> {
        VtEncoder::new(width, height, bitrate_bps, fps, output).map(Self::VideoToolbox)
    }

    pub fn software(
        width: u32,
        height: u32,
        bitrate_bps: u32,
        fps: u32,
        output: FrameSink,
    ) -> Result<Self> {
        SoftwareEncoder::new(width, height, bitrate_bps, fps)
            .map(|encoder| Self::Software(encoder, output))
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::VideoToolbox(_) => "videotoolbox",
            Self::Software(..) => "openh264",
        }
    }

    pub fn pixel_format(&self) -> u32 {
        match self {
            Self::VideoToolbox(_) => NV12,
            Self::Software(..) => BGRA,
        }
    }

    pub fn set_bitrate(&mut self, bps: u32) {
        match self {
            Self::VideoToolbox(encoder) => encoder.set_bitrate(bps),
            Self::Software(encoder, _) => encoder.set_bitrate(bps),
        }
    }

    /// VideoToolbox delivers to the sink later on its own thread; openh264
    /// delivers before this returns.
    pub fn encode(&mut self, pixels: &CVPixelBuffer, pts_us: u64, keyframe: bool) -> Result<()> {
        match self {
            Self::VideoToolbox(encoder) => encoder.encode(pixels, pts_us, keyframe),
            Self::Software(encoder, output) => {
                let frame = with_bgra(pixels, |bgra, stride| {
                    encoder.encode_bgra(bgra, stride, pts_us, keyframe)
                })??;
                if let Some(frame) = frame {
                    output(Ok(frame));
                }
                Ok(())
            }
        }
    }
}

/// A low-latency VideoToolbox H.264 session: no B-frames, keyframes only on
/// request. VideoToolbox sessions may be driven from any thread, one call at a
/// time, which is what makes the `Send` below sound.
pub struct VtEncoder {
    session: CFRetained<VTCompressionSession>,
    _output: Box<FrameSink>,
}

unsafe impl Send for VtEncoder {}

impl VtEncoder {
    fn new(width: u32, height: u32, bitrate_bps: u32, fps: u32, output: FrameSink) -> Result<Self> {
        let output = Box::new(output);
        let refcon = std::ptr::from_ref::<FrameSink>(&*output)
            .cast_mut()
            .cast::<c_void>();
        let low_latency = CFDictionary::from_slices(
            &[cf_key(unsafe {
                kVTVideoEncoderSpecification_EnableLowLatencyRateControl
            })],
            &[cf_bool(true)],
        );
        let mut status = 0;
        for specification in [Some(low_latency.as_opaque()), None] {
            match create_session(width, height, specification, refcon) {
                Ok(session) => {
                    let encoder = Self {
                        session,
                        _output: output,
                    };
                    encoder.configure(bitrate_bps, fps);
                    return Ok(encoder);
                }
                Err(error) => status = error,
            }
        }
        Err(MediaError::Failed(format!(
            "VideoToolbox couldn't start an H.264 session for {width}x{height} (error {status})."
        )))
    }

    fn configure(&self, bitrate_bps: u32, fps: u32) {
        unsafe {
            self.set(kVTCompressionPropertyKey_RealTime, cf_bool(true));
            self.set(
                kVTCompressionPropertyKey_AllowFrameReordering,
                cf_bool(false),
            );
            if self.set(
                kVTCompressionPropertyKey_ProfileLevel,
                kVTProfileLevel_H264_High_AutoLevel,
            ) != 0
            {
                self.set(
                    kVTCompressionPropertyKey_ProfileLevel,
                    kVTProfileLevel_H264_Main_AutoLevel,
                );
            }
            self.set(
                kVTCompressionPropertyKey_MaxKeyFrameInterval,
                &CFNumber::new_i32(1_000_000),
            );
            self.set(
                kVTCompressionPropertyKey_ExpectedFrameRate,
                &CFNumber::new_i32(fps.max(1) as i32),
            );
            self.session.prepare_to_encode_frames();
        }
        self.set_bitrate(bitrate_bps);
    }

    fn set(&self, key: &CFString, value: &CFType) -> i32 {
        unsafe { VTSessionSetProperty(&self.session, key, Some(value)) }
    }

    fn set_bitrate(&self, bps: u32) {
        let bps = CFNumber::new_i64(i64::from(bps));
        self.set(unsafe { kVTCompressionPropertyKey_AverageBitRate }, &bps);
    }

    fn encode(&self, pixels: &CVPixelBuffer, pts_us: u64, keyframe: bool) -> Result<()> {
        let force = keyframe.then(|| {
            CFDictionary::from_slices(
                &[cf_key(unsafe { kVTEncodeFrameOptionKey_ForceKeyFrame })],
                &[cf_bool(true)],
            )
        });
        let properties = force.as_deref().map(CFDictionary::as_opaque);
        let status = unsafe {
            self.session.encode_frame(
                pixels,
                micros_time(pts_us),
                invalid_time(),
                properties,
                null_mut(),
                null_mut(),
            )
        };
        match status {
            0 => Ok(()),
            status => Err(MediaError::Failed(format!(
                "VideoToolbox couldn't encode a frame (error {status}). Stop sharing and start again."
            ))),
        }
    }
}

impl Drop for VtEncoder {
    fn drop(&mut self) {
        unsafe {
            self.session.complete_frames(invalid_time());
            self.session.invalidate();
        }
    }
}

/// `refcon` must point at a `FrameSink` that outlives the session.
fn create_session(
    width: u32,
    height: u32,
    specification: Option<&CFDictionary>,
    refcon: *mut c_void,
) -> std::result::Result<CFRetained<VTCompressionSession>, i32> {
    let mut session: *mut VTCompressionSession = null_mut();
    let status = unsafe {
        VTCompressionSession::create(
            None,
            width as i32,
            height as i32,
            kCMVideoCodecType_H264,
            specification,
            None,
            None,
            Some(encoded),
            refcon,
            NonNull::from(&mut session),
        )
    };
    match NonNull::new(session) {
        Some(session) if status == 0 => Ok(unsafe { CFRetained::from_raw(session) }),
        _ => Err(status),
    }
}

/// VideoToolbox's output callback; `refcon` is the session's `FrameSink`.
unsafe extern "C-unwind" fn encoded(
    refcon: *mut c_void,
    _frame: *mut c_void,
    status: i32,
    _flags: VTEncodeInfoFlags,
    sample: *mut CMSampleBuffer,
) {
    let output = unsafe { &*refcon.cast::<FrameSink>() };
    if status != 0 {
        output(Err(MediaError::Failed(format!(
            "VideoToolbox failed to encode a frame (error {status}). Stop sharing and start again."
        ))));
        return;
    }
    if let Some(sample) = unsafe { sample.as_ref() } {
        output(access_unit(sample).ok_or_else(|| {
            MediaError::Failed("VideoToolbox returned an H.264 frame that couldn't be read. Stop sharing and start again.".into())
        }));
    }
}

fn access_unit(sample: &CMSampleBuffer) -> Option<EncodedFrame> {
    let block = unsafe { sample.data_buffer() }?;
    let length = unsafe { block.data_length() };
    let mut avcc = vec![0u8; length];
    let destination = NonNull::new(avcc.as_mut_ptr().cast::<c_void>())?;
    if length == 0 || unsafe { block.copy_data_bytes(0, length, destination) } != 0 {
        return None;
    }
    let format = unsafe { sample.format_description() }?;
    let (count, length_size) = parameter_set_count(&format)?;
    let units = nal_units(&avcc, length_size)?;
    let keyframe = has_idr(&units);
    let sets = if keyframe {
        parameter_sets(&format, count)?
    } else {
        Vec::new()
    };
    let sets: Vec<&[u8]> = sets.iter().map(Vec::as_slice).collect();
    Some(EncodedFrame {
        data: annex_b(&sets, &units),
        keyframe,
        pts_us: time_micros(unsafe { sample.presentation_time_stamp() }),
    })
}

fn parameter_set_count(format: &CMFormatDescription) -> Option<(usize, usize)> {
    let mut count = 0usize;
    let mut length_size: c_int = 0;
    let status = unsafe {
        CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format,
            0,
            null_mut(),
            null_mut(),
            &mut count,
            &mut length_size,
        )
    };
    (status == 0).then_some((count, usize::try_from(length_size).ok()?))
}

fn parameter_sets(format: &CMFormatDescription, count: usize) -> Option<Vec<Vec<u8>>> {
    (0..count)
        .map(|index| {
            let mut pointer: *const u8 = null();
            let mut size = 0usize;
            let status = unsafe {
                CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                    format,
                    index,
                    &mut pointer,
                    &mut size,
                    null_mut(),
                    null_mut(),
                )
            };
            (status == 0 && !pointer.is_null())
                .then(|| unsafe { std::slice::from_raw_parts(pointer, size) }.to_vec())
        })
        .collect()
}

/// Splits length-prefixed (AVCC) NAL units; `None` when a length is zero or
/// runs past the buffer, or the prefix isn't 1 to 4 bytes.
pub fn nal_units(avcc: &[u8], length_size: usize) -> Option<Vec<&[u8]>> {
    if !(1..=4).contains(&length_size) {
        return None;
    }
    let mut units = Vec::new();
    let mut rest = avcc;
    while !rest.is_empty() {
        let (prefix, after) = rest.split_at_checked(length_size)?;
        let length = prefix
            .iter()
            .fold(0usize, |length, &byte| length << 8 | usize::from(byte));
        if length == 0 {
            return None;
        }
        let (unit, after) = after.split_at_checked(length)?;
        units.push(unit);
        rest = after;
    }
    Some(units)
}

pub fn has_idr(units: &[&[u8]]) -> bool {
    units
        .iter()
        .any(|unit| unit.first().is_some_and(|header| header & 0x1f == 5))
}

/// Start codes before `parameter_sets`, then before each unit.
pub fn annex_b(parameter_sets: &[&[u8]], units: &[&[u8]]) -> Vec<u8> {
    let length = parameter_sets
        .iter()
        .chain(units)
        .map(|unit| unit.len() + 4)
        .sum();
    let mut out = Vec::with_capacity(length);
    for unit in parameter_sets.iter().chain(units) {
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(unit);
    }
    out
}

/// Runs `f` on the locked rows of a BGRA buffer (`stride` bytes per row).
fn with_bgra<R>(pixels: &CVPixelBuffer, f: impl FnOnce(&[u8], usize) -> R) -> Result<R> {
    let format = CVPixelBufferGetPixelFormatType(pixels);
    if format != BGRA {
        return Err(MediaError::Failed(format!(
            "The software encoder got pixel format {format:#x} instead of BGRA. Stop sharing and start again."
        )));
    }
    if unsafe { CVPixelBufferLockBaseAddress(pixels, CVPixelBufferLockFlags::ReadOnly) } != 0 {
        return Err(MediaError::Failed(
            "A captured frame couldn't be read for encoding. Stop sharing and start again.".into(),
        ));
    }
    let base = CVPixelBufferGetBaseAddress(pixels).cast::<u8>();
    let stride = CVPixelBufferGetBytesPerRow(pixels);
    let length = stride * CVPixelBufferGetHeight(pixels);
    let result =
        (!base.is_null()).then(|| f(unsafe { std::slice::from_raw_parts(base, length) }, stride));
    unsafe { CVPixelBufferUnlockBaseAddress(pixels, CVPixelBufferLockFlags::ReadOnly) };
    result.ok_or_else(|| {
        MediaError::Failed(
            "A captured frame had no pixels to encode. Stop sharing and start again.".into(),
        )
    })
}

fn cf_bool(value: bool) -> &'static CFType {
    CFBoolean::new(value)
}

fn cf_key(key: &'static CFString) -> &'static CFType {
    key
}

fn micros_time(pts_us: u64) -> CMTime {
    CMTime {
        value: pts_us as i64,
        timescale: 1_000_000,
        flags: CMTimeFlags::Valid,
        epoch: 0,
    }
}

fn invalid_time() -> CMTime {
    CMTime {
        value: 0,
        timescale: 0,
        flags: CMTimeFlags(0),
        epoch: 0,
    }
}

fn time_micros(time: CMTime) -> u64 {
    if !time.flags.contains(CMTimeFlags::Valid) || time.timescale <= 0 {
        return 0;
    }
    (i128::from(time.value) * 1_000_000 / i128::from(time.timescale)).max(0) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_avcc_into_nal_units() {
        let avcc = [0, 0, 0, 2, 0x65, 0xaa, 0, 0, 0, 1, 0x06];
        assert_eq!(
            nal_units(&avcc, 4),
            Some(vec![&[0x65, 0xaa][..], &[0x06][..]])
        );
        assert_eq!(
            nal_units(&[2, 0x41, 0x9a], 1),
            Some(vec![&[0x41, 0x9a][..]])
        );
    }

    #[test]
    fn rejects_broken_avcc() {
        assert_eq!(nal_units(&[0, 0, 0, 5, 0x65], 4), None);
        assert_eq!(nal_units(&[0, 0, 0, 0], 4), None);
        assert_eq!(nal_units(&[0, 0], 4), None);
        assert_eq!(nal_units(&[1, 0x65], 3), None);
        assert_eq!(nal_units(&[1, 0x65], 5), None);
    }

    #[test]
    fn writes_annex_b_with_parameter_sets_first() {
        let sps = [0x67, 0x64, 0x00, 0x1f];
        let pps = [0x68, 0xee];
        let idr = [0x65, 0x88];
        assert_eq!(
            annex_b(&[&sps, &pps], &[&idr]),
            [0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f, 0, 0, 0, 1, 0x68, 0xee, 0, 0, 0, 1, 0x65, 0x88]
        );
        assert_eq!(annex_b(&[], &[&[0x41, 0x9a]]), [0, 0, 0, 1, 0x41, 0x9a]);
    }

    #[test]
    fn finds_idr_slices() {
        assert!(has_idr(&[&[0x06, 0x05], &[0x65, 0x88]]));
        assert!(has_idr(&[&[0x25, 0x88]]));
        assert!(!has_idr(&[&[0x41, 0x9a], &[0x06, 0x05]]));
        assert!(!has_idr(&[]));
    }

    #[test]
    fn converts_times_to_microseconds() {
        assert_eq!(time_micros(micros_time(1_234_567)), 1_234_567);
        assert_eq!(
            time_micros(CMTime {
                value: 90_000,
                timescale: 600,
                flags: CMTimeFlags::Valid,
                epoch: 0
            }),
            150_000_000
        );
        assert_eq!(time_micros(invalid_time()), 0);
    }
}
