//! Input through the RemoteDesktop portal. Every event is a D-Bus round
//! trip, so one worker thread posts them in order while `handle` returns at
//! once. Absolute motion is in the shared screen's logical pixels.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use ashpd::desktop::remote_desktop::{KeyState, RemoteDesktop};
use tetra_core::input::{MOUSE_MIDDLE, MOUSE_RIGHT, SCROLL_ENDED};

use super::portal::{runtime, Portal, PortalSession, Screen};
use crate::host::{ClickTimer, KeyPresser};
use crate::keymap::linux_evdev;
use crate::{DisplayInfo, InputInjector, InputRecord, MediaError, Result};

const BTN_LEFT: i32 = 0x110;
const BTN_RIGHT: i32 = 0x111;
const BTN_MIDDLE: i32 = 0x112;

/// GTK's default; the portal doesn't say what the desktop uses.
const DOUBLE_CLICK: Duration = Duration::from_millis(400);

#[derive(Debug, Clone, Copy, PartialEq)]
enum Action {
    Motion(f64, f64),
    MotionTo(u32, f64, f64),
    Button(i32, bool),
    Axis(f64, f64, bool),
    Key(i32, bool),
    Keysym(i32, bool),
}

pub struct Injector {
    portal: Arc<Portal>,
    screen: Option<Screen>,
    actions: Option<mpsc::Sender<Action>>,
    worker: Option<JoinHandle<()>>,
    failed: Arc<AtomicBool>,
    keys: KeyPresser,
    clicks: ClickTimer,
    buttons: [bool; 3],
}

impl Injector {
    pub fn new() -> Result<Self> {
        let portal = Portal::shared()?;
        let (tx, rx) = mpsc::channel();
        let failed = Arc::new(AtomicBool::new(false));
        let worker = {
            let portal = portal.clone();
            let failed = failed.clone();
            std::thread::Builder::new()
                .name("tetra-portal-input".into())
                .spawn(move || post_all(&portal, rx, &failed))
                .map_err(|e| {
                    MediaError::Failed(format!(
                        "The input thread didn't start: {e}. Reconnect to try again."
                    ))
                })?
        };
        Ok(Self {
            screen: portal.screen(None),
            portal,
            actions: Some(tx),
            worker: Some(worker),
            failed,
            keys: KeyPresser::default(),
            clicks: ClickTimer::new(DOUBLE_CLICK),
            buttons: [false; 3],
        })
    }

    fn actions(&mut self, record: &InputRecord) -> Vec<Action> {
        match record {
            InputRecord::Move { dx, dy } => vec![Action::Motion(*dx as f64, *dy as f64)],
            InputRecord::MoveTo { x, y } => match self.screen {
                Some(screen) => {
                    let (width, height) = self.logical_size(&screen);
                    vec![Action::MotionTo(
                        screen.node_id,
                        (x.clamp(0.0, 1.0) as f64 * width).clamp(0.0, width - 1.0),
                        (y.clamp(0.0, 1.0) as f64 * height).clamp(0.0, height - 1.0),
                    )]
                }
                None => Vec::new(),
            },
            InputRecord::Button {
                button,
                down,
                clicks,
            } => {
                let code = match *button {
                    MOUSE_RIGHT => BTN_RIGHT,
                    MOUSE_MIDDLE => BTN_MIDDLE,
                    _ => BTN_LEFT,
                };
                self.buttons[(*button).min(2) as usize] = *down;
                if !*down {
                    return vec![Action::Button(code, false)];
                }
                let extra = self.clicks.extra_clicks(*button, *clicks, Instant::now());
                let mut actions = Vec::new();
                for _ in 0..extra {
                    actions.push(Action::Button(code, true));
                    actions.push(Action::Button(code, false));
                }
                actions.push(Action::Button(code, true));
                actions
            }
            InputRecord::Scroll { dx, dy, phase } => {
                let ended = *phase == SCROLL_ENDED;
                if *dx == 0.0 && *dy == 0.0 && !ended {
                    return Vec::new();
                }
                vec![Action::Axis(-*dx as f64, -*dy as f64, ended)]
            }
            InputRecord::Key {
                key_code,
                down,
                flags,
            } => self
                .keys
                .key(*key_code, *down, *flags)
                .into_iter()
                .filter_map(|(mac, down)| {
                    linux_evdev(mac).map(|code| Action::Key(code as i32, down))
                })
                .collect(),
            InputRecord::Text(text) => text
                .chars()
                .flat_map(|c| {
                    [
                        Action::Keysym(keysym(c), true),
                        Action::Keysym(keysym(c), false),
                    ]
                })
                .collect(),
        }
    }

    fn logical_size(&self, screen: &Screen) -> (f64, f64) {
        if screen.size.0 > 0 && screen.size.1 > 0 {
            return (screen.size.0 as f64, screen.size.1 as f64);
        }
        let display = self.portal.display(screen);
        (
            display.point_width.max(1) as f64,
            display.point_height.max(1) as f64,
        )
    }

    fn post(&self, actions: Vec<Action>) -> Result<()> {
        if self.failed.load(Ordering::Relaxed) || self.portal.is_closed() {
            return Err(MediaError::Failed(
                "The remote desktop session ended on this computer. Reconnect to control it again."
                    .into(),
            ));
        }
        let Some(tx) = &self.actions else {
            return Ok(());
        };
        for action in actions {
            let _ = tx.send(action);
        }
        Ok(())
    }
}

impl InputInjector for Injector {
    fn set_display(&mut self, display: &DisplayInfo) {
        self.screen = self.portal.screen(Some(display.id));
    }

    fn handle(&mut self, record: &InputRecord) -> Result<()> {
        let actions = self.actions(record);
        self.post(actions)
    }
}

impl Drop for Injector {
    fn drop(&mut self) {
        let mut actions: Vec<Action> = self
            .keys
            .release_all()
            .into_iter()
            .filter_map(|(mac, down)| linux_evdev(mac).map(|code| Action::Key(code as i32, down)))
            .collect();
        for (code, held) in [BTN_LEFT, BTN_RIGHT, BTN_MIDDLE]
            .into_iter()
            .zip(self.buttons)
        {
            if held {
                actions.push(Action::Button(code, false));
            }
        }
        let _ = self.post(actions);
        self.actions = None;
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn post_all(portal: &Portal, actions: mpsc::Receiver<Action>, failed: &AtomicBool) {
    let Ok(runtime) = runtime() else {
        failed.store(true, Ordering::Relaxed);
        return;
    };
    while let Ok(action) = actions.recv() {
        if let Err(e) = runtime.block_on(post(&portal.remote, &portal.session, action)) {
            log::warn!("the remote desktop portal refused input: {e}");
            failed.store(true, Ordering::Relaxed);
            portal.close();
            return;
        }
    }
}

async fn post(
    remote: &RemoteDesktop<'static>,
    session: &PortalSession,
    action: Action,
) -> ashpd::Result<()> {
    let state = |down: bool| {
        if down {
            KeyState::Pressed
        } else {
            KeyState::Released
        }
    };
    match action {
        Action::Motion(dx, dy) => remote.notify_pointer_motion(session, dx, dy).await,
        Action::MotionTo(node, x, y) => {
            remote
                .notify_pointer_motion_absolute(session, node, x, y)
                .await
        }
        Action::Button(code, down) => {
            remote
                .notify_pointer_button(session, code, state(down))
                .await
        }
        Action::Axis(dx, dy, finish) => remote.notify_pointer_axis(session, dx, dy, finish).await,
        Action::Key(code, down) => {
            remote
                .notify_keyboard_keycode(session, code, state(down))
                .await
        }
        Action::Keysym(sym, down) => {
            remote
                .notify_keyboard_keysym(session, sym, state(down))
                .await
        }
    }
}

/// The X keysym for a typed character: named keys for line breaks and tabs,
/// Latin-1 as itself, everything else in the Unicode keysym range.
fn keysym(c: char) -> i32 {
    match c {
        '\n' | '\r' => 0xff0d,
        '\t' => 0xff09,
        '\u{20}'..='\u{7e}' | '\u{a0}'..='\u{ff}' => c as i32,
        _ => 0x0100_0000 | c as i32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_characters_to_keysyms() {
        assert_eq!(keysym('a'), 0x61);
        assert_eq!(keysym('é'), 0xe9);
        assert_eq!(keysym('€'), 0x0100_20ac);
        assert_eq!(keysym('\n'), 0xff0d);
        assert_eq!(keysym('\t'), 0xff09);
    }
}
