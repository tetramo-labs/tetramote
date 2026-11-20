//! Protocol input records as CGEvents on the streamed display. Without
//! Accessibility macOS silently drops posted events, so records are refused
//! with an error instead.

use objc2_core_foundation::{CFRetained, CGPoint, CGRect};
use objc2_core_graphics::{
    CGDisplayBounds, CGEvent, CGEventField, CGEventFlags, CGEventSource, CGEventSourceStateID,
    CGEventTapLocation, CGEventType, CGMainDisplayID, CGMouseButton, CGScrollEventUnit,
};
use tetra_core::input::{SCROLL_BEGAN, SCROLL_CHANGED, SCROLL_ENDED, SCROLL_MOMENTUM};

use super::permissions;
use crate::{DisplayInfo, InputInjector, InputRecord, MediaError, Result};

const TEXT_CHUNK_UNITS: usize = 20;

#[derive(Debug, Clone, PartialEq)]
pub enum Synth {
    Mouse {
        kind: CGEventType,
        at: CGPoint,
        button: CGMouseButton,
        delta: (i64, i64),
        clicks: Option<i64>,
    },
    Scroll {
        vertical: i32,
        horizontal: i32,
        phase: Option<i64>,
        momentum: Option<i64>,
    },
    Key {
        code: u16,
        down: bool,
        flags: CGEventFlags,
    },
    Text {
        units: Vec<u16>,
        down: bool,
    },
}

/// Moves while a button is held must be drags, and sub-pixel scroll carries
/// over to the next record until the gesture ends.
pub struct InputState {
    bounds: CGRect,
    held: [bool; 3],
    remainder: (f64, f64),
}

impl InputState {
    pub fn new(bounds: CGRect) -> Self {
        Self {
            bounds,
            held: [false; 3],
            remainder: (0.0, 0.0),
        }
    }

    pub fn set_bounds(&mut self, bounds: CGRect) {
        self.bounds = bounds;
    }

    /// `cursor` is asked for the pointer's location only when a record needs it.
    pub fn events(
        &mut self,
        record: &InputRecord,
        cursor: impl FnOnce() -> Option<CGPoint>,
    ) -> Vec<Synth> {
        match record {
            InputRecord::Move { dx, dy } => {
                let from = cursor().unwrap_or_else(|| self.bounds.mid());
                let to = CGPoint::new(from.x + f64::from(*dx), from.y + f64::from(*dy));
                vec![self.motion(
                    to,
                    (f64::from(*dx).round() as i64, f64::from(*dy).round() as i64),
                )]
            }
            InputRecord::MoveTo { x, y } => {
                let origin = self.bounds.min();
                let size = self.bounds.size;
                let to = CGPoint::new(
                    origin.x + f64::from(*x) * size.width,
                    origin.y + f64::from(*y) * size.height,
                );
                vec![self.motion(to, (0, 0))]
            }
            InputRecord::Button {
                button,
                down,
                clicks,
            } => {
                let at = self.clamp(cursor().unwrap_or_else(|| self.bounds.mid()));
                let (kind, mouse_button, index) = match (*button, *down) {
                    (1, true) => (CGEventType::RightMouseDown, CGMouseButton::Right, 1),
                    (1, false) => (CGEventType::RightMouseUp, CGMouseButton::Right, 1),
                    (2, true) => (CGEventType::OtherMouseDown, CGMouseButton::Center, 2),
                    (2, false) => (CGEventType::OtherMouseUp, CGMouseButton::Center, 2),
                    (_, true) => (CGEventType::LeftMouseDown, CGMouseButton::Left, 0),
                    (_, false) => (CGEventType::LeftMouseUp, CGMouseButton::Left, 0),
                };
                self.held[index] = *down;
                vec![Synth::Mouse {
                    kind,
                    at,
                    button: mouse_button,
                    delta: (0, 0),
                    clicks: Some(i64::from(*clicks)),
                }]
            }
            InputRecord::Scroll { dx, dy, phase } => {
                vec![self.scroll(f64::from(*dx), f64::from(*dy), *phase)]
            }
            InputRecord::Key {
                key_code,
                down,
                flags,
            } => {
                vec![Synth::Key {
                    code: *key_code,
                    down: *down,
                    flags: CGEventFlags(u64::from(*flags)),
                }]
            }
            InputRecord::Text(text) => utf16_chunks(text, TEXT_CHUNK_UNITS)
                .into_iter()
                .flat_map(|units| {
                    [
                        Synth::Text {
                            units: units.clone(),
                            down: true,
                        },
                        Synth::Text { units, down: false },
                    ]
                })
                .collect(),
        }
    }

    fn motion(&self, to: CGPoint, delta: (i64, i64)) -> Synth {
        let (kind, button) = match self.held {
            [true, ..] => (CGEventType::LeftMouseDragged, CGMouseButton::Left),
            [_, true, _] => (CGEventType::RightMouseDragged, CGMouseButton::Right),
            [.., true] => (CGEventType::OtherMouseDragged, CGMouseButton::Center),
            _ => (CGEventType::MouseMoved, CGMouseButton::Left),
        };
        Synth::Mouse {
            kind,
            at: self.clamp(to),
            button,
            delta,
            clicks: None,
        }
    }

    fn clamp(&self, point: CGPoint) -> CGPoint {
        let min = self.bounds.min();
        let max = self.bounds.max();
        CGPoint::new(
            point.x.min(max.x - 1.0).max(min.x),
            point.y.min(max.y - 1.0).max(min.y),
        )
    }

    fn scroll(&mut self, dx: f64, dy: f64, phase: u8) -> Synth {
        let x = self.remainder.0 + dx;
        let y = self.remainder.1 + dy;
        let horizontal = x.trunc();
        let vertical = y.trunc();
        self.remainder = (x - horizontal, y - vertical);
        let (phase, momentum) = match phase {
            SCROLL_BEGAN => (Some(1), None),
            SCROLL_CHANGED => (Some(2), None),
            SCROLL_ENDED => (Some(4), None),
            SCROLL_MOMENTUM => (None, Some(2)),
            _ => (None, None),
        };
        if phase == Some(4) {
            self.remainder = (0.0, 0.0);
        }
        Synth::Scroll {
            vertical: vertical as i32,
            horizontal: horizontal as i32,
            phase,
            momentum,
        }
    }
}

/// UTF-16 chunks of at most `max` units that never split a surrogate pair.
pub fn utf16_chunks(text: &str, max: usize) -> Vec<Vec<u16>> {
    let mut chunks = vec![Vec::new()];
    let mut buffer = [0u16; 2];
    for c in text.chars() {
        let units = c.encode_utf16(&mut buffer);
        if chunks
            .last()
            .is_some_and(|chunk| chunk.len() + units.len() > max)
        {
            chunks.push(Vec::new());
        }
        if let Some(chunk) = chunks.last_mut() {
            chunk.extend_from_slice(units);
        }
    }
    chunks.retain(|chunk| !chunk.is_empty());
    chunks
}

/// Posts through a HID-state source, so modifier keys pressed through it apply
/// to the mouse events that follow.
pub struct MacInjector {
    state: InputState,
    source: EventSource,
}

/// CGEventSource is only used by the injector that owns it, one call at a time.
struct EventSource(CFRetained<CGEventSource>);

unsafe impl Send for EventSource {}

impl MacInjector {
    pub fn new() -> Result<Self> {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).ok_or_else(|| {
            MediaError::Failed(
                "macOS didn't give Tetramote an input event source. Restart Tetramote and try again."
                    .into(),
            )
        })?;
        Ok(Self {
            state: InputState::new(CGDisplayBounds(CGMainDisplayID())),
            source: EventSource(source),
        })
    }

    fn post(&self, synth: &Synth) -> Result<()> {
        let source = Some(&*self.source.0);
        let event = match synth {
            Synth::Mouse {
                kind,
                at,
                button,
                delta,
                clicks,
            } => {
                let event = CGEvent::new_mouse_event(source, *kind, *at, *button);
                if let Some(event) = event.as_deref() {
                    CGEvent::set_integer_value_field(
                        Some(event),
                        CGEventField::MouseEventDeltaX,
                        delta.0,
                    );
                    CGEvent::set_integer_value_field(
                        Some(event),
                        CGEventField::MouseEventDeltaY,
                        delta.1,
                    );
                    if let Some(clicks) = clicks {
                        CGEvent::set_integer_value_field(
                            Some(event),
                            CGEventField::MouseEventClickState,
                            *clicks,
                        );
                    }
                }
                event
            }
            Synth::Scroll {
                vertical,
                horizontal,
                phase,
                momentum,
            } => {
                let event = CGEvent::new_scroll_wheel_event2(
                    source,
                    CGScrollEventUnit::Pixel,
                    2,
                    *vertical,
                    *horizontal,
                    0,
                );
                if let Some(event) = event.as_deref() {
                    CGEvent::set_integer_value_field(
                        Some(event),
                        CGEventField::ScrollWheelEventIsContinuous,
                        1,
                    );
                    if let Some(phase) = phase {
                        CGEvent::set_integer_value_field(
                            Some(event),
                            CGEventField::ScrollWheelEventScrollPhase,
                            *phase,
                        );
                    }
                    if let Some(momentum) = momentum {
                        CGEvent::set_integer_value_field(
                            Some(event),
                            CGEventField::ScrollWheelEventMomentumPhase,
                            *momentum,
                        );
                    }
                }
                event
            }
            Synth::Key { code, down, flags } => {
                let event = CGEvent::new_keyboard_event(source, *code, *down);
                CGEvent::set_flags(event.as_deref(), *flags);
                event
            }
            Synth::Text { units, down } => {
                let event = CGEvent::new_keyboard_event(source, 0, *down);
                unsafe {
                    CGEvent::keyboard_set_unicode_string(
                        event.as_deref(),
                        units.len() as _,
                        units.as_ptr(),
                    )
                };
                event
            }
        };
        let event = event.ok_or_else(|| {
            MediaError::Failed(
                "macOS couldn't create an input event. Reconnect and try again.".into(),
            )
        })?;
        CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&*event));
        Ok(())
    }
}

impl InputInjector for MacInjector {
    fn set_display(&mut self, display: &DisplayInfo) {
        self.state.set_bounds(CGDisplayBounds(display.id as u32));
    }

    fn handle(&mut self, record: &InputRecord) -> Result<()> {
        if !permissions::accessibility() {
            return Err(MediaError::PermissionDenied(
                permissions::ACCESSIBILITY_OFF.into(),
            ));
        }
        let cursor = || CGEvent::new(None).map(|event| CGEvent::location(Some(&*event)));
        for synth in self.state.events(record, cursor) {
            self.post(&synth)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use objc2_core_foundation::CGSize;

    use super::*;

    fn display() -> InputState {
        InputState::new(CGRect::new(
            CGPoint::new(1440.0, -200.0),
            CGSize::new(1920.0, 1080.0),
        ))
    }

    fn at(x: f64, y: f64) -> impl FnOnce() -> Option<CGPoint> {
        move || Some(CGPoint::new(x, y))
    }

    fn no_cursor() -> Option<CGPoint> {
        panic!("this record shouldn't need the cursor")
    }

    #[test]
    fn moves_relative_to_the_cursor_and_clamps_to_the_display() {
        let mut state = display();
        assert_eq!(
            state.events(
                &InputRecord::Move {
                    dx: 10.5,
                    dy: -3.75
                },
                at(2000.0, 300.0)
            ),
            [Synth::Mouse {
                kind: CGEventType::MouseMoved,
                at: CGPoint::new(2010.5, 296.25),
                button: CGMouseButton::Left,
                delta: (11, -4),
                clicks: None,
            }]
        );
        assert_eq!(
            state.events(
                &InputRecord::Move {
                    dx: -500.0,
                    dy: 5000.0
                },
                at(1500.0, 0.0)
            ),
            [Synth::Mouse {
                kind: CGEventType::MouseMoved,
                at: CGPoint::new(1440.0, 879.0),
                button: CGMouseButton::Left,
                delta: (-500, 5000),
                clicks: None,
            }]
        );
    }

    #[test]
    fn moves_absolutely_across_the_streamed_display() {
        let mut state = display();
        assert_eq!(
            state.events(&InputRecord::MoveTo { x: 0.5, y: 0.25 }, no_cursor),
            [Synth::Mouse {
                kind: CGEventType::MouseMoved,
                at: CGPoint::new(2400.0, 70.0),
                button: CGMouseButton::Left,
                delta: (0, 0),
                clicks: None,
            }]
        );
        assert_eq!(
            state.events(&InputRecord::MoveTo { x: 1.0, y: 1.0 }, no_cursor),
            [Synth::Mouse {
                kind: CGEventType::MouseMoved,
                at: CGPoint::new(3359.0, 879.0),
                button: CGMouseButton::Left,
                delta: (0, 0),
                clicks: None,
            }]
        );
    }

    #[test]
    fn drags_while_a_button_is_held() {
        let mut state = display();
        let down = InputRecord::Button {
            button: 0,
            down: true,
            clicks: 2,
        };
        assert_eq!(
            state.events(&down, at(1600.0, 100.0)),
            [Synth::Mouse {
                kind: CGEventType::LeftMouseDown,
                at: CGPoint::new(1600.0, 100.0),
                button: CGMouseButton::Left,
                delta: (0, 0),
                clicks: Some(2),
            }]
        );
        let drag = state.events(&InputRecord::MoveTo { x: 0.0, y: 0.0 }, no_cursor);
        assert_eq!(
            drag,
            [Synth::Mouse {
                kind: CGEventType::LeftMouseDragged,
                at: CGPoint::new(1440.0, -200.0),
                button: CGMouseButton::Left,
                delta: (0, 0),
                clicks: None,
            }]
        );
        state.events(
            &InputRecord::Button {
                button: 0,
                down: false,
                clicks: 2,
            },
            at(1440.0, -200.0),
        );
        let moved = state.events(&InputRecord::MoveTo { x: 0.0, y: 0.0 }, no_cursor);
        assert!(matches!(
            moved[0],
            Synth::Mouse {
                kind: CGEventType::MouseMoved,
                ..
            }
        ));
    }

    #[test]
    fn maps_right_and_middle_buttons() {
        let mut state = display();
        let right = state.events(
            &InputRecord::Button {
                button: 1,
                down: true,
                clicks: 1,
            },
            at(1500.0, 0.0),
        );
        assert!(matches!(
            right[0],
            Synth::Mouse {
                kind: CGEventType::RightMouseDown,
                button: CGMouseButton::Right,
                clicks: Some(1),
                ..
            }
        ));
        let drag = state.events(&InputRecord::Move { dx: 1.0, dy: 0.0 }, at(1500.0, 0.0));
        assert!(matches!(
            drag[0],
            Synth::Mouse {
                kind: CGEventType::RightMouseDragged,
                button: CGMouseButton::Right,
                ..
            }
        ));
        state.events(
            &InputRecord::Button {
                button: 1,
                down: false,
                clicks: 1,
            },
            at(1500.0, 0.0),
        );
        let middle = state.events(
            &InputRecord::Button {
                button: 2,
                down: true,
                clicks: 3,
            },
            at(1500.0, 0.0),
        );
        assert!(matches!(
            middle[0],
            Synth::Mouse {
                kind: CGEventType::OtherMouseDown,
                button: CGMouseButton::Center,
                clicks: Some(3),
                ..
            }
        ));
        let drag = state.events(&InputRecord::Move { dx: 1.0, dy: 0.0 }, at(1500.0, 0.0));
        assert!(matches!(
            drag[0],
            Synth::Mouse {
                kind: CGEventType::OtherMouseDragged,
                button: CGMouseButton::Center,
                ..
            }
        ));
    }

    #[test]
    fn carries_sub_pixel_scroll_until_the_gesture_ends() {
        let mut state = display();
        let scroll = |state: &mut InputState, dx: f32, dy: f32, phase: u8| {
            state
                .events(&InputRecord::Scroll { dx, dy, phase }, no_cursor)
                .remove(0)
        };
        assert_eq!(
            scroll(&mut state, 0.5, 1.75, SCROLL_BEGAN),
            Synth::Scroll {
                vertical: 1,
                horizontal: 0,
                phase: Some(1),
                momentum: None,
            }
        );
        assert_eq!(
            scroll(&mut state, 0.75, -0.5, SCROLL_CHANGED),
            Synth::Scroll {
                vertical: 0,
                horizontal: 1,
                phase: Some(2),
                momentum: None,
            }
        );
        assert_eq!(
            scroll(&mut state, 0.5, 0.5, SCROLL_ENDED),
            Synth::Scroll {
                vertical: 0,
                horizontal: 0,
                phase: Some(4),
                momentum: None,
            }
        );
        assert_eq!(
            scroll(&mut state, 0.5, -2.5, SCROLL_MOMENTUM),
            Synth::Scroll {
                vertical: -2,
                horizontal: 0,
                phase: None,
                momentum: Some(2),
            }
        );
        assert_eq!(
            scroll(&mut state, 0.5, 0.0, 0),
            Synth::Scroll {
                vertical: 0,
                horizontal: 1,
                phase: None,
                momentum: None,
            }
        );
    }

    #[test]
    fn passes_key_codes_and_modifier_flags_through() {
        let mut state = display();
        let record = InputRecord::Key {
            key_code: 0x08,
            down: true,
            flags: 0x100000 | 0x20000,
        };
        assert_eq!(
            state.events(&record, no_cursor),
            [Synth::Key {
                code: 0x08,
                down: true,
                flags: CGEventFlags::MaskCommand | CGEventFlags::MaskShift,
            }]
        );
        let record = InputRecord::Key {
            key_code: 0x24,
            down: false,
            flags: 0,
        };
        assert_eq!(
            state.events(&record, no_cursor),
            [Synth::Key {
                code: 0x24,
                down: false,
                flags: CGEventFlags(0),
            }]
        );
    }

    #[test]
    fn types_text_in_chunks_of_twenty_units() {
        let mut state = display();
        let events = state.events(
            &InputRecord::Text("abcdefghijklmnopqrstuvwxyz".into()),
            no_cursor,
        );
        let first: Vec<u16> = "abcdefghijklmnopqrst".encode_utf16().collect();
        let second: Vec<u16> = "uvwxyz".encode_utf16().collect();
        assert_eq!(
            events,
            [
                Synth::Text {
                    units: first.clone(),
                    down: true
                },
                Synth::Text {
                    units: first,
                    down: false
                },
                Synth::Text {
                    units: second.clone(),
                    down: true
                },
                Synth::Text {
                    units: second,
                    down: false
                },
            ]
        );
    }

    #[test]
    fn never_splits_a_surrogate_pair() {
        let text = format!("{}😀b", "a".repeat(19));
        let chunks = utf16_chunks(&text, 20);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].len(), 19);
        assert_eq!(chunks[1], [0xd83d, 0xde00, 0x62]);
        assert_eq!(utf16_chunks("", 20), Vec::<Vec<u16>>::new());
    }
}
