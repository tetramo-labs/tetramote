//! Displays from CoreGraphics, which answers without a Screen Recording grant.
//! Names come from NSScreen, which AppKit only serves on the main thread.

use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Duration;

use dispatch2::DispatchQueue;
use objc2::MainThreadMarker;
use objc2_app_kit::NSScreen;
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayBounds, CGDisplayCopyDisplayMode, CGDisplayIsMain,
    CGDisplayMirrorsDisplay, CGDisplayMode, CGDisplayPixelsHigh, CGDisplayPixelsWide, CGError,
    CGGetActiveDisplayList,
};
use objc2_foundation::{NSNumber, NSString};

use crate::{DisplayInfo, MediaError, Result};

const MAX_DISPLAYS: usize = 32;
const NAME_WAIT: Duration = Duration::from_millis(500);

pub fn displays() -> Result<Vec<DisplayInfo>> {
    let names = screen_names();
    Ok(active_displays()?
        .into_iter()
        .filter(|&id| CGDisplayMirrorsDisplay(id) == 0)
        .map(|id| info(id, &names))
        .collect())
}

pub fn display(id: CGDirectDisplayID) -> DisplayInfo {
    info(id, &screen_names())
}

fn active_displays() -> Result<Vec<CGDirectDisplayID>> {
    let mut ids = [0 as CGDirectDisplayID; MAX_DISPLAYS];
    let mut count = 0u32;
    let error =
        unsafe { CGGetActiveDisplayList(MAX_DISPLAYS as u32, ids.as_mut_ptr(), &mut count) };
    if error != CGError::Success {
        return Err(MediaError::Failed(format!(
            "macOS couldn't list the displays (CoreGraphics error {}). Reconnect the display and try again.",
            error.0
        )));
    }
    Ok(ids[..(count as usize).min(MAX_DISPLAYS)].to_vec())
}

fn info(id: CGDirectDisplayID, names: &HashMap<CGDirectDisplayID, String>) -> DisplayInfo {
    let points = CGDisplayBounds(id).size;
    let mode = CGDisplayCopyDisplayMode(id);
    let (width, height) = match (
        CGDisplayMode::pixel_width(mode.as_deref()),
        CGDisplayMode::pixel_height(mode.as_deref()),
    ) {
        (0, _) | (_, 0) => (CGDisplayPixelsWide(id), CGDisplayPixelsHigh(id)),
        size => size,
    };
    DisplayInfo {
        id: u64::from(id),
        name: names
            .get(&id)
            .cloned()
            .unwrap_or_else(|| format!("Display {id}")),
        width: width as u32,
        height: height as u32,
        point_width: points.width.round() as u32,
        point_height: points.height.round() as u32,
        main: CGDisplayIsMain(id),
    }
}

/// Waits at most `NAME_WAIT` for the main thread, so a caller that blocks the
/// main thread gets numbered names instead of a deadlock.
fn screen_names() -> HashMap<CGDirectDisplayID, String> {
    if let Some(mtm) = MainThreadMarker::new() {
        return names_on_main(mtm);
    }
    let (sender, receiver) = mpsc::channel();
    DispatchQueue::main().exec_async(move || {
        if let Some(mtm) = MainThreadMarker::new() {
            sender.send(names_on_main(mtm)).ok();
        }
    });
    receiver.recv_timeout(NAME_WAIT).unwrap_or_default()
}

fn names_on_main(mtm: MainThreadMarker) -> HashMap<CGDirectDisplayID, String> {
    let key = NSString::from_str("NSScreenNumber");
    NSScreen::screens(mtm)
        .iter()
        .filter_map(|screen| {
            let number = screen
                .deviceDescription()
                .objectForKey(&key)?
                .downcast::<NSNumber>()
                .ok()?;
            Some((
                number.unsignedIntValue(),
                screen.localizedName().to_string(),
            ))
        })
        .collect()
}

/// The display's pixel size fitted inside `max_long_edge`, with the even sides
/// H.264's 4:2:0 subsampling needs.
pub fn stream_size(width: u32, height: u32, max_long_edge: u32) -> (u32, u32) {
    let long_edge = width.max(height);
    let fit = |side: u32| {
        if long_edge > max_long_edge {
            (u64::from(side) * u64::from(max_long_edge) / u64::from(long_edge)) as u32
        } else {
            side
        }
    };
    let even = |side: u32| (fit(side) & !1).max(2);
    (even(width), even(height))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_displays_that_fit() {
        assert_eq!(stream_size(1920, 1080, 2560), (1920, 1080));
        assert_eq!(stream_size(2560, 1600, 2560), (2560, 1600));
    }

    #[test]
    fn scales_the_long_edge_down() {
        assert_eq!(stream_size(3024, 1964, 2560), (2560, 1662));
        assert_eq!(stream_size(5120, 2880, 2560), (2560, 1440));
        assert_eq!(stream_size(1964, 3024, 2560), (1662, 2560));
    }

    #[test]
    fn makes_sides_even() {
        assert_eq!(stream_size(1365, 767, 2560), (1364, 766));
        assert_eq!(stream_size(1, 1, 2560), (2, 2));
    }
}
