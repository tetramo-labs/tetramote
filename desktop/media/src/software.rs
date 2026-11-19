//! openh264, the software H.264 encoder every platform falls back to.

use crate::{EncodedFrame, MediaError, Result};

pub struct SoftwareEncoder {
    width: u32,
    height: u32,
}

impl SoftwareEncoder {
    pub fn new(width: u32, height: u32, _bitrate_bps: u32, _fps: u32) -> Result<Self> {
        Err(MediaError::Unsupported(format!(
            "The software H.264 encoder isn't built yet ({width}x{height})."
        )))
    }

    /// One BGRA frame (`stride` bytes per row) in, one Annex B access unit out;
    /// `None` when the encoder skipped the frame to hold its bitrate.
    pub fn encode_bgra(&mut self, _bgra: &[u8], _stride: usize, _pts_us: u64, _keyframe: bool) -> Result<Option<EncodedFrame>> {
        Err(MediaError::Unsupported(format!(
            "The software H.264 encoder isn't built yet ({}x{}).",
            self.width, self.height
        )))
    }

    pub fn set_bitrate(&mut self, _bps: u32) {}
}
