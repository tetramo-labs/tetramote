use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tetra_core::host::SEND_DROPPED;
use tetra_core::protocol::{EVENT_CONTROL, EVENT_INPUT, EVENT_STATE, FLAG_KEYFRAME};
use tetra_core::{EndpointConfig, Events, Host, HostConfig};
use tetra_media::{
    AudioPacket, DisplayInfo, EncodedFrame, InputInjector, InputRecord, MediaError, ScreenStream,
    StreamConfig, StreamSink,
};

use crate::bitrate::{BitrateController, START_BPS};
use crate::store::{now_ms, PairedDevice, Store};
use crate::{clipboard, pairing, system};

const MAX_BACKLOG: u32 = 4;

/// `TETRATOP_TEST_PATTERN=1` shares a synthetic display and writes input to
/// `TETRATOP_INPUT_LOG` instead of the real screen, pointer and keyboard.
fn test_pattern() -> bool {
    std::env::var("TETRATOP_TEST_PATTERN").is_ok_and(|v| v == "1")
}

struct LogInjector {
    path: Option<String>,
}

impl InputInjector for LogInjector {
    fn set_display(&mut self, _display: &DisplayInfo) {}

    fn handle(&mut self, record: &InputRecord) -> tetra_media::Result<()> {
        if let Some(path) = &self.path {
            use std::io::Write;
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
            {
                let _ = writeln!(f, "{record:?}");
            }
        }
        Ok(())
    }
}

fn permissions() -> tetra_media::Permissions {
    if test_pattern() {
        tetra_media::Permissions {
            screen_recording: true,
            accessibility: true,
        }
    } else {
        tetra_media::permissions()
    }
}

fn displays() -> Vec<DisplayInfo> {
    if test_pattern() {
        vec![tetra_media::test_pattern::display()]
    } else {
        tetra_media::displays().unwrap_or_default()
    }
}

fn start_stream(
    config: StreamConfig,
    sink: Arc<Sink>,
) -> tetra_media::Result<Box<dyn ScreenStream>> {
    if test_pattern() {
        tetra_media::test_pattern::start(config, sink)
    } else {
        tetra_media::start_stream(config, sink)
    }
}

fn input_injector() -> Option<Box<dyn InputInjector>> {
    if test_pattern() {
        Some(Box::new(LogInjector {
            path: std::env::var("TETRATOP_INPUT_LOG").ok(),
        }))
    } else {
        tetra_media::input_injector().ok()
    }
}
const DENIED_STATUS_EVERY: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HostStatus {
    Starting,
    Waiting,
    Connected {
        name: String,
        path: Option<String>,
        #[serde(rename = "rttMs")]
        rtt_ms: Option<u64>,
    },
    Failed {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostState {
    pub status: HostStatus,
    pub pairing_url: Option<String>,
    pub qr_svg: Option<String>,
    pub trusted: Vec<PairedDevice>,
    pub screen_recording: bool,
    pub accessibility: bool,
    pub stream_error: Option<String>,
    pub endpoint_id: Option<String>,
    pub encoder: Option<String>,
}

struct Peer {
    id: String,
    name: String,
}

struct Inner {
    host: Option<Arc<Host>>,
    generation: u64,
    ticket: Option<String>,
    endpoint_id: Option<String>,
    secret: String,
    peer: Option<Peer>,
    status: HostStatus,
    permissions: tetra_media::Permissions,
    stream_error: Option<String>,
    encoder: Option<String>,
    display: Option<DisplayInfo>,
    injector: Option<Box<dyn InputInjector>>,
    sink: Option<Arc<Sink>>,
    last_denied_status: Option<Instant>,
}

/// Shares this computer: one iroh host, one connected device at a time.
pub struct HostService {
    app: AppHandle,
    store: Arc<Store>,
    inner: Mutex<Inner>,
    stream: Arc<Mutex<Option<Box<dyn ScreenStream>>>>,
    clipboard: Mutex<clipboard::Watcher>,
}

impl HostService {
    pub fn new(app: AppHandle, store: Arc<Store>) -> Arc<Self> {
        Arc::new(Self {
            app,
            store,
            inner: Mutex::new(Inner {
                host: None,
                generation: 0,
                ticket: None,
                endpoint_id: None,
                secret: pairing::new_secret(),
                peer: None,
                status: HostStatus::Starting,
                permissions: permissions(),
                stream_error: None,
                encoder: None,
                display: None,
                injector: None,
                sink: None,
                last_denied_status: None,
            }),
            stream: Arc::new(Mutex::new(None)),
            clipboard: Mutex::new(clipboard::Watcher::new()),
        })
    }

    pub fn start(self: &Arc<Self>) {
        let this = self.clone();
        std::thread::Builder::new()
            .name("tetra-host".into())
            .spawn(move || this.run())
            .expect("host thread");
        let this = self.clone();
        std::thread::Builder::new()
            .name("tetra-host-tick".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                this.tick();
            })
            .expect("host tick thread");
    }

    pub fn restart(self: &Arc<Self>) {
        let old = {
            let mut inner = self.inner.lock().unwrap();
            inner.generation += 1;
            inner.status = HostStatus::Starting;
            inner.ticket = None;
            inner.host.take()
        };
        self.end_session();
        if let Some(host) = old {
            tetra_core::net::runtime().block_on(host.close());
        }
        let this = self.clone();
        std::thread::spawn(move || this.run());
        self.emit();
    }

    pub fn endpoint_id(&self) -> Option<String> {
        self.inner.lock().unwrap().endpoint_id.clone()
    }

    pub fn state(&self) -> HostState {
        let inner = self.inner.lock().unwrap();
        let pairing_url = inner
            .ticket
            .as_ref()
            .map(|t| pairing::make(t, &inner.secret, &system::computer_name()));
        HostState {
            status: inner.status.clone(),
            qr_svg: pairing_url.as_deref().map(qr_svg),
            pairing_url,
            trusted: self.store.get().trusted,
            screen_recording: inner.permissions.screen_recording,
            accessibility: inner.permissions.accessibility,
            stream_error: inner.stream_error.clone(),
            endpoint_id: inner.endpoint_id.clone(),
            encoder: inner.encoder.clone(),
        }
    }

    pub fn new_code(&self) {
        let (host, secret) = {
            let mut inner = self.inner.lock().unwrap();
            inner.secret = pairing::new_secret();
            (inner.host.clone(), inner.secret.clone())
        };
        if let Some(host) = host {
            host.set_pairing_secret(Some(secret));
        }
        self.emit();
    }

    pub fn remove(&self, id: &str) {
        let settings = self.store.update(|s| s.trusted.retain(|d| d.id != id));
        if let Some(host) = self.inner.lock().unwrap().host.clone() {
            host.set_trusted(settings.trusted.iter().map(|d| d.id.clone()).collect());
        }
        self.emit();
    }

    pub fn disconnect(&self) {
        if let Some(host) = self.inner.lock().unwrap().host.clone() {
            host.disconnect_peer();
        }
    }

    /// `TETRATOP_PAIRING_FILE` receives the current pairing link, for tests that pair without a camera.
    fn emit(&self) {
        let state = self.state();
        if let (Ok(path), Some(url)) = (
            std::env::var("TETRATOP_PAIRING_FILE"),
            state.pairing_url.as_ref(),
        ) {
            let _ = std::fs::write(path, url);
        }
        let _ = self.app.emit("host-state", state);
    }

    fn run(self: Arc<Self>) {
        let generation = self.inner.lock().unwrap().generation;
        let settings = self.store.get();
        let key = match self.store.host_key() {
            Ok(k) => k,
            Err(message) => return self.fail(generation, message),
        };
        let (events, rx) = Events::channel();
        let config = HostConfig {
            endpoint: EndpointConfig {
                secret_key: key,
                relay_url: Some(settings.relay_url.clone()).filter(|r| !r.trim().is_empty()),
                local_only: false,
            },
            host_name: system::computer_name(),
            trusted: settings.trusted.iter().map(|d| d.id.clone()).collect(),
            pairing_secret: Some(self.inner.lock().unwrap().secret.clone()),
        };
        let host = match tetra_core::net::runtime().block_on(Host::start(config, events)) {
            Ok(h) => Arc::new(h),
            Err(e) => {
                return self.fail(
                    generation,
                    format!("Sharing this computer couldn't start: {e}"),
                )
            }
        };
        {
            let mut inner = self.inner.lock().unwrap();
            if inner.generation != generation {
                drop(inner);
                tetra_core::net::runtime().block_on(host.close());
                return;
            }
            inner.endpoint_id = Some(host.endpoint().id().to_string());
            inner.host = Some(host.clone());
            inner.status = HostStatus::Waiting;
        }
        self.emit();
        self.pump(generation, &host, rx);
    }

    fn fail(&self, generation: u64, message: String) {
        let mut inner = self.inner.lock().unwrap();
        if inner.generation == generation {
            inner.status = HostStatus::Failed { message };
        }
        drop(inner);
        self.emit();
    }

    fn pump(self: &Arc<Self>, generation: u64, host: &Arc<Host>, rx: mpsc::Receiver<Vec<u8>>) {
        while let Ok(event) = rx.recv() {
            if self.inner.lock().unwrap().generation != generation {
                return;
            }
            let Some((&kind, body)) = event.split_first() else {
                continue;
            };
            match kind {
                EVENT_STATE => {
                    if let Ok(v) = serde_json::from_slice::<Value>(body) {
                        self.on_state(host, &v);
                    }
                }
                EVENT_CONTROL => {
                    if let Ok(v) = serde_json::from_slice::<Value>(body) {
                        self.on_control(host, &v);
                    }
                }
                EVENT_INPUT => {
                    if let Some(record) = InputRecord::parse(body) {
                        self.on_input(host, &record);
                    }
                }
                _ => {}
            }
        }
    }

    fn on_state(self: &Arc<Self>, host: &Arc<Host>, v: &Value) {
        let id = v["id"].as_str().unwrap_or_default().to_string();
        match v["type"].as_str() {
            Some("ticket") => {
                self.inner.lock().unwrap().ticket = v["ticket"].as_str().map(String::from);
            }
            Some("paired") => {
                let name = v["name"]
                    .as_str()
                    .filter(|n| !n.is_empty())
                    .unwrap_or("Device")
                    .to_string();
                self.store.update(|s| {
                    s.trusted.retain(|d| d.id != id);
                    s.trusted.push(PairedDevice {
                        id: id.clone(),
                        name,
                        paired_at: now_ms(),
                    });
                });
                let secret = pairing::new_secret();
                self.inner.lock().unwrap().secret = secret.clone();
                host.set_pairing_secret(Some(secret));
            }
            Some("peerConnected") => {
                let name = v["name"]
                    .as_str()
                    .filter(|n| !n.is_empty())
                    .unwrap_or("Device")
                    .to_string();
                self.store.update(|s| {
                    if let Some(d) = s.trusted.iter_mut().find(|d| d.id == id) {
                        d.name = name.clone();
                    }
                });
                {
                    let mut inner = self.inner.lock().unwrap();
                    inner.peer = Some(Peer {
                        id,
                        name: name.clone(),
                    });
                    inner.status = HostStatus::Connected {
                        name,
                        path: v["path"].as_str().map(String::from),
                        rtt_ms: v["rttMs"].as_u64(),
                    };
                }
                self.begin_session(host, None);
            }
            Some("path") => {
                let mut inner = self.inner.lock().unwrap();
                let name = inner
                    .peer
                    .as_ref()
                    .filter(|p| p.id == id)
                    .map(|p| p.name.clone());
                if let Some(name) = name {
                    inner.status = HostStatus::Connected {
                        name,
                        path: v["path"].as_str().map(String::from),
                        rtt_ms: v["rttMs"].as_u64(),
                    };
                }
            }
            Some("peerDisconnected") => {
                let ended = {
                    let mut inner = self.inner.lock().unwrap();
                    if inner.peer.as_ref().is_some_and(|p| p.id == id) {
                        inner.peer = None;
                        inner.status = HostStatus::Waiting;
                        true
                    } else {
                        false
                    }
                };
                if ended {
                    self.end_session();
                }
            }
            _ => return,
        }
        self.emit();
    }

    fn begin_session(self: &Arc<Self>, host: &Arc<Host>, display_id: Option<u64>) {
        let permissions = permissions();
        self.inner.lock().unwrap().permissions = permissions;
        send(host, &status_message(permissions));
        let displays = displays();
        let wanted = display_id.or_else(|| displays.iter().find(|d| d.main).map(|d| d.id));
        send(
            host,
            &json!({
                "t": "displays",
                "active": wanted,
                "displays": displays.iter().map(|d| json!({
                    "id": d.id, "name": d.name, "width": d.width, "height": d.height, "main": d.main,
                })).collect::<Vec<_>>(),
            }),
        );

        *self.stream.lock().unwrap() = None;
        let sink = Arc::new(Sink {
            host: host.clone(),
            stream: self.stream.clone(),
            bitrate: Mutex::new(BitrateController::new(Instant::now())),
            audio: AtomicBool::new(true),
            service: Arc::downgrade(self),
        });
        let config = StreamConfig {
            display_id: wanted,
            bitrate_bps: START_BPS,
            ..StreamConfig::default()
        };
        match start_stream(config, sink.clone()) {
            Ok(stream) => {
                let info = stream.info().clone();
                send(
                    host,
                    &json!({
                        "t": "video", "codec": "h264", "width": info.width, "height": info.height,
                        "pointWidth": info.display.point_width, "pointHeight": info.display.point_height,
                        "displayId": info.display.id,
                    }),
                );
                send(
                    host,
                    &json!({"t": "audio", "codec": "opus", "sampleRate": 48000, "channels": 2, "frameMs": 20}),
                );
                let mut inner = self.inner.lock().unwrap();
                inner.stream_error = None;
                inner.encoder = Some(info.encoder.to_string());
                inner.display = Some(info.display.clone());
                if inner.injector.is_none() {
                    inner.injector = input_injector();
                }
                if let Some(injector) = inner.injector.as_mut() {
                    injector.set_display(&info.display);
                }
                inner.sink = Some(sink);
                drop(inner);
                *self.stream.lock().unwrap() = Some(stream);
            }
            Err(e) => {
                self.inner.lock().unwrap().stream_error = Some(e.to_string());
                send(host, &status_message(permissions));
            }
        }
        self.clipboard.lock().unwrap().reset();
        self.emit();
    }

    fn end_session(&self) {
        let stream = self.stream.lock().unwrap().take();
        drop(stream);
        let mut inner = self.inner.lock().unwrap();
        inner.sink = None;
        inner.encoder = None;
        inner.display = None;
    }

    fn on_control(self: &Arc<Self>, host: &Arc<Host>, v: &Value) {
        match v["t"].as_str() {
            Some("keyframe") => {
                if let Some(stream) = self.stream.lock().unwrap().as_ref() {
                    stream.request_keyframe();
                }
            }
            Some("selectDisplay") => {
                if let Some(id) = v["id"].as_u64() {
                    self.begin_session(host, Some(id));
                }
            }
            Some("clipboard") => {
                if let Some(text) = v["text"].as_str() {
                    self.clipboard.lock().unwrap().write(text);
                }
            }
            Some("getClipboard") => {
                if let Some(text) = clipboard::read() {
                    send(host, &json!({"t": "clipboard", "text": text}));
                }
            }
            Some("setAudio") => {
                let enabled = v["enabled"].as_bool().unwrap_or(true);
                if let Some(sink) = self.inner.lock().unwrap().sink.as_ref() {
                    sink.audio.store(enabled, Ordering::Relaxed);
                }
            }
            _ => {}
        }
    }

    fn on_input(&self, host: &Arc<Host>, record: &InputRecord) {
        let mut inner = self.inner.lock().unwrap();
        let Some(injector) = inner.injector.as_mut() else {
            return;
        };
        if let Err(MediaError::PermissionDenied(_)) = injector.handle(record) {
            let due = inner
                .last_denied_status
                .is_none_or(|t| t.elapsed() >= DENIED_STATUS_EVERY);
            if due {
                inner.last_denied_status = Some(Instant::now());
                inner.permissions = permissions();
                send(host, &status_message(inner.permissions));
            }
        }
    }

    fn on_stream_error(&self, error: MediaError) {
        self.inner.lock().unwrap().stream_error = Some(error.to_string());
        self.emit();
    }

    fn tick(&self) {
        let permissions = permissions();
        let (changed, host, connected) = {
            let mut inner = self.inner.lock().unwrap();
            let changed = inner.permissions != permissions;
            inner.permissions = permissions;
            (changed, inner.host.clone(), inner.peer.is_some())
        };
        if let (true, Some(host)) = (connected, host.as_ref()) {
            if changed {
                send(host, &status_message(permissions));
            }
            if let Some(text) = self.clipboard.lock().unwrap().changed() {
                send(host, &json!({"t": "clipboard", "text": text}));
            }
        }
        if changed {
            self.emit();
        }
    }
}

fn send(host: &Host, message: &Value) {
    host.send_control(message.to_string().as_bytes());
}

fn status_message(p: tetra_media::Permissions) -> Value {
    json!({"t": "status", "screenRecording": p.screen_recording, "accessibility": p.accessibility})
}

fn qr_svg(url: &str) -> String {
    match qrcode::QrCode::new(url.as_bytes()) {
        Ok(code) => code
            .render::<qrcode::render::svg::Color>()
            .quiet_zone(false)
            .dark_color(qrcode::render::svg::Color("#000000"))
            .light_color(qrcode::render::svg::Color("#ffffff"))
            .build(),
        Err(_) => String::new(),
    }
}

/// Bridges a capture to the iroh host: drops frames before encoding while the
/// send backlog is high, adapts the bitrate, and forces a keyframe after the
/// core had to drop one.
struct Sink {
    host: Arc<Host>,
    stream: Arc<Mutex<Option<Box<dyn ScreenStream>>>>,
    bitrate: Mutex<BitrateController>,
    audio: AtomicBool,
    service: std::sync::Weak<HostService>,
}

impl Sink {
    fn with_stream(&self, f: impl FnOnce(&dyn ScreenStream)) {
        if let Ok(guard) = self.stream.try_lock() {
            if let Some(stream) = guard.as_ref() {
                f(stream.as_ref());
            }
        }
    }
}

impl StreamSink for Sink {
    fn should_encode(&self) -> bool {
        let skip = self.host.backlog() > MAX_BACKLOG;
        let now = Instant::now();
        let change = {
            let mut controller = self.bitrate.lock().unwrap();
            if skip {
                controller.on_skip(now)
            } else {
                controller.on_sent(now)
            }
        };
        if let Some(bps) = change {
            self.with_stream(|s| s.set_bitrate(bps));
        }
        !skip
    }

    fn on_video(&self, frame: EncodedFrame) {
        let flags = if frame.keyframe { FLAG_KEYFRAME } else { 0 };
        if self.host.send_video(frame.pts_us, flags, &frame.data) == SEND_DROPPED {
            self.with_stream(|s| s.request_keyframe());
        }
    }

    fn on_audio(&self, packet: AudioPacket) {
        if self.audio.load(Ordering::Relaxed) {
            self.host.send_audio(packet.pts_us, &packet.data);
        }
    }

    fn on_error(&self, error: MediaError) {
        if let Some(service) = self.service.upgrade() {
            service.on_stream_error(error);
        }
    }
}
