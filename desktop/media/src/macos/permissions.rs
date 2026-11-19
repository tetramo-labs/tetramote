//! Screen Recording and Accessibility. The checks never prompt; only the
//! `request_*` functions show macOS's prompts or open System Settings.

use objc2_app_kit::NSWorkspace;
use objc2_core_foundation::{CFBoolean, CFDictionary, CFString, CFType};
use objc2_core_graphics::{CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess};
use objc2_foundation::{NSString, NSURL};

pub const SCREEN_RECORDING_OFF: &str = "Screen Recording is off for Tetratop. Turn it on in System Settings > Privacy & Security > Screen & System Audio Recording, then share again.";
pub const ACCESSIBILITY_OFF: &str = "Accessibility is off for Tetratop, so it can't control this Mac. Turn it on in System Settings > Privacy & Security > Accessibility.";

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: Option<&CFDictionary>) -> u8;
    static kAXTrustedCheckOptionPrompt: &'static CFString;
}

pub fn screen_recording() -> bool {
    CGPreflightScreenCaptureAccess()
}

pub fn accessibility() -> bool {
    unsafe { AXIsProcessTrusted() != 0 }
}

pub fn request_screen_recording() {
    if !CGRequestScreenCaptureAccess() {
        open_settings("Privacy_ScreenCapture");
    }
}

pub fn request_accessibility() {
    let prompt: &CFType = unsafe { kAXTrustedCheckOptionPrompt };
    let yes: &CFType = CFBoolean::new(true);
    let options = CFDictionary::from_slices(&[prompt], &[yes]);
    if unsafe { AXIsProcessTrustedWithOptions(Some(options.as_opaque())) } == 0 {
        open_settings("Privacy_Accessibility");
    }
}

fn open_settings(anchor: &str) {
    let address = NSString::from_str(&format!(
        "x-apple.systempreferences:com.apple.preference.security?{anchor}"
    ));
    let opened = NSURL::URLWithString(&address)
        .is_some_and(|url| NSWorkspace::sharedWorkspace().openURL(&url));
    if !opened {
        log::warn!("System Settings didn't open at {anchor}. Open System Settings > Privacy & Security by hand.");
    }
}
