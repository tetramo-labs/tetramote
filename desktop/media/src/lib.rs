//! The desktop app's platform layer: list displays, capture one as H.264 with
//! its system audio as Opus, and turn protocol input records into OS input.
//! Each OS implements the same functions in its own module; `openh264` is the
//! software encoder any of them falls back to.

use std::sync::Arc;

pub use tetra_core::input::InputRecord;

mod opus;
pub mod playback;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
pub mod software;
pub mod test_pattern;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(target_os = "windows")]
use windows as platform;

pub use opus::{OpusDecoder, OpusEncoder, OPUS_CHANNELS, OPUS_FRAME_SAMPLES, OPUS_SAMPLE_RATE};

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("{0}")]
    PermissionDenied(String),
    #[error("{0}")]
    Unsupported(String),
    #[error("{0}")]
    Failed(String),
}

pub type Result<T> = std::result::Result<T, MediaError>;

#[derive(Debug, Clone, PartialEq)]
pub struct DisplayInfo {
    pub id: u64,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub point_width: u32,
    pub point_height: u32,
    pub main: bool,
}

#[derive(Debug, Clone)]
pub struct StreamConfig {
    pub display_id: Option<u64>,
    pub max_long_edge: u32,
    pub fps: u32,
    pub bitrate_bps: u32,
    pub audio: bool,
}

impl Default for StreamConfig {
    fn default() -> Self {
        Self {
            display_id: None,
            max_long_edge: 2560,
            fps: 60,
            bitrate_bps: 8_000_000,
            audio: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct StreamInfo {
    pub display: DisplayInfo,
    pub width: u32,
    pub height: u32,
    pub encoder: &'static str,
}

/// One H.264 access unit in Annex B form; keyframes carry SPS and PPS in band.
#[derive(Debug, Clone)]
pub struct EncodedFrame {
    pub data: Vec<u8>,
    pub keyframe: bool,
    pub pts_us: u64,
}

/// One 20 ms Opus packet, 48 kHz stereo.
#[derive(Debug, Clone)]
pub struct AudioPacket {
    pub data: Vec<u8>,
    pub pts_us: u64,
}

/// Where a stream delivers its output. Called from capture threads.
pub trait StreamSink: Send + Sync {
    /// False drops the captured frame before it is encoded, which keeps the
    /// reference chain intact while the network catches up.
    fn should_encode(&self) -> bool;
    fn on_video(&self, frame: EncodedFrame);
    fn on_audio(&self, packet: AudioPacket);
    fn on_error(&self, error: MediaError);
}

/// A running capture. Dropping it stops capture and encoding.
pub trait ScreenStream: Send {
    fn info(&self) -> &StreamInfo;
    fn request_keyframe(&self);
    fn set_bitrate(&self, bps: u32);
}

pub fn displays() -> Result<Vec<DisplayInfo>> {
    platform::displays()
}

pub fn start_stream(
    config: StreamConfig,
    sink: Arc<dyn StreamSink>,
) -> Result<Box<dyn ScreenStream>> {
    platform::start_stream(config, sink)
}

/// Posts protocol input records as OS input on the streamed display.
pub trait InputInjector: Send {
    fn set_display(&mut self, display: &DisplayInfo);
    fn handle(&mut self, record: &InputRecord) -> Result<()>;
}

pub fn input_injector() -> Result<Box<dyn InputInjector>> {
    platform::input_injector()
}

/// What the OS must allow before this computer can be shared. Platforms
/// without such gates report everything granted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Permissions {
    pub screen_recording: bool,
    pub accessibility: bool,
}

pub fn permissions() -> Permissions {
    platform::permissions()
}

pub fn request_screen_recording() {
    platform::request_screen_recording()
}

pub fn request_accessibility() {
    platform::request_accessibility()
}

/// macOS virtual key code for a DOM `KeyboardEvent.code`, the wire's key code.
pub fn mac_key_code(dom_code: &str) -> Option<u16> {
    keymap::mac_key_code(dom_code)
}

pub mod keymap;
