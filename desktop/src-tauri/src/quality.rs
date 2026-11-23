use serde_json::Value;

use crate::bitrate::START_BPS;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamPlan {
    pub max_long_edge: u32,
    pub fps: u32,
    pub start_bps: u32,
    pub floor_bps: u32,
    pub ceiling_bps: u32,
}

const NATIVE: StreamPlan = StreamPlan {
    max_long_edge: 2560,
    fps: 60,
    start_bps: START_BPS,
    floor_bps: 1_500_000,
    ceiling_bps: 20_000_000,
};

const MIN_LONG_EDGE: u32 = 640;
const MAX_LONG_EDGE: u32 = 3840;

pub fn plan(prefs: Option<&Value>) -> StreamPlan {
    let Some(prefs) = prefs.filter(|p| p.is_object()) else {
        return NATIVE;
    };
    let viewer = prefs["maxLongEdge"]
        .as_u64()
        .map(|px| (px.min(u64::from(u32::MAX)) as u32).max(MIN_LONG_EDGE));
    let (cap, start_bps, floor_bps, ceiling_bps, fit_viewer) = match prefs["quality"].as_str() {
        Some("responsive") => (1280, 3_000_000, 800_000, 6_000_000, true),
        Some("sharp") => (2560, 10_000_000, 3_000_000, 25_000_000, false),
        _ => (1920, 6_000_000, 1_500_000, 12_000_000, true),
    };
    let chosen = prefs["resolution"]
        .as_u64()
        .map(|px| px.clamp(u64::from(MIN_LONG_EDGE), u64::from(MAX_LONG_EDGE)) as u32);
    let max_long_edge = match (chosen, viewer) {
        (Some(px), _) => px,
        (None, Some(px)) if fit_viewer => px.min(cap),
        _ => cap,
    };
    StreamPlan {
        max_long_edge,
        fps: 60,
        start_bps,
        floor_bps,
        ceiling_bps,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_the_native_stream_without_preferences() {
        assert_eq!(plan(None), NATIVE);
        assert_eq!(plan(Some(&Value::Null)), NATIVE);
    }

    #[test]
    fn fits_responsive_and_balanced_to_the_viewer_under_their_caps() {
        let p = plan(Some(&json!({"quality": "responsive", "maxLongEdge": 2034})));
        assert_eq!(
            (p.max_long_edge, p.start_bps, p.floor_bps, p.ceiling_bps),
            (1280, 3_000_000, 800_000, 6_000_000)
        );
        let p = plan(Some(&json!({"quality": "balanced", "maxLongEdge": 1146})));
        assert_eq!(
            (p.max_long_edge, p.start_bps, p.ceiling_bps),
            (1146, 6_000_000, 12_000_000)
        );
        let p = plan(Some(&json!({"quality": "balanced", "maxLongEdge": 200})));
        assert_eq!(p.max_long_edge, 640);
    }

    #[test]
    fn sharp_streams_full_size_for_zooming_in() {
        let p = plan(Some(&json!({"quality": "sharp", "maxLongEdge": 1146})));
        assert_eq!(
            (p.max_long_edge, p.start_bps, p.floor_bps, p.ceiling_bps),
            (2560, 10_000_000, 3_000_000, 25_000_000)
        );
    }

    #[test]
    fn a_chosen_resolution_overrides_the_preset_and_the_viewer() {
        let p = plan(Some(
            &json!({"quality": "responsive", "maxLongEdge": 1146, "resolution": 1920}),
        ));
        assert_eq!((p.max_long_edge, p.ceiling_bps), (1920, 6_000_000));
        let p = plan(Some(&json!({"quality": "sharp", "resolution": 9000})));
        assert_eq!(p.max_long_edge, 3840);
    }

    #[test]
    fn treats_an_unknown_quality_as_balanced() {
        let p = plan(Some(&json!({"quality": "ultra"})));
        assert_eq!((p.max_long_edge, p.ceiling_bps), (1920, 12_000_000));
    }
}
