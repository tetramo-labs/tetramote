//! One table for every key the desktop app sends or posts: the DOM
//! `KeyboardEvent.code` the viewer sees, the macOS virtual key code the wire
//! carries, and what a Windows (virtual-key) or Linux (evdev) host posts.

struct Key {
    dom: &'static str,
    mac: u16,
    windows: u16,
    linux: u16,
}

const fn k(dom: &'static str, mac: u16, windows: u16, linux: u16) -> Key {
    Key { dom, mac, windows, linux }
}

const KEYS: &[Key] = &[
    k("KeyA", 0x00, 0x41, 30),
    k("KeyS", 0x01, 0x53, 31),
    k("KeyD", 0x02, 0x44, 32),
    k("KeyF", 0x03, 0x46, 33),
    k("KeyH", 0x04, 0x48, 35),
    k("KeyG", 0x05, 0x47, 34),
    k("KeyZ", 0x06, 0x5a, 44),
    k("KeyX", 0x07, 0x58, 45),
    k("KeyC", 0x08, 0x43, 46),
    k("KeyV", 0x09, 0x56, 47),
    k("IntlBackslash", 0x0a, 0xe2, 86),
    k("KeyB", 0x0b, 0x42, 48),
    k("KeyQ", 0x0c, 0x51, 16),
    k("KeyW", 0x0d, 0x57, 17),
    k("KeyE", 0x0e, 0x45, 18),
    k("KeyR", 0x0f, 0x52, 19),
    k("KeyY", 0x10, 0x59, 21),
    k("KeyT", 0x11, 0x54, 20),
    k("Digit1", 0x12, 0x31, 2),
    k("Digit2", 0x13, 0x32, 3),
    k("Digit3", 0x14, 0x33, 4),
    k("Digit4", 0x15, 0x34, 5),
    k("Digit6", 0x16, 0x36, 7),
    k("Digit5", 0x17, 0x35, 6),
    k("Equal", 0x18, 0xbb, 13),
    k("Digit9", 0x19, 0x39, 10),
    k("Digit7", 0x1a, 0x37, 8),
    k("Minus", 0x1b, 0xbd, 12),
    k("Digit8", 0x1c, 0x38, 9),
    k("Digit0", 0x1d, 0x30, 11),
    k("BracketRight", 0x1e, 0xdd, 27),
    k("KeyO", 0x1f, 0x4f, 24),
    k("KeyU", 0x20, 0x55, 22),
    k("BracketLeft", 0x21, 0xdb, 26),
    k("KeyI", 0x22, 0x49, 23),
    k("KeyP", 0x23, 0x50, 25),
    k("Enter", 0x24, 0x0d, 28),
    k("KeyL", 0x25, 0x4c, 38),
    k("KeyJ", 0x26, 0x4a, 36),
    k("Quote", 0x27, 0xde, 40),
    k("KeyK", 0x28, 0x4b, 37),
    k("Semicolon", 0x29, 0xba, 39),
    k("Backslash", 0x2a, 0xdc, 43),
    k("Comma", 0x2b, 0xbc, 51),
    k("Slash", 0x2c, 0xbf, 53),
    k("KeyN", 0x2d, 0x4e, 49),
    k("KeyM", 0x2e, 0x4d, 50),
    k("Period", 0x2f, 0xbe, 52),
    k("Tab", 0x30, 0x09, 15),
    k("Space", 0x31, 0x20, 57),
    k("Backquote", 0x32, 0xc0, 41),
    k("Backspace", 0x33, 0x08, 14),
    k("Escape", 0x35, 0x1b, 1),
    k("MetaRight", 0x36, 0x5c, 126),
    k("MetaLeft", 0x37, 0x5b, 125),
    k("ShiftLeft", 0x38, 0xa0, 42),
    k("CapsLock", 0x39, 0x14, 58),
    k("AltLeft", 0x3a, 0xa4, 56),
    k("ControlLeft", 0x3b, 0xa2, 29),
    k("ShiftRight", 0x3c, 0xa1, 54),
    k("AltRight", 0x3d, 0xa5, 100),
    k("ControlRight", 0x3e, 0xa3, 97),
    k("F17", 0x40, 0x80, 187),
    k("NumpadDecimal", 0x41, 0x6e, 83),
    k("NumpadMultiply", 0x43, 0x6a, 55),
    k("NumpadAdd", 0x45, 0x6b, 78),
    k("NumLock", 0x47, 0x90, 69),
    k("AudioVolumeUp", 0x48, 0xaf, 115),
    k("AudioVolumeDown", 0x49, 0xae, 114),
    k("AudioVolumeMute", 0x4a, 0xad, 113),
    k("NumpadDivide", 0x4b, 0x6f, 98),
    k("NumpadEnter", 0x4c, 0x0d, 96),
    k("NumpadSubtract", 0x4e, 0x6d, 74),
    k("F18", 0x4f, 0x81, 188),
    k("F19", 0x50, 0x82, 189),
    k("NumpadEqual", 0x51, 0x92, 117),
    k("Numpad0", 0x52, 0x60, 82),
    k("Numpad1", 0x53, 0x61, 79),
    k("Numpad2", 0x54, 0x62, 80),
    k("Numpad3", 0x55, 0x63, 81),
    k("Numpad4", 0x56, 0x64, 75),
    k("Numpad5", 0x57, 0x65, 76),
    k("Numpad6", 0x58, 0x66, 77),
    k("Numpad7", 0x59, 0x67, 71),
    k("F20", 0x5a, 0x83, 190),
    k("Numpad8", 0x5b, 0x68, 72),
    k("Numpad9", 0x5c, 0x69, 73),
    k("F5", 0x60, 0x74, 63),
    k("F6", 0x61, 0x75, 64),
    k("F7", 0x62, 0x76, 65),
    k("F3", 0x63, 0x72, 61),
    k("F8", 0x64, 0x77, 66),
    k("F9", 0x65, 0x78, 67),
    k("F11", 0x67, 0x7a, 87),
    k("F13", 0x69, 0x7c, 183),
    k("F16", 0x6a, 0x7f, 186),
    k("F14", 0x6b, 0x7d, 184),
    k("F10", 0x6d, 0x79, 68),
    k("ContextMenu", 0x6e, 0x5d, 127),
    k("F12", 0x6f, 0x7b, 88),
    k("F15", 0x71, 0x7e, 185),
    k("Insert", 0x72, 0x2d, 110),
    k("Home", 0x73, 0x24, 102),
    k("PageUp", 0x74, 0x21, 104),
    k("Delete", 0x75, 0x2e, 111),
    k("F4", 0x76, 0x73, 62),
    k("End", 0x77, 0x23, 107),
    k("F2", 0x78, 0x71, 60),
    k("PageDown", 0x79, 0x22, 109),
    k("F1", 0x7a, 0x70, 59),
    k("ArrowLeft", 0x7b, 0x25, 105),
    k("ArrowRight", 0x7c, 0x27, 106),
    k("ArrowDown", 0x7d, 0x28, 108),
    k("ArrowUp", 0x7e, 0x26, 103),
];

pub fn mac_key_code(dom_code: &str) -> Option<u16> {
    KEYS.iter().find(|k| k.dom == dom_code).map(|k| k.mac)
}

pub fn windows_virtual_key(mac: u16) -> Option<u16> {
    KEYS.iter().find(|k| k.mac == mac).map(|k| k.windows)
}

pub fn linux_evdev(mac: u16) -> Option<u16> {
    KEYS.iter().find(|k| k.mac == mac).map(|k| k.linux)
}

/// Keys the Windows SendInput API needs flagged as extended.
pub fn windows_extended(mac: u16) -> bool {
    matches!(
        mac,
        0x36 | 0x37 | 0x3d | 0x3e | 0x4b | 0x4c | 0x6e | 0x72 | 0x73 | 0x74 | 0x75 | 0x77 | 0x79 | 0x7b..=0x7e
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_dom_codes_to_mac_key_codes() {
        assert_eq!(mac_key_code("KeyA"), Some(0x00));
        assert_eq!(mac_key_code("KeyC"), Some(0x08));
        assert_eq!(mac_key_code("Enter"), Some(0x24));
        assert_eq!(mac_key_code("ArrowUp"), Some(0x7e));
        assert_eq!(mac_key_code("MetaLeft"), Some(0x37));
        assert_eq!(mac_key_code("Unidentified"), None);
    }

    #[test]
    fn maps_mac_key_codes_to_other_hosts() {
        assert_eq!(windows_virtual_key(0x08), Some(0x43));
        assert_eq!(linux_evdev(0x08), Some(46));
        assert_eq!(windows_virtual_key(0x33), Some(0x08));
        assert_eq!(linux_evdev(0x24), Some(28));
        assert!(windows_extended(0x7b));
        assert!(!windows_extended(0x00));
    }

    #[test]
    fn has_no_duplicate_dom_or_mac_codes() {
        for (i, a) in KEYS.iter().enumerate() {
            for b in &KEYS[i + 1..] {
                assert_ne!(a.dom, b.dom);
                assert_ne!(a.mac, b.mac, "{} and {}", a.dom, b.dom);
            }
        }
    }
}
