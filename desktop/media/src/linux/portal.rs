//! One shared portal session for capture and input: absolute pointer motion
//! names a screencast stream, so both must come from the same session. It
//! stays open while a stream or an injector holds it. Portal calls run on a
//! private tokio runtime because zbus needs one, whatever the caller runs on.

use std::collections::HashMap;
use std::future::Future;
use std::os::fd::OwnedFd;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock, Weak};

use ashpd::desktop::remote_desktop::{DeviceType, RemoteDesktop};
use ashpd::desktop::screencast::{CursorMode, Screencast, SourceType};
use ashpd::desktop::{PersistMode, ResponseError, Session};
use tokio::runtime::Runtime;

use crate::{DisplayInfo, MediaError, Result};

pub type PortalSession = Session<'static, RemoteDesktop<'static>>;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Screen {
    pub node_id: u32,
    pub size: (i32, i32),
}

pub struct Portal {
    pub remote: Arc<RemoteDesktop<'static>>,
    pub session: Arc<PortalSession>,
    pub screens: Vec<Screen>,
    pixel_sizes: Mutex<HashMap<u32, (u32, u32)>>,
    closed: AtomicBool,
}

static CURRENT: Mutex<Weak<Portal>> = Mutex::new(Weak::new());
static OPENING: Mutex<()> = Mutex::new(());

impl Portal {
    /// The live session, or a new one; a new one shows the portal's dialog
    /// and blocks until the user answers it.
    pub fn shared() -> Result<Arc<Portal>> {
        let _opening = OPENING.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(portal) = Self::current() {
            return Ok(portal);
        }
        let portal = Arc::new(open()?);
        *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = Arc::downgrade(&portal);
        Ok(portal)
    }

    pub fn current() -> Option<Arc<Portal>> {
        CURRENT
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .upgrade()
            .filter(|p| !p.closed.load(Ordering::Relaxed))
    }

    /// Marks the session ended (the user stopped sharing), so the next
    /// stream or injector asks for a new one.
    pub fn close(&self) {
        self.closed.store(true, Ordering::Relaxed);
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Relaxed)
    }

    pub fn screen(&self, display_id: Option<u64>) -> Option<Screen> {
        display_id
            .and_then(|id| self.screens.iter().find(|s| s.node_id as u64 == id))
            .or(self.screens.first())
            .copied()
    }

    pub fn set_pixel_size(&self, node_id: u32, size: (u32, u32)) {
        self.pixel_sizes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(node_id, size);
    }

    pub fn display(&self, screen: &Screen) -> DisplayInfo {
        let index = self.screens.iter().position(|s| s == screen).unwrap_or(0);
        let pixels = self
            .pixel_sizes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&screen.node_id)
            .copied();
        display_info(screen, index, pixels)
    }

    pub fn pipewire_fd(&self) -> Result<OwnedFd> {
        let session = self.session.clone();
        run(async move { Screencast::new().await?.open_pipe_wire_remote(session.as_ref()).await })?.map_err(|e| {
            MediaError::Failed(format!(
                "Opening the screen share's PipeWire connection failed: {e}. Reconnect to try again."
            ))
        })
    }
}

impl Drop for Portal {
    fn drop(&mut self) {
        let session = self.session.clone();
        if let Ok(runtime) = runtime() {
            runtime.spawn(async move {
                let _ = session.close().await;
            });
        }
    }
}

pub fn displays() -> Vec<DisplayInfo> {
    match Portal::current() {
        Some(portal) => portal.screens.iter().map(|s| portal.display(s)).collect(),
        None => vec![DisplayInfo {
            id: 0,
            name: "Entire screen".into(),
            width: 0,
            height: 0,
            point_width: 0,
            point_height: 0,
            main: true,
        }],
    }
}

fn display_info(screen: &Screen, index: usize, pixels: Option<(u32, u32)>) -> DisplayInfo {
    let points = (screen.size.0.max(0) as u32, screen.size.1.max(0) as u32);
    let pixels = pixels.unwrap_or(points);
    let points = if points.0 == 0 { pixels } else { points };
    DisplayInfo {
        id: screen.node_id as u64,
        name: format!("Screen {}", index + 1),
        width: pixels.0,
        height: pixels.1,
        point_width: points.0,
        point_height: points.1,
        main: index == 0,
    }
}

pub fn runtime() -> Result<&'static Runtime> {
    static RUNTIME: OnceLock<std::io::Result<Runtime>> = OnceLock::new();
    RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(1)
                .thread_name("tetra-portal")
                .enable_all()
                .build()
        })
        .as_ref()
        .map_err(|e| {
            MediaError::Failed(format!(
                "The desktop portal runtime didn't start: {e}. Restart Tetramote."
            ))
        })
}

/// Runs `future` on the portal runtime and waits for it from any thread,
/// including one that is itself inside a tokio runtime.
pub fn run<F, T>(future: F) -> Result<T>
where
    F: Future<Output = T> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    runtime()?.spawn(async move {
        let _ = tx.send(future.await);
    });
    rx.recv().map_err(|_| {
        MediaError::Failed("A desktop portal call was dropped. Reconnect to try again.".into())
    })
}

fn open() -> Result<Portal> {
    let token = restore_token();
    let opened = run(async move {
        let remote = RemoteDesktop::new().await?;
        let screencast = Screencast::new().await?;
        let session = remote.create_session().await?;
        remote
            .select_devices(
                &session,
                DeviceType::Keyboard | DeviceType::Pointer,
                token.as_deref(),
                PersistMode::ExplicitlyRevoked,
            )
            .await?
            .response()?;
        screencast
            .select_sources(
                &session,
                CursorMode::Embedded,
                SourceType::Monitor.into(),
                false,
                None,
                PersistMode::DoNot,
            )
            .await?
            .response()?;
        let selected = remote.start(&session, None).await?.response()?;
        Ok::<_, ashpd::Error>((remote, session, selected))
    })?;
    let (remote, session, selected) = opened.map_err(|e| match e {
        ashpd::Error::Response(ResponseError::Cancelled) => MediaError::PermissionDenied(
            "Sharing this computer was declined in the screen sharing dialog. Accept it on this computer's screen, then reconnect.".into(),
        ),
        other => MediaError::Unsupported(format!(
            "The desktop portal couldn't start screen sharing ({other}). Install xdg-desktop-portal with your desktop's backend (GNOME or KDE), log in to a Wayland or X11 desktop session, then reconnect."
        )),
    })?;
    if let Some(token) = selected.restore_token() {
        save_restore_token(token);
    }
    let screens: Vec<Screen> = selected
        .streams()
        .unwrap_or_default()
        .iter()
        .map(|s| Screen {
            node_id: s.pipe_wire_node_id(),
            size: s.size().unwrap_or((0, 0)),
        })
        .collect();
    if screens.is_empty() {
        return Err(MediaError::Unsupported(
            "The screen sharing dialog closed without a screen. Reconnect and pick a screen to share.".into(),
        ));
    }
    Ok(Portal {
        remote: Arc::new(remote),
        session: Arc::new(session),
        screens,
        pixel_sizes: Mutex::new(HashMap::new()),
        closed: AtomicBool::new(false),
    })
}

fn token_path() -> Option<PathBuf> {
    let state = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state"))
        })?;
    Some(state.join("tetramote").join("portal-restore-token"))
}

fn restore_token() -> Option<String> {
    let token = std::fs::read_to_string(token_path()?).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_string())
}

fn save_restore_token(token: &str) {
    let Some(path) = token_path() else { return };
    let saved = path
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| std::fs::write(&path, token));
    if let Err(e) = saved {
        log::warn!(
            "couldn't save the screen sharing grant to {}: {e}",
            path.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describes_screens_in_points_and_pixels() {
        let screen = Screen {
            node_id: 57,
            size: (1280, 800),
        };
        let display = display_info(&screen, 0, Some((2560, 1600)));
        assert_eq!(
            display,
            DisplayInfo {
                id: 57,
                name: "Screen 1".into(),
                width: 2560,
                height: 1600,
                point_width: 1280,
                point_height: 800,
                main: true,
            }
        );
        let unsized_screen = Screen {
            node_id: 9,
            size: (0, 0),
        };
        let display = display_info(&unsized_screen, 1, Some((1920, 1080)));
        assert_eq!(
            (display.point_width, display.point_height, display.main),
            (1920, 1080, false)
        );
    }

    #[test]
    fn lists_one_unsized_screen_before_a_session() {
        let listed = displays();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Entire screen");
        assert_eq!((listed[0].id, listed[0].width), (0, 0));
    }
}
