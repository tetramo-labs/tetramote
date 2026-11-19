//! Linux host through xdg-desktop-portal: one RemoteDesktop session with a
//! ScreenCast source (the user approves it on this computer; the grant is
//! remembered where the portal supports restore tokens), PipeWire for frames
//! and system audio, and openh264 for encoding.

mod audio;
mod capture;
mod input;
mod portal;

use std::sync::Arc;

use crate::{
    DisplayInfo, InputInjector, Permissions, Result, ScreenStream, StreamConfig, StreamSink,
};

/// The portal names its screens only once a session is approved, so until
/// then this lists a single "Entire screen" with no size (id 0, which
/// `start_stream` treats as "whatever the user picks").
pub fn displays() -> Result<Vec<DisplayInfo>> {
    Ok(portal::displays())
}

pub fn start_stream(
    config: StreamConfig,
    sink: Arc<dyn StreamSink>,
) -> Result<Box<dyn ScreenStream>> {
    capture::start(config, sink)
}

pub fn input_injector() -> Result<Box<dyn InputInjector>> {
    Ok(Box::new(input::Injector::new()?))
}

/// The portal asks the user itself, so nothing needs granting up front.
pub fn permissions() -> Permissions {
    Permissions {
        screen_recording: true,
        accessibility: true,
    }
}

pub fn request_screen_recording() {}

pub fn request_accessibility() {}
