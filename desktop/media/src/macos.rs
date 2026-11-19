use std::sync::Arc;

use crate::{DisplayInfo, InputInjector, MediaError, Permissions, Result, ScreenStream, StreamConfig, StreamSink};

pub fn displays() -> Result<Vec<DisplayInfo>> {
    Err(MediaError::Unsupported("Sharing this computer isn't built for macos yet.".into()))
}

pub fn start_stream(_config: StreamConfig, _sink: Arc<dyn StreamSink>) -> Result<Box<dyn ScreenStream>> {
    Err(MediaError::Unsupported("Sharing this computer isn't built for macos yet.".into()))
}

pub fn input_injector() -> Result<Box<dyn InputInjector>> {
    Err(MediaError::Unsupported("Controlling this computer isn't built for macos yet.".into()))
}

pub fn permissions() -> Permissions {
    Permissions { screen_recording: true, accessibility: true }
}

pub fn request_screen_recording() {}

pub fn request_accessibility() {}
