//! Windows host: DXGI Desktop Duplication for capture, the Media Foundation
//! hardware H.264 encoder with openh264 as the fallback, WASAPI loopback for
//! system audio and SendInput for control.

mod audio;
mod capture;
mod display;
mod input;
mod mft;

use std::sync::{Arc, Once};

use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
use windows::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};

use crate::{
    DisplayInfo, InputInjector, MediaError, Permissions, Result, ScreenStream, StreamConfig,
    StreamSink,
};

pub fn displays() -> Result<Vec<DisplayInfo>> {
    dpi_aware();
    display::displays()
}

pub fn start_stream(
    config: StreamConfig,
    sink: Arc<dyn StreamSink>,
) -> Result<Box<dyn ScreenStream>> {
    dpi_aware();
    capture::start(config, sink)
}

pub fn input_injector() -> Result<Box<dyn InputInjector>> {
    dpi_aware();
    Ok(Box::new(input::Injector::new()?))
}

pub fn permissions() -> Permissions {
    Permissions {
        screen_recording: true,
        accessibility: true,
    }
}

pub fn request_screen_recording() {}

pub fn request_accessibility() {}

/// Duplication sizes, monitor rects and SendInput coordinates are physical
/// pixels only once the process is per-monitor DPI aware; an app manifest
/// that already set it makes this call fail harmlessly.
fn dpi_aware() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    });
}

/// COM for the current thread (multithreaded apartment), released on drop.
struct Com(bool);

impl Com {
    fn init() -> Self {
        Self(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

fn failed(what: &str, error: windows::core::Error) -> MediaError {
    MediaError::Failed(format!("{what} failed: {error}. Reconnect to try again."))
}
