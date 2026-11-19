use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tetra_core::protocol::{EVENT_AUDIO, EVENT_CONTROL, EVENT_STATE, EVENT_VIDEO};
use tetra_core::{Client, ConnectRequest, EndpointConfig, Events};
use tetra_media::playback::AudioPlayer;
use tetra_media::InputRecord;

use crate::store::{now_ms, SavedHost, Store};
use crate::{clipboard, pairing, system};

pub const VIEWER: &str = "viewer";
const AUDIO_HEADER: usize = 12;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ClientStatus {
    Idle,
    Connecting {
        name: String,
    },
    Connected {
        name: String,
        path: Option<String>,
        #[serde(rename = "rttMs")]
        rtt_ms: Option<u64>,
    },
    Failed {
        name: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientState {
    pub status: ClientStatus,
    pub hosts: Vec<SavedHost>,
    pub displays: Vec<Value>,
    pub active_display: Option<u64>,
    pub video: Option<Value>,
    pub remote_status: Option<Value>,
    pub play_audio: bool,
}

/// One input event from the viewer, in the viewer's terms.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ViewerInput {
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
    },
    Key {
        code: String,
        down: bool,
        flags: u32,
    },
}

impl ViewerInput {
    pub fn record(&self) -> Option<InputRecord> {
        Some(match self {
            Self::MoveTo { x, y } => InputRecord::MoveTo {
                x: x.clamp(0.0, 1.0),
                y: y.clamp(0.0, 1.0),
            },
            Self::Button {
                button,
                down,
                clicks,
            } => InputRecord::Button {
                button: *button,
                down: *down,
                clicks: (*clicks).clamp(1, 3),
            },
            Self::Scroll { dx, dy } => InputRecord::Scroll {
                dx: *dx,
                dy: *dy,
                phase: tetra_core::input::SCROLL_NONE,
            },
            Self::Key { code, down, flags } => InputRecord::Key {
                key_code: tetra_media::mac_key_code(code)?,
                down: *down,
                flags: *flags,
            },
        })
    }
}

struct Target {
    id: Option<String>,
    name: String,
    ticket: String,
    secret: Option<String>,
}

struct Inner {
    client: Option<Arc<Client>>,
    status: ClientStatus,
    target: Option<Target>,
    displays: Vec<Value>,
    active_display: Option<u64>,
    video: Option<Value>,
    remote_status: Option<Value>,
    frames: Option<Channel<InvokeResponseBody>>,
    audio: Option<AudioPlayer>,
}

/// Controls another computer from this one.
pub struct ClientService {
    app: AppHandle,
    store: Arc<Store>,
    own_endpoint: Box<dyn Fn() -> Option<String> + Send + Sync>,
    inner: Mutex<Inner>,
    clipboard: Mutex<clipboard::Watcher>,
}

impl ClientService {
    pub fn new(
        app: AppHandle,
        store: Arc<Store>,
        own_endpoint: impl Fn() -> Option<String> + Send + Sync + 'static,
    ) -> Arc<Self> {
        let this = Arc::new(Self {
            app,
            store,
            own_endpoint: Box::new(own_endpoint),
            inner: Mutex::new(Inner {
                client: None,
                status: ClientStatus::Idle,
                target: None,
                displays: Vec::new(),
                active_display: None,
                video: None,
                remote_status: None,
                frames: None,
                audio: None,
            }),
            clipboard: Mutex::new(clipboard::Watcher::new()),
        });
        let tick = this.clone();
        std::thread::Builder::new()
            .name("tetra-client-tick".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                tick.tick();
            })
            .expect("client tick thread");
        this
    }

    pub fn state(&self) -> ClientState {
        let inner = self.inner.lock().unwrap();
        let settings = self.store.get();
        ClientState {
            status: inner.status.clone(),
            hosts: settings.hosts,
            displays: inner.displays.clone(),
            active_display: inner.active_display,
            video: inner.video.clone(),
            remote_status: inner.remote_status.clone(),
            play_audio: settings.play_audio,
        }
    }

    fn emit(&self) {
        let _ = self.app.emit("client-state", self.state());
    }

    pub fn connect_link(self: &Arc<Self>, link: &str) -> Result<(), String> {
        let link = pairing::parse(link).ok_or(
            "That isn't a Tetratop link. Copy it again from Tetratop on the other computer.",
        )?;
        let id = tetra_core::net::parse_addr(Some(&link.ticket), "")
            .map_err(|_| "That link's address is damaged. Copy it again from the other computer.")?
            .id
            .to_string();
        if (self.own_endpoint)().as_deref() == Some(id.as_str()) {
            return Err("That's this computer's own link. Open it on the computer you want to control from.".into());
        }
        self.spawn_begin(Target {
            id: Some(id),
            name: link.name,
            ticket: link.ticket,
            secret: Some(link.secret),
        });
        Ok(())
    }

    pub fn connect_saved(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let host = self
            .store
            .get()
            .hosts
            .into_iter()
            .find(|h| h.id == id)
            .ok_or("That computer isn't paired anymore. Pair it again with its link.")?;
        self.spawn_begin(Target {
            id: Some(host.id),
            name: host.name,
            ticket: host.ticket,
            secret: None,
        });
        Ok(())
    }

    pub fn forget(&self, id: &str) {
        self.store.update(|s| s.hosts.retain(|h| h.id != id));
        self.emit();
    }

    pub fn disconnect(&self) {
        let client = {
            let mut inner = self.inner.lock().unwrap();
            inner.status = ClientStatus::Idle;
            inner.target = None;
            inner.audio = None;
            inner.frames = None;
            inner.displays.clear();
            inner.video = None;
            inner.client.clone()
        };
        if let Some(client) = client {
            client.disconnect();
        }
        if let Some(window) = self.app.get_webview_window(VIEWER) {
            let _ = window.close();
        }
        self.emit();
    }

    pub fn restart(&self) {
        self.disconnect();
        let old = self.inner.lock().unwrap().client.take();
        if let Some(client) = old {
            tetra_core::net::runtime().block_on(client.close());
        }
    }

    pub fn attach(&self, frames: Channel<InvokeResponseBody>) {
        self.inner.lock().unwrap().frames = Some(frames);
        self.send_control(&json!({"t": "keyframe"}));
    }

    pub fn input(&self, events: &[ViewerInput]) {
        let bytes: Vec<u8> = events
            .iter()
            .filter_map(ViewerInput::record)
            .flat_map(|r| r.encode())
            .collect();
        if bytes.is_empty() {
            return;
        }
        if let Some(client) = self.inner.lock().unwrap().client.clone() {
            client.send_input(&bytes);
        }
    }

    pub fn send_control(&self, message: &Value) {
        if let Some(client) = self.inner.lock().unwrap().client.clone() {
            client.send_control(message.to_string().as_bytes());
        }
    }

    pub fn set_audio(&self, enabled: bool) {
        self.store.update(|s| s.play_audio = enabled);
        {
            let mut inner = self.inner.lock().unwrap();
            if !enabled {
                inner.audio = None;
            }
        }
        self.send_control(&json!({"t": "setAudio", "enabled": enabled}));
        self.emit();
    }

    /// Binding the endpoint blocks and windows must not be created inside a
    /// synchronous command, so connecting always runs on its own thread.
    fn spawn_begin(self: &Arc<Self>, target: Target) {
        let this = self.clone();
        std::thread::spawn(move || {
            let name = target.name.clone();
            if let Err(message) = this.begin(target) {
                this.inner.lock().unwrap().status = ClientStatus::Failed { name, message };
                this.emit();
            }
        });
    }

    fn begin(self: &Arc<Self>, target: Target) -> Result<(), String> {
        let client = self.ensure_client()?;
        let request = ConnectRequest {
            ticket: Some(target.ticket.clone()),
            endpoint_id: target.id.clone().unwrap_or_default(),
            pairing_secret: target.secret.clone(),
            device_name: system::computer_name(),
            timeout_ms: 15_000,
        };
        {
            let mut inner = self.inner.lock().unwrap();
            inner.status = ClientStatus::Connecting {
                name: target.name.clone(),
            };
            inner.target = Some(target);
            inner.displays.clear();
            inner.video = None;
            inner.remote_status = None;
        }
        self.open_viewer();
        {
            let _guard = tetra_core::net::runtime().enter();
            client.connect(request);
        }
        self.emit();
        Ok(())
    }

    fn ensure_client(self: &Arc<Self>) -> Result<Arc<Client>, String> {
        if let Some(client) = self.inner.lock().unwrap().client.clone() {
            return Ok(client);
        }
        let key = self.store.client_key()?;
        let relay = self.store.get().relay_url;
        let (events, rx) = Events::channel();
        let config = EndpointConfig {
            secret_key: key,
            relay_url: Some(relay).filter(|r| !r.trim().is_empty()),
            local_only: false,
        };
        let client = Arc::new(
            tetra_core::net::runtime()
                .block_on(Client::start(config, events))
                .map_err(|e| format!("Connecting couldn't start: {e}"))?,
        );
        self.inner.lock().unwrap().client = Some(client.clone());
        let this = self.clone();
        std::thread::Builder::new()
            .name("tetra-client".into())
            .spawn(move || this.pump(rx))
            .map_err(|e| format!("Connecting couldn't start: {e}"))?;
        Ok(client)
    }

    fn open_viewer(&self) {
        let title = match &self.inner.lock().unwrap().target {
            Some(t) => format!("{} — Tetratop", t.name),
            None => "Tetratop".into(),
        };
        if let Some(window) = self.app.get_webview_window(VIEWER) {
            let _ = window.set_title(&title);
            let _ = window.show();
            let _ = window.set_focus();
            return;
        }
        let built =
            WebviewWindowBuilder::new(&self.app, VIEWER, WebviewUrl::App("viewer.html".into()))
                .title(title)
                .inner_size(1280.0, 840.0)
                .min_inner_size(480.0, 320.0)
                .resizable(true)
                .focused(true)
                .build();
        if let Err(e) = built {
            log::warn!("viewer window failed to open: {e}");
        }
    }

    fn pump(self: Arc<Self>, rx: mpsc::Receiver<Vec<u8>>) {
        while let Ok(event) = rx.recv() {
            let Some((&kind, body)) = event.split_first() else {
                continue;
            };
            match kind {
                EVENT_STATE => {
                    if let Ok(v) = serde_json::from_slice::<Value>(body) {
                        self.on_state(&v);
                    }
                }
                EVENT_CONTROL => {
                    if let Ok(v) = serde_json::from_slice::<Value>(body) {
                        self.on_control(&v);
                    }
                }
                EVENT_VIDEO => {
                    let frames = self.inner.lock().unwrap().frames.clone();
                    if let Some(frames) = frames {
                        let _ = frames.send(InvokeResponseBody::Raw(body.to_vec()));
                    }
                }
                EVENT_AUDIO => {
                    if body.len() > AUDIO_HEADER {
                        self.play(&body[AUDIO_HEADER..]);
                    }
                }
                _ => {}
            }
        }
    }

    fn play(&self, packet: &[u8]) {
        let mut inner = self.inner.lock().unwrap();
        if !matches!(inner.status, ClientStatus::Connected { .. }) || !self.store.get().play_audio {
            return;
        }
        if inner.audio.is_none() {
            inner.audio = AudioPlayer::start().ok();
        }
        if let Some(audio) = inner.audio.as_ref() {
            audio.push(packet);
        }
    }

    fn on_state(&self, v: &Value) {
        {
            let mut inner = self.inner.lock().unwrap();
            let name = inner
                .target
                .as_ref()
                .map(|t| t.name.clone())
                .unwrap_or_default();
            match v["type"].as_str() {
                Some("connected") => {
                    let host_name = v["hostName"].as_str().unwrap_or(&name).to_string();
                    let id = v["endpointId"].as_str().unwrap_or_default().to_string();
                    if let Some(target) = inner.target.as_mut() {
                        target.secret = None;
                        target.name = host_name.clone();
                        let ticket = target.ticket.clone();
                        self.store.update(|s| {
                            s.hosts.retain(|h| h.id != id);
                            s.hosts.insert(
                                0,
                                SavedHost {
                                    id: id.clone(),
                                    name: host_name.clone(),
                                    ticket,
                                    last_connected_at: Some(now_ms()),
                                },
                            );
                        });
                    }
                    inner.status = ClientStatus::Connected {
                        name: host_name,
                        path: v["path"].as_str().map(String::from),
                        rtt_ms: v["rttMs"].as_u64(),
                    };
                    self.clipboard.lock().unwrap().reset();
                }
                Some("path") => {
                    if let ClientStatus::Connected { name, .. } = &inner.status {
                        inner.status = ClientStatus::Connected {
                            name: name.clone(),
                            path: v["path"].as_str().map(String::from),
                            rtt_ms: v["rttMs"].as_u64(),
                        };
                    }
                }
                Some("rejected") => {
                    inner.status = ClientStatus::Failed {
                        name,
                        message: rejection(v["reason"].as_str()),
                    };
                    inner.audio = None;
                }
                Some("disconnected") => {
                    if inner.target.is_some() && v["reason"] != "local" {
                        let message = format!(
                            "The connection ended ({}). Check that Tetratop is running on the other computer, then try again.",
                            v["reason"].as_str().unwrap_or("unknown reason")
                        );
                        inner.status = ClientStatus::Failed { name, message };
                    }
                    inner.audio = None;
                }
                _ => return,
            }
        }
        self.emit();
    }

    fn on_control(&self, v: &Value) {
        {
            let mut inner = self.inner.lock().unwrap();
            match v["t"].as_str() {
                Some("displays") => {
                    inner.displays = v["displays"].as_array().cloned().unwrap_or_default();
                    inner.active_display = v["active"].as_u64();
                }
                Some("video") => {
                    inner.active_display = v["displayId"].as_u64();
                    inner.video = Some(v.clone());
                }
                Some("status") => inner.remote_status = Some(v.clone()),
                Some("clipboard") => {
                    if let Some(text) = v["text"].as_str() {
                        self.clipboard.lock().unwrap().write(text);
                    }
                    return;
                }
                _ => return,
            }
        }
        self.emit();
    }

    fn tick(&self) {
        let connected = matches!(
            self.inner.lock().unwrap().status,
            ClientStatus::Connected { .. }
        );
        if !connected {
            return;
        }
        if let Some(text) = self.clipboard.lock().unwrap().changed() {
            self.send_control(&json!({"t": "clipboard", "text": text}));
        }
    }
}

fn rejection(reason: Option<&str>) -> String {
    match reason {
        Some("notPaired") => {
            "That computer doesn't know this one. Copy a new link from it and connect again.".into()
        }
        Some("badSecret") => {
            "That link was already used. Copy a new link from the other computer.".into()
        }
        Some("version") => {
            "The other computer runs a different Tetratop version. Update both.".into()
        }
        _ => {
            "The other computer turned this one away. Copy a new link from it and try again.".into()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_viewer_input_to_records() {
        assert_eq!(
            ViewerInput::Key {
                code: "KeyC".into(),
                down: true,
                flags: 0x100000
            }
            .record(),
            Some(InputRecord::Key {
                key_code: 0x08,
                down: true,
                flags: 0x100000
            })
        );
        assert_eq!(
            ViewerInput::Key {
                code: "Unidentified".into(),
                down: true,
                flags: 0
            }
            .record(),
            None
        );
        assert_eq!(
            ViewerInput::MoveTo { x: 1.4, y: -0.2 }.record(),
            Some(InputRecord::MoveTo { x: 1.0, y: 0.0 })
        );
        assert_eq!(
            ViewerInput::Button {
                button: 1,
                down: false,
                clicks: 7
            }
            .record(),
            Some(InputRecord::Button {
                button: 1,
                down: false,
                clicks: 3
            })
        );
    }
}
