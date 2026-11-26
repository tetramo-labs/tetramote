/// The pointer's image as the OS draws it, sized in display points.
#[derive(Debug, Clone, PartialEq)]
pub struct PointerShape {
    pub png: Vec<u8>,
    pub width: f32,
    pub height: f32,
    pub hot_x: f32,
    pub hot_y: f32,
}

impl PointerShape {
    /// `rgba` is straight (not premultiplied) and tightly packed; `None` when
    /// it doesn't hold `width_px` by `height_px` pixels.
    pub fn from_rgba(
        width_px: u32,
        height_px: u32,
        rgba: &[u8],
        hot_x_px: f32,
        hot_y_px: f32,
        pixels_per_point: f32,
    ) -> Option<Self> {
        let pixels = width_px as usize * height_px as usize;
        if pixels == 0 || rgba.len() != pixels * 4 || pixels_per_point <= 0.0 {
            return None;
        }
        let mut png = Vec::new();
        let mut encoder = png::Encoder::new(&mut png, width_px, height_px);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
        writer.finish().ok()?;
        Some(Self {
            png,
            width: width_px as f32 / pixels_per_point,
            height: height_px as f32 / pixels_per_point,
            hot_x: hot_x_px / pixels_per_point,
            hot_y: hot_y_px / pixels_per_point,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(png: &[u8]) -> (u32, u32, png::ColorType, Vec<u8>) {
        let mut reader = png::Decoder::new(std::io::Cursor::new(png))
            .read_info()
            .unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let frame = reader.next_frame(&mut pixels).unwrap();
        pixels.truncate(frame.buffer_size());
        (frame.width, frame.height, frame.color_type, pixels)
    }

    #[test]
    fn encodes_straight_rgba_and_sizes_it_in_points() {
        let rgba = [
            255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, //
            10, 20, 30, 40, 0, 0, 0, 255, 255, 255, 255, 255,
        ];
        let shape = PointerShape::from_rgba(3, 2, &rgba, 1.0, 1.5, 2.0).unwrap();
        assert_eq!(
            decode(&shape.png),
            (3, 2, png::ColorType::Rgba, rgba.to_vec())
        );
        assert_eq!(
            (shape.width, shape.height, shape.hot_x, shape.hot_y),
            (1.5, 1.0, 0.5, 0.75)
        );
    }

    #[test]
    fn rejects_buffers_that_do_not_match_the_size() {
        assert_eq!(PointerShape::from_rgba(2, 2, &[0; 12], 0.0, 0.0, 1.0), None);
        assert_eq!(PointerShape::from_rgba(0, 0, &[], 0.0, 0.0, 1.0), None);
        assert_eq!(PointerShape::from_rgba(1, 1, &[0; 4], 0.0, 0.0, 0.0), None);
    }
}
