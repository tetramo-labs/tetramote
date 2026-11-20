use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use iroh::endpoint::{Connection, RecvStream, VarInt};
use iroh::Endpoint;
use serde::Deserialize;
use tokio::sync::mpsc;

use crate::net::{self, EndpointConfig, Events};
use crate::protocol::{
    audio_event_body, read_message, write_message, FrameGate, VideoHeader, ALPN, EVENT_AUDIO,
    EVENT_CONTROL, EVENT_VIDEO, MAX_VIDEO_FRAME, PROTOCOL_VERSION, STREAM_INPUT, STREAM_VIDEO,
    VIDEO_HEADER_LEN,
};

const KEYFRAME_RETRY: Duration = Duration::from_millis(300);

pub const SEND_OK: i32 = 0;
pub const SEND_NO_SESSION: i32 = -2;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    #[serde(default)]
    pub ticket: Option<String>,
    #[serde(default)]
    pub endpoint_id: String,
    #[serde(default)]
    pub pairing_secret: Option<String>,
    #[serde(default)]
    pub device_name: String,
    #[serde(default)]
    pub guest: bool,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
}

fn default_timeout() -> u64 {
    15_000
}

struct Session {
    generation: u64,
    conn: Connection,
    control_tx: mpsc::UnboundedSender<Vec<u8>>,
    input_tx: mpsc::UnboundedSender<Vec<u8>>,
}

struct Shared {
    endpoint: Endpoint,
    events: Events,
    session: Mutex<Option<Arc<Session>>>,
    generation: AtomicU64,
}

pub struct Client {
    shared: Arc<Shared>,
}

impl Client {
    pub async fn start(config: EndpointConfig, events: Events) -> Result<Self, String> {
        let endpoint = net::bind(&config).await?;
        Ok(Self {
            shared: Arc::new(Shared {
                endpoint,
                events,
                session: Mutex::new(None),
                generation: AtomicU64::new(0),
            }),
        })
    }

    pub fn endpoint(&self) -> &Endpoint {
        &self.shared.endpoint
    }

    /// Replaces any current session. Progress arrives as `connecting`,
    /// `connected`, `rejected` and `disconnected` state events.
    pub fn connect(&self, request: ConnectRequest) {
        let generation = self.shared.generation.fetch_add(1, Ordering::Relaxed) + 1;
        if let Some(old) = self.shared.session.lock().unwrap().take() {
            old.conn.close(VarInt::from_u32(0), b"replaced");
        }
        let shared = self.shared.clone();
        tokio::spawn(async move {
            shared
                .events
                .json(serde_json::json!({"type": "connecting"}));
            if let Err(error) = run_session(shared.clone(), generation, request).await {
                if shared.generation.load(Ordering::Relaxed) == generation {
                    shared
                        .events
                        .json(serde_json::json!({"type": "disconnected", "reason": error}));
                }
            }
        });
    }

    pub fn disconnect(&self) {
        self.shared.generation.fetch_add(1, Ordering::Relaxed);
        if let Some(session) = self.shared.session.lock().unwrap().take() {
            session.conn.close(VarInt::from_u32(0), b"bye");
            self.shared
                .events
                .json(serde_json::json!({"type": "disconnected", "reason": "local"}));
        }
    }

    pub fn send_control(&self, json: &[u8]) -> i32 {
        match self.session() {
            Some(s) if s.control_tx.send(json.to_vec()).is_ok() => SEND_OK,
            _ => SEND_NO_SESSION,
        }
    }

    pub fn send_input(&self, records: &[u8]) -> i32 {
        match self.session() {
            Some(s) if s.input_tx.send(records.to_vec()).is_ok() => SEND_OK,
            _ => SEND_NO_SESSION,
        }
    }

    pub async fn close(&self) {
        self.disconnect();
        self.shared.endpoint.close().await;
    }

    fn session(&self) -> Option<Arc<Session>> {
        self.shared.session.lock().unwrap().clone()
    }
}

async fn run_session(
    shared: Arc<Shared>,
    generation: u64,
    request: ConnectRequest,
) -> Result<(), String> {
    let addr = net::parse_addr(request.ticket.as_deref(), &request.endpoint_id)?;
    let timeout = Duration::from_millis(request.timeout_ms.max(1000));
    let conn = tokio::time::timeout(timeout, shared.endpoint.connect(addr, ALPN))
        .await
        .map_err(|_| "timedOut".to_string())?
        .map_err(|e| format!("connect failed: {e}"))?;
    conn.set_max_concurrent_uni_streams(VarInt::from_u32(1024));

    let (mut send, mut recv) = conn
        .open_bi()
        .await
        .map_err(|e| format!("control stream failed: {e}"))?;
    let hello = serde_json::json!({
        "t": "hello",
        "v": PROTOCOL_VERSION,
        "name": request.device_name,
        "secret": request.pairing_secret,
        "guest": request.guest,
    })
    .to_string();
    write_message(&mut send, hello.as_bytes())
        .await
        .map_err(|e| format!("sending hello failed: {e}"))?;
    let reply = tokio::time::timeout(timeout, read_message(&mut recv))
        .await
        .map_err(|_| "timedOut".to_string())?
        .map_err(|e| format!("reading welcome failed: {e}"))?
        .ok_or("host closed the control stream")?;
    let parsed: serde_json::Value =
        serde_json::from_slice(&reply).map_err(|e| format!("welcome is not JSON: {e}"))?;
    if parsed["t"] == "rejected" {
        let reason = parsed["reason"].as_str().unwrap_or("rejected").to_string();
        conn.close(VarInt::from_u32(1), b"rejected");
        if shared.generation.load(Ordering::Relaxed) == generation {
            shared
                .events
                .json(serde_json::json!({"type": "rejected", "reason": reason}));
        }
        return Ok(());
    }
    if parsed["t"] != "welcome" {
        return Err("host sent no welcome".into());
    }

    let mut input = conn
        .open_uni()
        .await
        .map_err(|e| format!("input stream failed: {e}"))?;
    input
        .write_all(&[STREAM_INPUT])
        .await
        .map_err(|e| format!("input stream failed: {e}"))?;

    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let session = Arc::new(Session {
        generation,
        conn: conn.clone(),
        control_tx: control_tx.clone(),
        input_tx,
    });
    {
        let mut slot = shared.session.lock().unwrap();
        if shared.generation.load(Ordering::Relaxed) != generation {
            conn.close(VarInt::from_u32(0), b"replaced");
            return Ok(());
        }
        *slot = Some(session.clone());
    }

    tokio::spawn(async move {
        while let Some(msg) = control_rx.recv().await {
            if write_message(&mut send, &msg).await.is_err() {
                return;
            }
        }
    });
    tokio::spawn(async move {
        while let Some(records) = input_rx.recv().await {
            if input.write_all(&records).await.is_err() {
                return;
            }
        }
    });
    tokio::spawn(read_video(conn.clone(), shared.events.clone(), control_tx));
    tokio::spawn(read_audio(conn.clone(), shared.events.clone()));
    tokio::spawn(net::watch_path(
        conn.clone(),
        shared.events.clone(),
        serde_json::json!({}),
    ));

    let path = net::selected_path(&conn);
    shared.events.json(serde_json::json!({
        "type": "connected",
        "hostName": parsed["hostName"],
        "paired": parsed["paired"],
        "endpointId": conn.remote_id().to_string(),
        "path": path.as_ref().map(|p| p.kind),
        "rttMs": path.as_ref().map(|p| p.rtt_ms),
    }));
    shared.events.emit(EVENT_CONTROL, &reply);

    let events = shared.events.clone();
    let reader = async {
        while let Ok(Some(msg)) = read_message(&mut recv).await {
            events.emit(EVENT_CONTROL, &msg);
        }
    };
    tokio::select! {
        _ = reader => {}
        _ = conn.closed() => {}
    }
    let reason = conn
        .close_reason()
        .map(|r| r.to_string())
        .unwrap_or_else(|| "host closed the control stream".into());
    conn.close(VarInt::from_u32(0), b"bye");

    let was_current = {
        let mut slot = shared.session.lock().unwrap();
        if slot.as_ref().is_some_and(|s| s.generation == generation) {
            *slot = None;
            true
        } else {
            false
        }
    };
    if was_current {
        shared
            .events
            .json(serde_json::json!({"type": "disconnected", "reason": reason}));
    }
    Ok(())
}

/// Streams are read in the order the host opened them, which is frame order.
async fn read_video(conn: Connection, events: Events, control_tx: mpsc::UnboundedSender<Vec<u8>>) {
    let mut gate = FrameGate::new(KEYFRAME_RETRY);
    let request_keyframe = || {
        let _ = control_tx.send(br#"{"t":"keyframe"}"#.to_vec());
    };
    while let Ok(mut recv) = conn.accept_uni().await {
        match read_frame(&mut recv).await {
            Some((header, data)) => {
                let decision = gate.on_frame(&header, Instant::now());
                if decision.request_keyframe {
                    request_keyframe();
                }
                if decision.deliver {
                    events.emit_parts(EVENT_VIDEO, &header.encode(), &data);
                }
            }
            None => {
                if gate.on_lost(Instant::now()) {
                    request_keyframe();
                }
            }
        }
    }
}

async fn read_frame(recv: &mut RecvStream) -> Option<(VideoHeader, Vec<u8>)> {
    let mut head = [0u8; 1 + VIDEO_HEADER_LEN];
    recv.read_exact(&mut head).await.ok()?;
    if head[0] != STREAM_VIDEO {
        return None;
    }
    let header = VideoHeader::decode(&head[1..])?;
    let data = recv.read_to_end(MAX_VIDEO_FRAME).await.ok()?;
    Some((header, data))
}

async fn read_audio(conn: Connection, events: Events) {
    while let Ok(datagram) = conn.read_datagram().await {
        if let Some(body) = audio_event_body(&datagram) {
            events.emit(EVENT_AUDIO, body);
        }
    }
}
