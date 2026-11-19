//! The Media Foundation hardware H.264 encoder. Hardware MFTs are
//! asynchronous: a frame goes in only after a METransformNeedInput event and
//! output comes out after METransformHaveOutput, so the capture loop calls
//! `poll` between frames. Input is NV12 in system memory.

use std::mem::ManuallyDrop;
use std::ops::Range;
use std::ptr::null_mut;
use std::sync::OnceLock;

use windows::core::{Interface, GUID};
use windows::Win32::Foundation::E_FAIL;
use windows::Win32::Media::MediaFoundation::{
    eAVEncCommonRateControlMode_CBR, eAVEncH264VProfile_High, eAVEncH264VProfile_Main,
    eAVScenarioInfo_DisplayRemoting, CODECAPI_AVEncCommonMeanBitRate,
    CODECAPI_AVEncCommonRateControlMode, CODECAPI_AVEncMPVDefaultBPictureCount,
    CODECAPI_AVEncMPVGOPSize, CODECAPI_AVEncVideoForceKeyFrame, CODECAPI_AVLowLatencyMode,
    CODECAPI_AVScenarioInfo, ICodecAPI, IMFActivate, IMFMediaEventGenerator, IMFMediaType,
    IMFSample, IMFShutdown, IMFTransform, MEError, METransformHaveOutput, METransformNeedInput,
    MFCreateMediaType, MFCreateMemoryBuffer, MFCreateSample, MFMediaType_Video, MFStartup,
    MFTEnumEx, MFVideoFormat_H264, MFVideoFormat_NV12, MFVideoInterlace_Progressive,
    MFSTARTUP_LITE, MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE,
    MFT_ENUM_FLAG_SORTANDFILTER, MFT_MESSAGE_COMMAND_FLUSH, MFT_MESSAGE_NOTIFY_BEGIN_STREAMING,
    MFT_MESSAGE_NOTIFY_END_OF_STREAM, MFT_MESSAGE_NOTIFY_END_STREAMING,
    MFT_MESSAGE_NOTIFY_START_OF_STREAM, MFT_OUTPUT_DATA_BUFFER,
    MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES, MFT_OUTPUT_STREAM_PROVIDES_SAMPLES,
    MFT_REGISTER_TYPE_INFO, MF_EVENT_FLAG_NO_WAIT, MF_E_NO_EVENTS_AVAILABLE,
    MF_E_TRANSFORM_NEED_MORE_INPUT, MF_E_TRANSFORM_STREAM_CHANGE, MF_LOW_LATENCY,
    MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE,
    MF_MT_MPEG2_PROFILE, MF_MT_MPEG_SEQUENCE_HEADER, MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE,
    MF_TRANSFORM_ASYNC, MF_TRANSFORM_ASYNC_UNLOCK, MF_VERSION,
};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Variant::VARIANT;

use crate::{EncodedFrame, MediaError, Result};

const MIN_OUTPUT_BUFFER: u32 = 1 << 20;
const GOP_FRAMES: u32 = 65_535;

pub struct HardwareEncoder {
    activate: IMFActivate,
    transform: IMFTransform,
    events: IMFMediaEventGenerator,
    codec: ICodecAPI,
    input_id: u32,
    output_id: u32,
    credits: u32,
    in_flight: u32,
    provides_samples: bool,
    output_size: u32,
    frame_duration: i64,
    parameter_sets: Vec<u8>,
}

impl HardwareEncoder {
    pub fn new(width: u32, height: u32, fps: u32, bitrate: u32) -> Result<Self> {
        started()?;
        let activates = enumerate()
            .map_err(|e| unsupported(format!("listing hardware H.264 encoders failed: {e}")))?;
        if activates.is_empty() {
            return Err(unsupported(
                "this computer has no hardware H.264 encoder".into(),
            ));
        }
        let mut errors = Vec::new();
        for activate in activates {
            match Self::open(&activate, width, height, fps, bitrate) {
                Ok(encoder) => return Ok(encoder),
                Err(e) => {
                    errors.push(e.to_string());
                    unsafe {
                        let _ = activate.ShutdownObject();
                    }
                }
            }
        }
        Err(unsupported(format!(
            "no hardware H.264 encoder took {width}x{height}: {}",
            errors.join("; ")
        )))
    }

    fn open(
        activate: &IMFActivate,
        width: u32,
        height: u32,
        fps: u32,
        bitrate: u32,
    ) -> windows::core::Result<Self> {
        let transform: IMFTransform = unsafe { activate.ActivateObject() }?;
        let attributes = unsafe { transform.GetAttributes() }?;
        if unsafe { attributes.GetUINT32(&MF_TRANSFORM_ASYNC) }.unwrap_or(0) == 0 {
            return Err(windows::core::Error::new(
                E_FAIL,
                "the encoder isn't asynchronous",
            ));
        }
        unsafe { attributes.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1) }?;
        unsafe {
            let _ = attributes.SetUINT32(&MF_LOW_LATENCY, 1);
        }
        let codec: ICodecAPI = transform.cast()?;
        let (mut input_id, mut output_id) = (0u32, 0u32);
        unsafe {
            let _ = transform.GetStreamIDs(
                std::slice::from_mut(&mut input_id),
                std::slice::from_mut(&mut output_id),
            );
        }
        for (key, value) in [
            (&CODECAPI_AVLowLatencyMode, VARIANT::from(true)),
            (
                &CODECAPI_AVEncCommonRateControlMode,
                VARIANT::from(eAVEncCommonRateControlMode_CBR.0 as u32),
            ),
            (&CODECAPI_AVEncCommonMeanBitRate, VARIANT::from(bitrate)),
            (&CODECAPI_AVEncMPVDefaultBPictureCount, VARIANT::from(0u32)),
            (&CODECAPI_AVEncMPVGOPSize, VARIANT::from(GOP_FRAMES)),
            (
                &CODECAPI_AVScenarioInfo,
                VARIANT::from(eAVScenarioInfo_DisplayRemoting.0 as u32),
            ),
        ] {
            if let Err(e) = unsafe { codec.SetValue(key, &value) } {
                log::debug!("the hardware encoder ignored {key:?}: {e}");
            }
        }
        set_output_type(&transform, output_id, width, height, fps, bitrate)?;
        set_input_type(&transform, input_id, width, height, fps)?;
        let info = unsafe { transform.GetOutputStreamInfo(output_id) }?;
        let provides =
            (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES.0) as u32;
        let parameter_sets = sequence_header(&transform, output_id);
        unsafe {
            transform.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        }
        let events: IMFMediaEventGenerator = transform.cast()?;
        Ok(Self {
            activate: activate.clone(),
            transform,
            events,
            codec,
            input_id,
            output_id,
            credits: 0,
            in_flight: 0,
            provides_samples: info.dwFlags & provides != 0,
            output_size: info.cbSize.max(MIN_OUTPUT_BUFFER),
            frame_duration: 10_000_000 / fps.max(1) as i64,
            parameter_sets,
        })
    }

    pub fn accepts_input(&self) -> bool {
        self.credits > 0
    }

    pub fn in_flight(&self) -> bool {
        self.in_flight > 0
    }

    pub fn set_bitrate(&mut self, bps: u32) {
        if let Err(e) = unsafe {
            self.codec
                .SetValue(&CODECAPI_AVEncCommonMeanBitRate, &VARIANT::from(bps))
        } {
            log::debug!("the hardware encoder kept its bitrate: {e}");
        }
    }

    pub fn submit(
        &mut self,
        nv12: &[u8],
        pts_us: u64,
        keyframe: bool,
    ) -> windows::core::Result<()> {
        if keyframe {
            unsafe {
                self.codec
                    .SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &VARIANT::from(1u32))
            }?;
        }
        let buffer = unsafe { MFCreateMemoryBuffer(nv12.len() as u32) }?;
        unsafe {
            let mut data = null_mut();
            buffer.Lock(&mut data, None, None)?;
            std::ptr::copy_nonoverlapping(nv12.as_ptr(), data, nv12.len());
            buffer.Unlock()?;
            buffer.SetCurrentLength(nv12.len() as u32)?;
        }
        let sample = unsafe { MFCreateSample() }?;
        unsafe {
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(pts_us as i64 * 10)?;
            sample.SetSampleDuration(self.frame_duration)?;
            self.transform.ProcessInput(self.input_id, &sample, 0)?;
        }
        self.credits -= 1;
        self.in_flight += 1;
        Ok(())
    }

    /// Takes the encoder's pending events: input requests and finished frames.
    pub fn poll(&mut self) -> windows::core::Result<Vec<EncodedFrame>> {
        let mut frames = Vec::new();
        loop {
            let event = match unsafe { self.events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } {
                Ok(event) => event,
                Err(e) if e.code() == MF_E_NO_EVENTS_AVAILABLE => break,
                Err(e) => return Err(e),
            };
            let kind = unsafe { event.GetType() }? as i32;
            if kind == METransformNeedInput.0 {
                self.credits += 1;
            } else if kind == METransformHaveOutput.0 {
                frames.extend(self.output()?);
            } else if kind == MEError.0 {
                let status = unsafe { event.GetStatus() }?;
                return Err(windows::core::Error::new(
                    status,
                    "the hardware encoder reported an error",
                ));
            }
        }
        Ok(frames)
    }

    fn output(&mut self) -> windows::core::Result<Option<EncodedFrame>> {
        let sample = if self.provides_samples {
            None
        } else {
            let sample = unsafe { MFCreateSample() }?;
            unsafe { sample.AddBuffer(&MFCreateMemoryBuffer(self.output_size)?) }?;
            Some(sample)
        };
        let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: self.output_id,
            pSample: ManuallyDrop::new(sample),
            dwStatus: 0,
            pEvents: ManuallyDrop::new(None),
        }];
        let mut status = 0u32;
        let result = unsafe { self.transform.ProcessOutput(0, &mut buffers, &mut status) };
        let [buffer] = buffers;
        let sample = ManuallyDrop::into_inner(buffer.pSample);
        drop(ManuallyDrop::into_inner(buffer.pEvents));
        match result {
            Ok(()) => {}
            Err(e) if e.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                self.renegotiate()?;
                return Ok(None);
            }
            Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(None),
            Err(e) => return Err(e),
        }
        self.in_flight = self.in_flight.saturating_sub(1);
        let Some(sample) = sample else {
            return Ok(None);
        };
        let data = read_sample(&sample)?;
        let pts_us = unsafe { sample.GetSampleTime() }.map_or(0, |t| (t / 10).max(0) as u64);
        Ok(self.access_unit(data, pts_us))
    }

    fn renegotiate(&mut self) -> windows::core::Result<()> {
        let available = unsafe { self.transform.GetOutputAvailableType(self.output_id, 0) }?;
        unsafe { self.transform.SetOutputType(self.output_id, &available, 0) }?;
        let info = unsafe { self.transform.GetOutputStreamInfo(self.output_id) }?;
        let provides =
            (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES.0) as u32;
        self.provides_samples = info.dwFlags & provides != 0;
        self.output_size = info.cbSize.max(MIN_OUTPUT_BUFFER);
        let header = sequence_header(&self.transform, self.output_id);
        if !header.is_empty() {
            self.parameter_sets = header;
        }
        Ok(())
    }

    /// Encoders differ on where SPS and PPS go: in band, in the output type,
    /// or in a sample of their own. Keyframes leave here with them in band.
    fn access_unit(&mut self, data: Vec<u8>, pts_us: u64) -> Option<EncodedFrame> {
        let (frame, carried) = with_parameter_sets(data, &self.parameter_sets);
        if let Some(sets) = carried {
            self.parameter_sets = sets;
        }
        frame.map(|AccessUnit { data, keyframe }| EncodedFrame {
            data,
            keyframe,
            pts_us,
        })
    }
}

impl Drop for HardwareEncoder {
    fn drop(&mut self) {
        unsafe {
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, self.input_id as usize);
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
            if let Ok(shutdown) = self.transform.cast::<IMFShutdown>() {
                let _ = shutdown.Shutdown();
            }
            let _ = self.activate.ShutdownObject();
        }
    }
}

fn unsupported(reason: String) -> MediaError {
    MediaError::Unsupported(format!(
        "Hardware H.264 encoding is unavailable ({reason})."
    ))
}

fn started() -> Result<()> {
    static STARTED: OnceLock<std::result::Result<(), String>> = OnceLock::new();
    STARTED
        .get_or_init(|| unsafe { MFStartup(MF_VERSION, MFSTARTUP_LITE) }.map_err(|e| e.to_string()))
        .clone()
        .map_err(|e| unsupported(format!("Media Foundation didn't start: {e}")))
}

fn enumerate() -> windows::core::Result<Vec<IMFActivate>> {
    let input = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_H264,
    };
    let mut list: *mut Option<IMFActivate> = null_mut();
    let mut count = 0u32;
    unsafe {
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            Some(&input as *const _),
            Some(&output as *const _),
            &mut list,
            &mut count,
        )
    }?;
    if list.is_null() {
        return Ok(Vec::new());
    }
    let activates = unsafe { std::slice::from_raw_parts_mut(list, count as usize) }
        .iter_mut()
        .filter_map(Option::take)
        .collect();
    unsafe { CoTaskMemFree(Some(list as *const _)) };
    Ok(activates)
}

fn pack(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | low as u64
}

fn video_type(
    subtype: &GUID,
    width: u32,
    height: u32,
    fps: u32,
    media_type: &IMFMediaType,
) -> windows::core::Result<()> {
    unsafe {
        media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        media_type.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        media_type.SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height))?;
        media_type.SetUINT64(&MF_MT_FRAME_RATE, pack(fps.max(1), 1))?;
        media_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))?;
        media_type.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
    }
}

fn set_output_type(
    transform: &IMFTransform,
    output_id: u32,
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u32,
) -> windows::core::Result<()> {
    let mut result = Ok(());
    for profile in [eAVEncH264VProfile_High, eAVEncH264VProfile_Main] {
        let media_type = unsafe { MFCreateMediaType() }?;
        video_type(&MFVideoFormat_H264, width, height, fps, &media_type)?;
        unsafe {
            media_type.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
            media_type.SetUINT32(&MF_MT_MPEG2_PROFILE, profile.0 as u32)?;
        }
        result = unsafe { transform.SetOutputType(output_id, &media_type, 0) };
        if result.is_ok() {
            break;
        }
    }
    result
}

fn set_input_type(
    transform: &IMFTransform,
    input_id: u32,
    width: u32,
    height: u32,
    fps: u32,
) -> windows::core::Result<()> {
    let mut index = 0;
    while let Ok(media_type) = unsafe { transform.GetInputAvailableType(input_id, index) } {
        index += 1;
        if unsafe { media_type.GetGUID(&MF_MT_SUBTYPE) }.ok() != Some(MFVideoFormat_NV12) {
            continue;
        }
        video_type(&MFVideoFormat_NV12, width, height, fps, &media_type)?;
        return unsafe { transform.SetInputType(input_id, &media_type, 0) };
    }
    let media_type = unsafe { MFCreateMediaType() }?;
    video_type(&MFVideoFormat_NV12, width, height, fps, &media_type)?;
    unsafe { transform.SetInputType(input_id, &media_type, 0) }
}

fn sequence_header(transform: &IMFTransform, output_id: u32) -> Vec<u8> {
    let Ok(media_type) = (unsafe { transform.GetOutputCurrentType(output_id) }) else {
        return Vec::new();
    };
    let Ok(size) = (unsafe { media_type.GetBlobSize(&MF_MT_MPEG_SEQUENCE_HEADER) }) else {
        return Vec::new();
    };
    let mut blob = vec![0u8; size as usize];
    if unsafe { media_type.GetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut blob, None) }.is_err() {
        return Vec::new();
    }
    parameter_sets(&blob).unwrap_or_default()
}

fn read_sample(sample: &IMFSample) -> windows::core::Result<Vec<u8>> {
    let buffer = unsafe { sample.ConvertToContiguousBuffer() }?;
    let mut data = null_mut();
    let mut length = 0u32;
    unsafe { buffer.Lock(&mut data, None, Some(&mut length)) }?;
    let bytes = unsafe { std::slice::from_raw_parts(data, length as usize) }.to_vec();
    unsafe { buffer.Unlock() }?;
    Ok(bytes)
}

/// Each NAL unit in an Annex B stream, start code included, with its type.
fn nal_units(data: &[u8]) -> Vec<(Range<usize>, u8)> {
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 <= data.len() {
        if data[i..i + 3] == [0, 0, 1] {
            let start = if i > 0 && data[i - 1] == 0 { i - 1 } else { i };
            starts.push((start, i + 3));
            i += 3;
        } else {
            i += 1;
        }
    }
    let mut units = Vec::with_capacity(starts.len());
    for (n, &(start, payload)) in starts.iter().enumerate() {
        let end = starts.get(n + 1).map_or(data.len(), |&(next, _)| next);
        if payload < end {
            units.push((start..end, data[payload] & 0x1f));
        }
    }
    units
}

/// The SPS and PPS units of `data`, when it has both.
fn parameter_sets(data: &[u8]) -> Option<Vec<u8>> {
    let units = nal_units(data);
    let types: Vec<u8> = units.iter().map(|(_, t)| *t).collect();
    if !types.contains(&7) || !types.contains(&8) {
        return None;
    }
    Some(
        units
            .into_iter()
            .filter(|(_, t)| *t == 7 || *t == 8)
            .flat_map(|(range, _)| data[range].to_vec())
            .collect(),
    )
}

#[derive(Debug, PartialEq)]
struct AccessUnit {
    data: Vec<u8>,
    keyframe: bool,
}

/// The access unit with the parameter sets a keyframe needs put in front
/// (`None` for output that holds no picture), and any parameter sets the
/// output carried, for later keyframes.
fn with_parameter_sets(data: Vec<u8>, known: &[u8]) -> (Option<AccessUnit>, Option<Vec<u8>>) {
    let types: Vec<u8> = nal_units(&data).into_iter().map(|(_, t)| t).collect();
    let carried = parameter_sets(&data);
    if !types.iter().any(|t| (1..=5).contains(t)) {
        return (None, carried);
    }
    let keyframe = types.contains(&5);
    let data = if keyframe && carried.is_none() && !known.is_empty() {
        [known, &data].concat()
    } else {
        data
    };
    (Some(AccessUnit { data, keyframe }), carried)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPS: [u8; 7] = [0, 0, 0, 1, 0x67, 0x42, 0x00];
    const PPS: [u8; 6] = [0, 0, 0, 1, 0x68, 0xce];
    const IDR: [u8; 6] = [0, 0, 1, 0x65, 0x88, 0x84];
    const P: [u8; 6] = [0, 0, 0, 1, 0x41, 0x9a];

    #[test]
    fn finds_nal_units_after_three_and_four_byte_start_codes() {
        let stream = [&SPS[..], &PPS, &IDR].concat();
        let units = nal_units(&stream);
        assert_eq!(units.iter().map(|(_, t)| *t).collect::<Vec<_>>(), [7, 8, 5]);
        assert_eq!(units[0].0, 0..7);
        assert_eq!(units[2].0, 13..19);
    }

    #[test]
    fn puts_known_parameter_sets_before_bare_keyframes() {
        let known = [&SPS[..], &PPS].concat();
        let (frame, carried) = with_parameter_sets(IDR.to_vec(), &known);
        assert_eq!(
            frame,
            Some(AccessUnit {
                data: [&SPS[..], &PPS, &IDR].concat(),
                keyframe: true
            })
        );
        assert_eq!(carried, None);
        let (frame, _) = with_parameter_sets(P.to_vec(), &known);
        assert_eq!(
            frame,
            Some(AccessUnit {
                data: P.to_vec(),
                keyframe: false
            })
        );
    }

    #[test]
    fn keeps_in_band_parameter_sets() {
        let stream = [&SPS[..], &PPS, &IDR].concat();
        let (frame, carried) = with_parameter_sets(stream.clone(), &[]);
        assert_eq!(
            frame,
            Some(AccessUnit {
                data: stream,
                keyframe: true
            })
        );
        assert_eq!(carried, Some([&SPS[..], &PPS].concat()));
    }

    #[test]
    fn output_without_a_picture_only_updates_parameter_sets() {
        let (frame, carried) = with_parameter_sets([&SPS[..], &PPS].concat(), &[]);
        assert_eq!(frame, None);
        assert_eq!(carried, Some([&SPS[..], &PPS].concat()));
    }

    /// Machines without an H.264 encoder in hardware (CI runners) stop at
    /// `new`; elsewhere the first frame out must be a keyframe with SPS.
    #[test]
    fn encodes_a_keyframe_where_there_is_hardware() {
        let _com = super::super::Com::init();
        let mut encoder = match HardwareEncoder::new(320, 240, 30, 2_000_000) {
            Ok(encoder) => encoder,
            Err(e) => {
                eprintln!("{e}");
                return;
            }
        };
        let frame = vec![128u8; 320 * 240 * 3 / 2];
        let mut frames = Vec::new();
        for pts in 0..60u64 {
            frames.extend(encoder.poll().unwrap());
            if encoder.accepts_input() {
                encoder.submit(&frame, pts * 33_333, pts == 0).unwrap();
            }
            if !frames.is_empty() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let first = frames.first().expect("a frame within 60 tries");
        assert!(first.keyframe);
        let types: Vec<u8> = nal_units(&first.data).into_iter().map(|(_, t)| t).collect();
        assert!(types.contains(&7) && types.contains(&5), "{types:?}");
    }

    #[test]
    fn packs_ratios_high_word_first() {
        assert_eq!(pack(1920, 1080), 0x0000_0780_0000_0438);
    }
}
