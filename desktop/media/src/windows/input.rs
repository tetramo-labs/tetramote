//! SendInput on the streamed monitor. Absolute moves land inside the
//! monitor's rect on the virtual desktop, and the wire's points become
//! physical pixels by the monitor's DPI scale.

use std::mem::size_of;
use std::time::{Duration, Instant};

use tetra_core::input::{MOUSE_MIDDLE, MOUSE_RIGHT, SCROLL_ENDED};
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetDoubleClickTime, MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE,
    KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    MAPVK_VK_TO_VSC_EX, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE,
    MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL,
    MOUSEINPUT, MOUSE_EVENT_FLAGS, VIRTUAL_KEY, VK_RETURN, VK_TAB,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN,
};

use super::display;
use crate::host::{ClickTimer, KeyPresser};
use crate::keymap::{windows_extended, windows_virtual_key};
use crate::{DisplayInfo, InputInjector, InputRecord, MediaError, Result};

/// Wheel units (120 a notch) per point of finger travel: a notch scrolls
/// about three 16-point lines.
const WHEEL_UNITS_PER_POINT: f32 = 2.5;

pub struct Injector {
    rect: RECT,
    scale: f64,
    motion: (f64, f64),
    wheel: Wheel,
    keys: KeyPresser,
    clicks: ClickTimer,
    buttons: [bool; 3],
}

impl Injector {
    pub fn new() -> Result<Self> {
        let outputs = display::outputs()?;
        let main = outputs.iter().find(|o| o.info.main).or(outputs.first());
        let (rect, scale) = main.map_or(
            (
                RECT {
                    left: 0,
                    top: 0,
                    right: 1,
                    bottom: 1,
                },
                1.0,
            ),
            |o| (o.rect, scale_of(&o.info)),
        );
        Ok(Self {
            rect,
            scale,
            motion: (0.0, 0.0),
            wheel: Wheel::default(),
            keys: KeyPresser::default(),
            clicks: ClickTimer::new(Duration::from_millis(unsafe { GetDoubleClickTime() } as u64)),
            buttons: [false; 3],
        })
    }

    fn cursor(&self) -> (i32, i32) {
        let mut point = POINT::default();
        match unsafe { GetCursorPos(&mut point) } {
            Ok(()) => (point.x, point.y),
            Err(_) => (
                (self.rect.left + self.rect.right) / 2,
                (self.rect.top + self.rect.bottom) / 2,
            ),
        }
    }

    fn clamp(&self, x: i32, y: i32) -> (i32, i32) {
        (
            x.clamp(self.rect.left, (self.rect.right - 1).max(self.rect.left)),
            y.clamp(self.rect.top, (self.rect.bottom - 1).max(self.rect.top)),
        )
    }

    fn button(&mut self, button: u8, down: bool, clicks: u8) -> Vec<INPUT> {
        let (press, release) = match button {
            MOUSE_RIGHT => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
            MOUSE_MIDDLE => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
            _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        };
        self.buttons[button.min(2) as usize] = down;
        if !down {
            return vec![mouse(0, 0, 0, release)];
        }
        let extra = self.clicks.extra_clicks(button, clicks, Instant::now());
        let mut inputs = Vec::new();
        for _ in 0..extra {
            inputs.push(mouse(0, 0, 0, press));
            inputs.push(mouse(0, 0, 0, release));
        }
        inputs.push(mouse(0, 0, 0, press));
        inputs
    }
}

impl InputInjector for Injector {
    fn set_display(&mut self, display: &DisplayInfo) {
        if let Some(output) = display::outputs()
            .ok()
            .and_then(|outputs| outputs.into_iter().find(|o| o.info.id == display.id))
        {
            self.rect = output.rect;
        }
        self.scale = scale_of(display);
    }

    fn handle(&mut self, record: &InputRecord) -> Result<()> {
        let inputs = match record {
            InputRecord::Move { dx, dy } => {
                let x = self.motion.0 + *dx as f64 * self.scale;
                let y = self.motion.1 + *dy as f64 * self.scale;
                self.motion = (x.fract(), y.fract());
                let (cx, cy) = self.cursor();
                let (tx, ty) = self.clamp(cx + x.trunc() as i32, cy + y.trunc() as i32);
                vec![move_to(tx, ty)]
            }
            InputRecord::MoveTo { x, y } => {
                let width = (self.rect.right - self.rect.left) as f32;
                let height = (self.rect.bottom - self.rect.top) as f32;
                let (tx, ty) = self.clamp(
                    self.rect.left + (x.clamp(0.0, 1.0) * width) as i32,
                    self.rect.top + (y.clamp(0.0, 1.0) * height) as i32,
                );
                vec![move_to(tx, ty)]
            }
            InputRecord::Button {
                button,
                down,
                clicks,
            } => self.button(*button, *down, *clicks),
            InputRecord::Scroll { dx, dy, phase } => {
                let (horizontal, vertical) = self.wheel.add(*dx, *dy);
                if *phase == SCROLL_ENDED {
                    self.wheel = Wheel::default();
                }
                let mut inputs = Vec::new();
                if vertical != 0 {
                    inputs.push(mouse(0, 0, vertical, MOUSEEVENTF_WHEEL));
                }
                if horizontal != 0 {
                    inputs.push(mouse(0, 0, horizontal, MOUSEEVENTF_HWHEEL));
                }
                inputs
            }
            InputRecord::Key {
                key_code,
                down,
                flags,
            } => self
                .keys
                .key(*key_code, *down, *flags)
                .into_iter()
                .filter_map(|(mac, down)| key(mac, down))
                .collect(),
            InputRecord::Text(text) => typing(text),
        };
        send(&inputs)
    }
}

impl Drop for Injector {
    fn drop(&mut self) {
        let mut inputs: Vec<INPUT> = self
            .keys
            .release_all()
            .into_iter()
            .filter_map(|(mac, down)| key(mac, down))
            .collect();
        for (button, held) in self.buttons.into_iter().enumerate() {
            if held {
                inputs.extend(self.button(button as u8, false, 1));
            }
        }
        let _ = send(&inputs);
    }
}

fn scale_of(display: &DisplayInfo) -> f64 {
    if display.point_width == 0 {
        1.0
    } else {
        display.width as f64 / display.point_width as f64
    }
}

/// Wheel units from finger travel, keeping the fraction for the next record.
/// Positive wire `dy` drags content down, which is a positive Windows wheel;
/// positive `dx` drags content right, which is a negative horizontal wheel.
#[derive(Default)]
struct Wheel {
    remainder: (f32, f32),
}

impl Wheel {
    fn add(&mut self, dx: f32, dy: f32) -> (i32, i32) {
        let x = self.remainder.0 - dx * WHEEL_UNITS_PER_POINT;
        let y = self.remainder.1 + dy * WHEEL_UNITS_PER_POINT;
        self.remainder = (x.fract(), y.fract());
        (x.trunc() as i32, y.trunc() as i32)
    }
}

/// A pixel offset into SendInput's 0..=65535 virtual-desk range, aimed at
/// the pixel's centre so rounding either way lands on it.
fn normalize(offset: i32, extent: i32) -> i32 {
    (((2 * offset as i64 + 1) * 65_536) / (2 * extent.max(1) as i64)).clamp(0, 65_535) as i32
}

fn move_to(x: i32, y: i32) -> INPUT {
    let (left, top) = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
        )
    };
    let (width, height) = unsafe {
        (
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    };
    mouse(
        normalize(x - left, width),
        normalize(y - top, height),
        0,
        MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
    )
}

pub(super) fn wake_display() {
    let _ = send(&[
        mouse(1, 0, 0, MOUSEEVENTF_MOVE),
        mouse(-1, 0, 0, MOUSEEVENTF_MOVE),
    ]);
}

fn mouse(dx: i32, dy: i32, data: i32, flags: MOUSE_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: data as u32,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn keyboard(vk: u16, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn key(mac: u16, down: bool) -> Option<INPUT> {
    let vk = windows_virtual_key(mac)?;
    let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC_EX) };
    let mut flags = if down {
        KEYBD_EVENT_FLAGS(0)
    } else {
        KEYEVENTF_KEYUP
    };
    if windows_extended(mac) || scan & 0xff00 == 0xe000 {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    Some(keyboard(vk, (scan & 0xff) as u16, flags))
}

fn typing(text: &str) -> Vec<INPUT> {
    let mut inputs = Vec::new();
    for c in text.chars() {
        let named = match c {
            '\n' | '\r' => Some(VK_RETURN),
            '\t' => Some(VK_TAB),
            _ => None,
        };
        if let Some(vk) = named {
            inputs.push(keyboard(vk.0, 0, KEYBD_EVENT_FLAGS(0)));
            inputs.push(keyboard(vk.0, 0, KEYEVENTF_KEYUP));
            continue;
        }
        let mut units = [0u16; 2];
        for &unit in c.encode_utf16(&mut units).iter() {
            inputs.push(keyboard(0, unit, KEYEVENTF_UNICODE));
            inputs.push(keyboard(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
        }
    }
    inputs
}

fn send(inputs: &[INPUT]) -> Result<()> {
    if inputs.is_empty() {
        return Ok(());
    }
    let sent = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        return Ok(());
    }
    Err(MediaError::PermissionDenied(
        "Windows blocked the input, which happens while an app running as administrator or the lock screen has focus. Run Tetramote as administrator to control those, or switch to another window.".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cursor_settles_at(injector: &Injector, target: (i32, i32)) -> (i32, i32) {
        let started = Instant::now();
        while injector.cursor() != target && started.elapsed() < Duration::from_millis(500) {
            std::thread::sleep(Duration::from_millis(10));
        }
        injector.cursor()
    }

    /// Moves the real cursor, so it runs only where `CI` is set.
    #[test]
    fn moves_the_cursor_within_the_streamed_display() {
        if std::env::var_os("CI").is_none() {
            return;
        }
        let outputs = display::outputs().unwrap();
        let Some(main) = outputs.iter().find(|o| o.info.main) else {
            return;
        };
        let mut injector = Injector::new().unwrap();
        injector.set_display(&main.info);
        injector
            .handle(&InputRecord::MoveTo { x: 0.25, y: 0.75 })
            .unwrap();
        let rect = main.rect;
        let quarter = (
            rect.left + (rect.right - rect.left) / 4,
            rect.top + (rect.bottom - rect.top) * 3 / 4,
        );
        assert_eq!(cursor_settles_at(&injector, quarter), quarter);
        let scale = scale_of(&main.info);
        injector
            .handle(&InputRecord::Move { dx: 10.0, dy: -4.0 })
            .unwrap();
        let moved = (
            quarter.0 + (10.0 * scale) as i32,
            quarter.1 - (4.0 * scale) as i32,
        );
        assert_eq!(cursor_settles_at(&injector, moved), moved);
        injector
            .handle(&InputRecord::MoveTo { x: 1.0, y: 1.0 })
            .unwrap();
        let corner = (rect.right - 1, rect.bottom - 1);
        assert_eq!(cursor_settles_at(&injector, corner), corner);
    }

    #[test]
    fn normalizes_to_pixel_centres() {
        assert_eq!(normalize(0, 1920), 17);
        assert_eq!(normalize(960, 1920), 32_785);
        assert_eq!(normalize(1919, 1920), 65_518);
        assert_eq!(normalize(-5, 1920), 0);
        assert_eq!(normalize(4000, 1920), 65_535);
    }

    #[test]
    fn turns_finger_travel_into_wheel_units() {
        let mut wheel = Wheel::default();
        assert_eq!(wheel.add(0.0, 48.0), (0, 120));
        assert_eq!(wheel.add(0.0, 0.3), (0, 0));
        assert_eq!(wheel.add(0.0, 0.3), (0, 1));
        assert_eq!(wheel.add(10.0, -2.0), (-25, -4));
    }

    #[test]
    fn types_text_as_unicode_and_named_keys() {
        let inputs = typing("a\n😀");
        assert_eq!(inputs.len(), 8);
        let scans: Vec<(u16, u16, u32)> = inputs
            .iter()
            .map(|i| unsafe {
                (
                    i.Anonymous.ki.wVk.0,
                    i.Anonymous.ki.wScan,
                    i.Anonymous.ki.dwFlags.0,
                )
            })
            .collect();
        assert_eq!(
            scans,
            [
                (0, 0x61, 4),
                (0, 0x61, 6),
                (0x0d, 0, 0),
                (0x0d, 0, 2),
                (0, 0xd83d, 4),
                (0, 0xd83d, 6),
                (0, 0xde00, 4),
                (0, 0xde00, 6),
            ]
        );
    }
}
