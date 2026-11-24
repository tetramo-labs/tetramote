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

const MIN_LONG_EDGE: u64 = 640;
const MAX_LONG_EDGE: u64 = 3840;
const AUTO_LONG_EDGE: u32 = 1920;
const MIN_BPS: u64 = 500_000;
const MAX_BPS: u64 = 50_000_000;

pub fn plan(prefs: Option<&Value>) -> StreamPlan {
    let Some(prefs) = prefs.filter(|p| p.is_object()) else {
        return NATIVE;
    };
    let long_edge = |px: u64| px.clamp(MIN_LONG_EDGE, MAX_LONG_EDGE) as u32;
    let max_long_edge = match (prefs["resolution"].as_u64(), prefs["maxLongEdge"].as_u64()) {
        (Some(px), _) => long_edge(px),
        (None, Some(px)) => long_edge(px).min(AUTO_LONG_EDGE),
        (None, None) => AUTO_LONG_EDGE,
    };
    let (start_bps, floor_bps, ceiling_bps) = match prefs["bitrate"].as_u64() {
        Some(bps) => {
            let bps = bps.clamp(MIN_BPS, MAX_BPS) as u32;
            (bps, (bps / 4).max(MIN_BPS as u32), bps)
        }
        None => (6_000_000, 1_500_000, 20_000_000),
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
    fn automatic_fits_the_viewer_up_to_1080p_and_adapts_the_bitrate() {
        let p = plan(Some(&json!({"maxLongEdge": 1146})));
        assert_eq!(
            (p.max_long_edge, p.start_bps, p.floor_bps, p.ceiling_bps),
            (1146, 6_000_000, 1_500_000, 20_000_000)
        );
        assert_eq!(
            plan(Some(&json!({"maxLongEdge": 2856}))).max_long_edge,
            1920
        );
        assert_eq!(plan(Some(&json!({"maxLongEdge": 200}))).max_long_edge, 640);
    }

    #[test]
    fn a_chosen_resolution_overrides_the_viewer() {
        assert_eq!(
            plan(Some(&json!({"maxLongEdge": 1146, "resolution": 2560}))).max_long_edge,
            2560
        );
        assert_eq!(plan(Some(&json!({"resolution": 9000}))).max_long_edge, 3840);
    }

    #[test]
    fn a_max_bitrate_caps_the_stream_and_lets_it_step_down_to_a_quarter() {
        let p = plan(Some(&json!({"maxLongEdge": 2856, "bitrate": 4_000_000})));
        assert_eq!(
            (p.start_bps, p.floor_bps, p.ceiling_bps),
            (4_000_000, 1_000_000, 4_000_000)
        );
        let p = plan(Some(&json!({"bitrate": 1_000_000})));
        assert_eq!(
            (p.start_bps, p.floor_bps, p.ceiling_bps),
            (1_000_000, 500_000, 1_000_000)
        );
    }
}
