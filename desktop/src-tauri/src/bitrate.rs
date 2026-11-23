use std::time::{Duration, Instant};

pub const START_BPS: u32 = 8_000_000;
const SKIPS_TO_STEP_DOWN: u32 = 2;
const SKIP_WINDOW: Duration = Duration::from_secs(1);
const CLEAN_TO_STEP_UP: Duration = Duration::from_secs(3);

/// Lowers the encoder bitrate when the send backlog makes the host skip frames,
/// and raises it again after a stretch without skips.
#[derive(Debug)]
pub struct BitrateController {
    bitrate: u32,
    floor: u32,
    ceiling: u32,
    window_start: Instant,
    skips: u32,
    last_change: Instant,
    last_skip: Option<Instant>,
}

impl BitrateController {
    pub fn within(now: Instant, start: u32, floor: u32, ceiling: u32) -> Self {
        Self {
            bitrate: start.clamp(floor, ceiling),
            floor,
            ceiling,
            window_start: now,
            skips: 0,
            last_change: now,
            last_skip: None,
        }
    }

    #[cfg(test)]
    pub fn bitrate(&self) -> u32 {
        self.bitrate
    }

    /// Returns the new bitrate when it changed.
    pub fn on_skip(&mut self, now: Instant) -> Option<u32> {
        if now.duration_since(self.window_start) > SKIP_WINDOW {
            self.window_start = now;
            self.skips = 0;
        }
        self.skips += 1;
        self.last_skip = Some(now);
        if self.skips < SKIPS_TO_STEP_DOWN {
            return None;
        }
        self.skips = 0;
        self.window_start = now;
        self.change((self.bitrate as f64 * 0.7) as u32, now)
    }

    pub fn on_sent(&mut self, now: Instant) -> Option<u32> {
        let quiet_since = self
            .last_skip
            .map_or(self.last_change, |s| s.max(self.last_change));
        if now.duration_since(quiet_since) < CLEAN_TO_STEP_UP {
            return None;
        }
        self.change((self.bitrate as f64 * 1.1) as u32, now)
    }

    fn change(&mut self, target: u32, now: Instant) -> Option<u32> {
        let next = target.clamp(self.floor, self.ceiling);
        self.last_change = now;
        if next == self.bitrate {
            return None;
        }
        self.bitrate = next;
        Some(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_down_after_two_skips_within_a_second_and_floors() {
        let t0 = Instant::now();
        let mut c = BitrateController::within(t0, START_BPS, 1_500_000, 20_000_000);
        assert_eq!(c.on_skip(t0), None);
        assert_eq!(c.on_skip(t0 + Duration::from_millis(100)), Some(5_600_000));
        for i in 0..40 {
            c.on_skip(t0 + Duration::from_millis(200 + i * 10));
        }
        assert_eq!(c.bitrate(), 1_500_000);
    }

    #[test]
    fn a_lone_skip_per_second_never_steps_down() {
        let t0 = Instant::now();
        let mut c = BitrateController::within(t0, START_BPS, 1_500_000, 20_000_000);
        assert_eq!(c.on_skip(t0), None);
        assert_eq!(c.on_skip(t0 + Duration::from_millis(1500)), None);
        assert_eq!(c.bitrate(), START_BPS);
    }

    #[test]
    fn steps_up_after_three_quiet_seconds_and_caps() {
        let t0 = Instant::now();
        let mut c = BitrateController::within(t0, START_BPS, 1_500_000, 20_000_000);
        assert_eq!(c.on_sent(t0 + Duration::from_secs(2)), None);
        assert_eq!(c.on_sent(t0 + Duration::from_secs(3)), Some(8_800_000));
        assert_eq!(c.on_sent(t0 + Duration::from_secs(4)), None);
        let mut t = t0 + Duration::from_secs(3);
        for _ in 0..20 {
            t += Duration::from_secs(3);
            c.on_sent(t);
        }
        assert_eq!(c.bitrate(), 20_000_000);
    }

    #[test]
    fn stays_within_the_limits_it_was_given() {
        let t0 = Instant::now();
        let mut c = BitrateController::within(t0, 3_000_000, 800_000, 6_000_000);
        assert_eq!(c.bitrate(), 3_000_000);
        let mut t = t0;
        for _ in 0..20 {
            t += Duration::from_secs(3);
            c.on_sent(t);
        }
        assert_eq!(c.bitrate(), 6_000_000);
        for i in 0..60 {
            c.on_skip(t + Duration::from_millis(i * 10));
        }
        assert_eq!(c.bitrate(), 800_000);
    }
}
