//! Input records as PROTOCOL.md lays them out. Key codes and modifier flags are
//! macOS virtual key codes and CGEventFlags on the wire whatever the host OS;
//! a host on another OS maps them to its own.

pub const FLAG_SHIFT: u32 = 0x20000;
pub const FLAG_CONTROL: u32 = 0x40000;
pub const FLAG_OPTION: u32 = 0x80000;
pub const FLAG_COMMAND: u32 = 0x100000;

pub const MOUSE_LEFT: u8 = 0;
pub const MOUSE_RIGHT: u8 = 1;
pub const MOUSE_MIDDLE: u8 = 2;

pub const SCROLL_NONE: u8 = 0;
pub const SCROLL_BEGAN: u8 = 1;
pub const SCROLL_CHANGED: u8 = 2;
pub const SCROLL_ENDED: u8 = 3;
pub const SCROLL_MOMENTUM: u8 = 4;

const MAX_TEXT_BYTES: usize = 1000;

#[derive(Debug, Clone, PartialEq)]
pub enum InputRecord {
    Move {
        dx: f32,
        dy: f32,
    },
    MoveTo {
        x: f32,
        y: f32,
    },
    Button {
        button: u8,
        down: bool,
        clicks: u8,
    },
    Scroll {
        dx: f32,
        dy: f32,
        phase: u8,
    },
    Key {
        key_code: u16,
        down: bool,
        flags: u32,
    },
    Text(String),
}

impl InputRecord {
    /// One record without its length prefix: type byte, then the payload.
    pub fn parse(record: &[u8]) -> Option<Self> {
        let (&kind, p) = record.split_first()?;
        let f = |at: usize| -> Option<f32> {
            Some(f32::from_be_bytes(p.get(at..at + 4)?.try_into().ok()?))
        };
        match kind {
            0x01 => Some(Self::Move {
                dx: f(0)?,
                dy: f(4)?,
            }),
            0x02 => Some(Self::MoveTo { x: f(0)?, y: f(4)? }),
            0x03 if p.len() >= 3 => Some(Self::Button {
                button: p[0],
                down: p[1] != 0,
                clicks: p[2].clamp(1, 3),
            }),
            0x04 if p.len() >= 9 => Some(Self::Scroll {
                dx: f(0)?,
                dy: f(4)?,
                phase: p[8],
            }),
            0x05 if p.len() >= 7 => Some(Self::Key {
                key_code: u16::from_be_bytes([p[0], p[1]]),
                down: p[2] != 0,
                flags: u32::from_be_bytes(p[3..7].try_into().ok()?),
            }),
            0x06 => std::str::from_utf8(p)
                .ok()
                .filter(|t| !t.is_empty())
                .map(|t| Self::Text(t.to_string())),
            _ => None,
        }
    }

    /// The record with its `u16` length prefix, ready for the input stream.
    pub fn encode(&self) -> Vec<u8> {
        let mut body = Vec::with_capacity(16);
        match self {
            Self::Move { dx, dy } => {
                body.push(0x01);
                body.extend_from_slice(&dx.to_be_bytes());
                body.extend_from_slice(&dy.to_be_bytes());
            }
            Self::MoveTo { x, y } => {
                body.push(0x02);
                body.extend_from_slice(&x.to_be_bytes());
                body.extend_from_slice(&y.to_be_bytes());
            }
            Self::Button {
                button,
                down,
                clicks,
            } => {
                body.extend_from_slice(&[0x03, *button, u8::from(*down), *clicks]);
            }
            Self::Scroll { dx, dy, phase } => {
                body.push(0x04);
                body.extend_from_slice(&dx.to_be_bytes());
                body.extend_from_slice(&dy.to_be_bytes());
                body.push(*phase);
            }
            Self::Key {
                key_code,
                down,
                flags,
            } => {
                body.push(0x05);
                body.extend_from_slice(&key_code.to_be_bytes());
                body.push(u8::from(*down));
                body.extend_from_slice(&flags.to_be_bytes());
            }
            Self::Text(text) => {
                body.push(0x06);
                let mut end = text.len().min(MAX_TEXT_BYTES);
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                body.extend_from_slice(&text.as_bytes()[..end]);
            }
        }
        let mut out = Vec::with_capacity(2 + body.len());
        out.extend_from_slice(&(body.len() as u16).to_be_bytes());
        out.extend_from_slice(&body);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_the_same_bytes_as_the_phone() {
        assert_eq!(
            InputRecord::Move { dx: 1.0, dy: -2.0 }.encode(),
            [0, 9, 0x01, 0x3f, 0x80, 0, 0, 0xc0, 0, 0, 0]
        );
        assert_eq!(
            InputRecord::Button {
                button: MOUSE_RIGHT,
                down: true,
                clicks: 2
            }
            .encode(),
            [0, 4, 0x03, 1, 1, 2]
        );
        assert_eq!(
            InputRecord::Key {
                key_code: 0x08,
                down: true,
                flags: FLAG_COMMAND
            }
            .encode(),
            [0, 8, 0x05, 0, 0x08, 1, 0, 0x10, 0, 0]
        );
        assert_eq!(
            InputRecord::Text("é".into()).encode(),
            [0, 3, 0x06, 0xc3, 0xa9]
        );
    }

    #[test]
    fn parses_what_it_encodes() {
        let records = [
            InputRecord::MoveTo { x: 0.25, y: 1.0 },
            InputRecord::Scroll {
                dx: 0.0,
                dy: 0.5,
                phase: SCROLL_CHANGED,
            },
            InputRecord::Key {
                key_code: 36,
                down: false,
                flags: FLAG_SHIFT | FLAG_OPTION,
            },
            InputRecord::Text("hi".into()),
        ];
        for r in records {
            assert_eq!(InputRecord::parse(&r.encode()[2..]), Some(r));
        }
    }

    #[test]
    fn rejects_short_or_unknown_records() {
        assert_eq!(InputRecord::parse(&[0x01, 0, 0]), None);
        assert_eq!(InputRecord::parse(&[0x09]), None);
        assert_eq!(InputRecord::parse(&[0x06]), None);
        assert_eq!(
            InputRecord::parse(&[0x03, 0, 1, 9]),
            Some(InputRecord::Button {
                button: 0,
                down: true,
                clicks: 3
            })
        );
    }

    #[test]
    fn cuts_long_text_on_a_character_boundary() {
        let text = format!("a{}", "é".repeat(600));
        let encoded = InputRecord::Text(text).encode();
        assert_eq!(u16::from_be_bytes([encoded[0], encoded[1]]), 1000);
    }
}
