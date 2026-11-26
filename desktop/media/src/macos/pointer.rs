//! The system pointer's image, for viewers that draw their own pointer.

use objc2::rc::autoreleasepool;
use objc2_app_kit::{NSCursor, NSGraphicsContext};
use objc2_core_graphics::{
    kCGColorSpaceSRGB, CGBitmapContextCreate, CGColorSpace, CGImageAlphaInfo,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};

use crate::PointerShape;

const MAX_PIXELS_PER_POINT: f64 = 4.0;
const MAX_LONG_EDGE_PX: f64 = 256.0;

/// The pointer as straight RGBA at `scale` pixels per point, kept unencoded
/// so a poll can compare it with the last one before building a PNG.
#[derive(Debug, PartialEq)]
pub struct Pointer {
    width: usize,
    height: usize,
    rgba: Vec<u8>,
    hot_x: f64,
    hot_y: f64,
    scale: f64,
}

impl Pointer {
    pub fn shape(&self) -> Option<PointerShape> {
        PointerShape::from_rgba(
            self.width as u32,
            self.height as u32,
            &self.rgba,
            (self.hot_x * self.scale) as f32,
            (self.hot_y * self.scale) as f32,
            self.scale as f32,
        )
    }
}

/// The system pointer, whichever app set it. AppKit allows reading
/// `currentSystemCursor` and drawing its image off the main thread.
#[allow(deprecated)]
pub fn current() -> Option<Pointer> {
    autoreleasepool(|_| {
        let cursor = NSCursor::currentSystemCursor()?;
        let image = cursor.image();
        let size = image.size();
        let long = size.width.max(size.height);
        if long.is_nan() || long <= 0.0 {
            return None;
        }
        let scale = (MAX_LONG_EDGE_PX / long).min(MAX_PIXELS_PER_POINT);
        let width = (size.width * scale).round().max(1.0) as usize;
        let height = (size.height * scale).round().max(1.0) as usize;
        let mut rgba = vec![0u8; width * height * 4];
        let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))?;
        let context = unsafe {
            CGBitmapContextCreate(
                rgba.as_mut_ptr().cast(),
                width,
                height,
                8,
                width * 4,
                Some(&space),
                CGImageAlphaInfo::PremultipliedLast.0,
            )
        }?;
        let graphics = NSGraphicsContext::graphicsContextWithCGContext_flipped(&context, false);
        NSGraphicsContext::setCurrentContext(Some(&graphics));
        image.drawInRect(NSRect::new(
            NSPoint::ZERO,
            NSSize::new(width as f64, height as f64),
        ));
        NSGraphicsContext::setCurrentContext(None);
        drop(graphics);
        drop(context);
        unpremultiply(&mut rgba);
        let hot = cursor.hotSpot();
        Some(Pointer {
            width,
            height,
            rgba,
            hot_x: hot.x,
            hot_y: hot.y,
            scale,
        })
    })
}

fn unpremultiply(rgba: &mut [u8]) {
    for pixel in rgba.as_chunks_mut::<4>().0 {
        let alpha = u32::from(pixel[3]);
        if alpha == 0 || alpha == 255 {
            continue;
        }
        for channel in &mut pixel[..3] {
            *channel = ((u32::from(*channel) * 255 + alpha / 2) / alpha).min(255) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpremultiplies_partly_transparent_pixels() {
        let mut rgba = [128, 64, 0, 128, 0, 0, 0, 0, 200, 10, 0, 255, 200, 0, 0, 100];
        unpremultiply(&mut rgba);
        assert_eq!(
            rgba,
            [255, 128, 0, 128, 0, 0, 0, 0, 200, 10, 0, 255, 255, 0, 0, 100]
        );
    }
}
