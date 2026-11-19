//! macOS: ScreenCaptureKit capture, VideoToolbox H.264 (openh264 when no
//! hardware session starts), Opus system audio and CGEvent input.

mod audio;
mod capture;
mod display;
mod input;
mod permissions;
mod video;

use std::sync::Arc;

use crate::{
    DisplayInfo, InputInjector, Permissions, Result, ScreenStream, StreamConfig, StreamSink,
};

pub fn displays() -> Result<Vec<DisplayInfo>> {
    display::displays()
}

pub fn start_stream(
    config: StreamConfig,
    sink: Arc<dyn StreamSink>,
) -> Result<Box<dyn ScreenStream>> {
    capture::start(config, sink)
}

pub fn input_injector() -> Result<Box<dyn InputInjector>> {
    Ok(Box::new(input::MacInjector::new()?))
}

pub fn permissions() -> Permissions {
    Permissions {
        screen_recording: permissions::screen_recording(),
        accessibility: permissions::accessibility(),
    }
}

pub fn request_screen_recording() {
    permissions::request_screen_recording()
}

pub fn request_accessibility() {
    permissions::request_accessibility()
}
