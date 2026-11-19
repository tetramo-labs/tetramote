//! One ScreenCaptureKit stream per share: frames into the H.264 encoder, system
//! audio into Opus. After the first error a stream's video (or audio) stays
//! silent; the caller drops it and starts another.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use objc2_core_graphics::CGMainDisplayID;
use objc2_core_video::CVPixelBuffer;
use screencapturekit::cm::{CMClock, CMSampleBuffer, CMSampleBufferSCExt, CMTime, SCFrameStatus};
use screencapturekit::prelude::{
    ErrorHandler, PixelFormat, SCContentFilter, SCShareableContent, SCStream,
    SCStreamConfiguration, SCStreamOutputType,
};

use super::audio::{stereo, AudioEncoder};
use super::display::{display, stream_size};
use super::permissions;
use super::video::{FrameSink, VideoEncoder, NV12};
use crate::{
    EncodedFrame, MediaError, Result, ScreenStream, StreamConfig, StreamInfo, StreamSink,
    OPUS_CHANNELS, OPUS_SAMPLE_RATE,
};

struct Shared {
    sink: Arc<dyn StreamSink>,
    keyframe: AtomicBool,
    bitrate: AtomicU32,
    stopped: AtomicBool,
    video_failed: AtomicBool,
    audio_failed: AtomicBool,
}

impl Shared {
    fn deliver(&self, frame: Result<EncodedFrame>) {
        match frame {
            Ok(frame) if !self.stopped.load(Ordering::Acquire) => self.sink.on_video(frame),
            Ok(_) => {}
            Err(error) => self.fail(&self.video_failed, error),
        }
    }

    fn fail(&self, flag: &AtomicBool, error: MediaError) {
        if !flag.swap(true, Ordering::AcqRel) && !self.stopped.load(Ordering::Acquire) {
            self.sink.on_error(error);
        }
    }
}

struct Video {
    shared: Arc<Shared>,
    encoder: Mutex<(VideoEncoder, u32)>,
}

impl Video {
    fn frame(&self, sample: &CMSampleBuffer) {
        let shared = &self.shared;
        if shared.video_failed.load(Ordering::Acquire)
            || shared.stopped.load(Ordering::Acquire)
            || sample.frame_status() != Some(SCFrameStatus::Complete)
        {
            return;
        }
        let Some(pixels) = pixel_buffer(sample) else {
            return;
        };
        if !shared.sink.should_encode() {
            return;
        }
        let keyframe = shared.keyframe.swap(false, Ordering::AcqRel);
        let mut guard = lock(&self.encoder);
        let (encoder, applied) = &mut *guard;
        let bitrate = shared.bitrate.load(Ordering::Acquire);
        if bitrate != *applied {
            encoder.set_bitrate(bitrate);
            *applied = bitrate;
        }
        if let Err(error) = encoder.encode(
            pixels,
            sample_micros(sample.presentation_timestamp()),
            keyframe,
        ) {
            shared.fail(&shared.video_failed, error);
        }
    }
}

struct Audio {
    shared: Arc<Shared>,
    encoder: Mutex<AudioEncoder>,
}

impl Audio {
    fn buffer(&self, sample: &CMSampleBuffer) {
        let shared = &self.shared;
        if shared.audio_failed.load(Ordering::Acquire) || shared.stopped.load(Ordering::Acquire) {
            return;
        }
        let Some(format) = sample.format_description() else {
            return;
        };
        let rate = format.audio_sample_rate().unwrap_or(0.0);
        let bits = format.audio_bits_per_channel().unwrap_or(0);
        if !format.audio_is_float() || bits != 32 || rate != f64::from(OPUS_SAMPLE_RATE) {
            let error = MediaError::Unsupported(format!(
                "System audio arrived as {rate} Hz {bits}-bit samples, which Tetratop can't encode. Share without audio."
            ));
            return shared.fail(&shared.audio_failed, error);
        }
        let list = match sample.audio_buffer_list() {
            Ok(list) => list,
            Err(status) => {
                let error = MediaError::Failed(format!(
                    "System audio couldn't be read (CoreMedia error {status}). Stop sharing and start again."
                ));
                return shared.fail(&shared.audio_failed, error);
            }
        };
        let buffers: Vec<(&[u8], usize)> = list
            .iter()
            .map(|buffer| (buffer.data(), buffer.number_channels as usize))
            .collect();
        let pcm = stereo(&buffers);
        match lock(&self.encoder).push(&pcm, sample_micros(sample.presentation_timestamp())) {
            Ok(packets) => packets
                .into_iter()
                .for_each(|packet| shared.sink.on_audio(packet)),
            Err(error) => shared.fail(&shared.audio_failed, error),
        }
    }
}

struct MacStream {
    info: StreamInfo,
    stream: SCStream,
    shared: Arc<Shared>,
}

impl ScreenStream for MacStream {
    fn info(&self) -> &StreamInfo {
        &self.info
    }

    fn request_keyframe(&self) {
        self.shared.keyframe.store(true, Ordering::Release);
    }

    fn set_bitrate(&self, bps: u32) {
        self.shared.bitrate.store(bps, Ordering::Release);
    }
}

impl Drop for MacStream {
    fn drop(&mut self) {
        self.shared.stopped.store(true, Ordering::Release);
        if let Err(error) = self.stream.stop_capture() {
            log::warn!("Screen capture didn't stop cleanly: {error}");
        }
    }
}

pub fn start(config: StreamConfig, sink: Arc<dyn StreamSink>) -> Result<Box<dyn ScreenStream>> {
    if !permissions::screen_recording() {
        return Err(MediaError::PermissionDenied(
            permissions::SCREEN_RECORDING_OFF.into(),
        ));
    }
    let content = SCShareableContent::get().map_err(|error| {
        MediaError::Failed(format!(
            "macOS didn't list the displays to capture ({error}). Check that Screen Recording is on for Tetratop in System Settings > Privacy & Security, then share again."
        ))
    })?;
    let displays = content.displays();
    let wanted = config
        .display_id
        .and_then(|id| u32::try_from(id).ok())
        .unwrap_or_else(|| CGMainDisplayID());
    let target = displays
        .iter()
        .find(|candidate| candidate.display_id() == wanted)
        .or_else(|| displays.first())
        .ok_or_else(|| {
            MediaError::Failed(
                "There's no display to share. Connect a display and share again.".into(),
            )
        })?;
    let info = display(target.display_id());
    let (width, height) = stream_size(info.width, info.height, config.max_long_edge);
    let fps = config.fps.max(1);

    let shared = Arc::new(Shared {
        sink,
        keyframe: AtomicBool::new(true),
        bitrate: AtomicU32::new(config.bitrate_bps),
        stopped: AtomicBool::new(false),
        video_failed: AtomicBool::new(false),
        audio_failed: AtomicBool::new(false),
    });
    let output: FrameSink = {
        let shared = shared.clone();
        Arc::new(move |frame| shared.deliver(frame))
    };
    let encoder = VideoEncoder::new(width, height, config.bitrate_bps, fps, output)?;
    let encoder_name = encoder.name();
    let pixel_format = if encoder.pixel_format() == NV12 {
        PixelFormat::YCbCr_420v
    } else {
        PixelFormat::BGRA
    };
    let video = Arc::new(Video {
        shared: shared.clone(),
        encoder: Mutex::new((encoder, config.bitrate_bps)),
    });
    let audio = if config.audio {
        Some(Arc::new(Audio {
            shared: shared.clone(),
            encoder: Mutex::new(AudioEncoder::new()?),
        }))
    } else {
        None
    };

    let filter = SCContentFilter::create()
        .with_display(target)
        .with_excluding_windows(&[])
        .build()
        .map_err(|error| {
            MediaError::Failed(format!(
                "Screen capture couldn't target that display ({error}). Share again."
            ))
        })?;
    let capture = SCStreamConfiguration::new()
        .with_width(width)
        .with_height(height)
        .with_minimum_frame_interval(&CMTime::new(1, fps as i32))
        .with_pixel_format(pixel_format)
        .with_shows_cursor(true)
        .with_queue_depth(5)
        .with_captures_audio(config.audio)
        .with_sample_rate(OPUS_SAMPLE_RATE as i32)
        .with_channel_count(OPUS_CHANNELS as i32)
        .with_excludes_current_process_audio(true);
    let stopped_by_macos = {
        let shared = shared.clone();
        ErrorHandler::new(move |error| {
            let error =
                MediaError::Failed(format!("Screen capture stopped ({error}). Share again."));
            shared.fail(&shared.video_failed, error);
        })
    };
    let failed_to_start = |error: screencapturekit::prelude::SCError| {
        MediaError::Failed(format!(
            "Screen capture didn't start ({error}). Share again."
        ))
    };
    let mut stream = SCStream::new_with_delegate(&filter, &capture, stopped_by_macos)
        .map_err(failed_to_start)?;
    stream
        .add_output_handler(
            move |sample: CMSampleBuffer, _| video.frame(&sample),
            SCStreamOutputType::Screen,
        )
        .map_err(failed_to_start)?;
    if let Some(audio) = audio {
        stream
            .add_output_handler(
                move |sample: CMSampleBuffer, _| audio.buffer(&sample),
                SCStreamOutputType::Audio,
            )
            .map_err(failed_to_start)?;
    }
    stream.start_capture().map_err(failed_to_start)?;

    Ok(Box::new(MacStream {
        info: StreamInfo {
            display: info,
            width,
            height,
            encoder: encoder_name,
        },
        stream,
        shared,
    }))
}

/// The frame's pixels, borrowed for as long as the sample buffer lives.
fn pixel_buffer(sample: &CMSampleBuffer) -> Option<&CVPixelBuffer> {
    unsafe {
        sample
            .image_buffer_ptr_borrowed()
            .cast::<CVPixelBuffer>()
            .as_ref()
    }
}

fn sample_micros(time: CMTime) -> u64 {
    let time = match time.as_seconds() {
        Some(_) => time,
        None => CMClock::host_time_clock().time(),
    };
    if time.timescale <= 0 {
        return 0;
    }
    (i128::from(time.value) * 1_000_000 / i128::from(time.timescale)).max(0) as u64
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
