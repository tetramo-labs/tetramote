use std::collections::HashSet;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use iroh::endpoint::{Connection, Incoming, SendStream, VarInt};
use iroh::Endpoint;
use n0_watcher::Watcher;
use serde::Deserialize;
use tokio::sync::{mpsc, watch};

use crate::net::{self, EndpointConfig, Events};
use crate::protocol::{
    self, authorize, encode_audio_datagram, read_input_record, read_message, write_message, Auth,
    Hello, VideoHeader, EVENT_CONTROL, EVENT_INPUT, FLAG_KEYFRAME, STREAM_INPUT, STREAM_VIDEO,
};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_QUEUED_FRAMES: u32 = 30;

pub const SEND_OK: i32 = 0;
pub const SEND_DROPPED: i32 = 1;
pub const SEND_NO_PEER: i32 = -2;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostConfig {
    #[serde(flatten)]
    pub endpoint: EndpointConfig,
    pub host_name: String,
    #[serde(default)]
    pub trusted: Vec<String>,
    #[serde(default)]
    pub pairing_secret: Option<String>,
}

struct Frame {
    seq: u32,
    pts_us: u64,
    flags: u8,
    data: Vec<u8>,
}

struct Peer {
    generation: u64,
    id: String,
    conn: Connection,
    control_tx: mpsc::UnboundedSender<Vec<u8>>,
    video_tx: mpsc::UnboundedSender<Frame>,
}

struct Shared {
    endpoint: Endpoint,
    events: Events,
    host_name: String,
    trusted: Mutex<HashSet<String>>,
    pairing_secret: Mutex<Option<String>>,
    active: Mutex<Option<Arc<Peer>>>,
    generation: AtomicU64,
    in_flight: Arc<AtomicU32>,
    video_seq: AtomicU32,
    audio_seq: AtomicU32,
}

pub struct Host {
    shared: Arc<Shared>,
}

impl Host {
    pub async fn start(config: HostConfig, events: Events) -> Result<Self, String> {
        let endpoint = net::bind(&config.endpoint).await?;
        let shared = Arc::new(Shared {
            endpoint: endpoint.clone(),
            events,
            host_name: config.host_name,
            trusted: Mutex::new(config.trusted.into_iter().collect()),
            pairing_secret: Mutex::new(config.pairing_secret.filter(|s| !s.is_empty())),
            active: Mutex::new(None),
            generation: AtomicU64::new(0),
            in_flight: Arc::new(AtomicU32::new(0)),
            video_seq: AtomicU32::new(0),
            audio_seq: AtomicU32::new(0),
        });
        tokio::spawn(accept_loop(shared.clone()));
        tokio::spawn(publish_tickets(shared.clone()));
        Ok(Self { shared })
    }

    pub fn ticket(&self) -> String {
        net::ticket_for(&self.shared.endpoint)
    }

    pub fn endpoint(&self) -> &Endpoint {
        &self.shared.endpoint
    }

    pub fn set_trusted(&self, ids: Vec<String>) {
        let ids: HashSet<String> = ids.into_iter().collect();
        let revoked = {
            let active = self.shared.active.lock().unwrap();
            active.as_ref().filter(|p| !ids.contains(&p.id)).cloned()
        };
        *self.shared.trusted.lock().unwrap() = ids;
        if let Some(peer) = revoked {
            peer.conn.close(VarInt::from_u32(3), b"revoked");
        }
    }

    pub fn set_pairing_secret(&self, secret: Option<String>) {
        *self.shared.pairing_secret.lock().unwrap() = secret.filter(|s| !s.is_empty());
    }

    pub fn send_control(&self, json: &[u8]) -> i32 {
        match self.active() {
            Some(peer) if peer.control_tx.send(json.to_vec()).is_ok() => SEND_OK,
            _ => SEND_NO_PEER,
        }
    }

    /// A frame is dropped (and its sequence number still spent, so the phone
    /// sees the gap) when too many are queued; the caller then forces a keyframe.
    pub fn send_video(&self, pts_us: u64, flags: u8, data: &[u8]) -> i32 {
        let Some(peer) = self.active() else {
            return SEND_NO_PEER;
        };
        let seq = self.shared.video_seq.fetch_add(1, Ordering::Relaxed);
        let key = flags & FLAG_KEYFRAME != 0;
        if !key && self.backlog() >= MAX_QUEUED_FRAMES {
            return SEND_DROPPED;
        }
        self.shared.in_flight.fetch_add(1, Ordering::Relaxed);
        let frame = Frame {
            seq,
            pts_us,
            flags,
            data: data.to_vec(),
        };
        if peer.video_tx.send(frame).is_err() {
            self.shared.in_flight.fetch_sub(1, Ordering::Relaxed);
            return SEND_NO_PEER;
        }
        SEND_OK
    }

    pub fn send_audio(&self, pts_us: u64, data: &[u8]) -> i32 {
        let Some(peer) = self.active() else {
            return SEND_NO_PEER;
        };
        let seq = self.shared.audio_seq.fetch_add(1, Ordering::Relaxed);
        let datagram = encode_audio_datagram(seq, pts_us, data);
        match peer.conn.send_datagram(Bytes::from(datagram)) {
            Ok(()) => SEND_OK,
            Err(_) => SEND_DROPPED,
        }
    }

    pub fn backlog(&self) -> u32 {
        self.shared.in_flight.load(Ordering::Relaxed)
    }

    pub fn disconnect_peer(&self) {
        if let Some(peer) = self.active() {
            peer.conn.close(VarInt::from_u32(0), b"host");
        }
    }

    pub async fn close(&self) {
        self.disconnect_peer();
        self.shared.endpoint.close().await;
    }

    fn active(&self) -> Option<Arc<Peer>> {
        self.shared.active.lock().unwrap().clone()
    }
}

async fn publish_tickets(shared: Arc<Shared>) {
    let mut watcher = shared.endpoint.watch_addr();
    loop {
        let ticket = net::ticket_for(&shared.endpoint);
        shared.events.json(serde_json::json!({
            "type": "ticket",
            "ticket": ticket,
            "endpointId": shared.endpoint.id().to_string(),
        }));
        if watcher.updated().await.is_err() {
            return;
        }
    }
}

async fn accept_loop(shared: Arc<Shared>) {
    while let Some(incoming) = shared.endpoint.accept().await {
        let shared = shared.clone();
        tokio::spawn(async move {
            if let Err(error) = handle_incoming(shared.clone(), incoming).await {
                shared
                    .events
                    .json(serde_json::json!({"type": "handshakeFailed", "error": error}));
            }
        });
    }
}

async fn handle_incoming(shared: Arc<Shared>, incoming: Incoming) -> Result<(), String> {
    let accepting = incoming
        .accept()
        .map_err(|e| format!("accept failed: {e}"))?;
    let conn = accepting
        .await
        .map_err(|e| format!("handshake failed: {e}"))?;
    let remote = conn.remote_id().to_string();
    let (mut send, mut recv) = tokio::time::timeout(HANDSHAKE_TIMEOUT, conn.accept_bi())
        .await
        .map_err(|_| "phone opened no control stream".to_string())?
        .map_err(|e| format!("control stream failed: {e}"))?;
    let hello = tokio::time::timeout(HANDSHAKE_TIMEOUT, read_message(&mut recv))
        .await
        .map_err(|_| "phone sent no hello".to_string())?
        .map_err(|e| format!("reading hello failed: {e}"))?
        .ok_or("control stream closed before hello")?;
    let hello: Hello =
        serde_json::from_slice(&hello).map_err(|e| format!("hello is not valid JSON: {e}"))?;

    let auth = {
        let trusted = shared.trusted.lock().unwrap();
        let secret = shared.pairing_secret.lock().unwrap();
        authorize(&remote, &hello, &trusted, secret.as_deref())
    };
    let paired = match auth {
        Auth::Rejected(reason) => {
            let msg = serde_json::json!({"t": "rejected", "reason": reason}).to_string();
            let _ = write_message(&mut send, msg.as_bytes()).await;
            let _ = send.finish();
            let _ = tokio::time::timeout(Duration::from_secs(2), conn.closed()).await;
            conn.close(VarInt::from_u32(1), reason.as_bytes());
            shared.events.json(serde_json::json!({
                "type": "rejected", "id": remote, "name": hello.name, "reason": reason,
            }));
            return Ok(());
        }
        Auth::Paired => {
            shared.trusted.lock().unwrap().insert(remote.clone());
            *shared.pairing_secret.lock().unwrap() = None;
            shared
                .events
                .json(serde_json::json!({"type": "paired", "id": remote, "name": hello.name}));
            true
        }
        Auth::Trusted => false,
    };

    let welcome = serde_json::json!({
        "t": "welcome",
        "v": protocol::PROTOCOL_VERSION,
        "hostName": shared.host_name,
        "paired": paired,
    })
    .to_string();
    write_message(&mut send, welcome.as_bytes())
        .await
        .map_err(|e| format!("writing welcome failed: {e}"))?;

    let generation = shared.generation.fetch_add(1, Ordering::Relaxed) + 1;
    let (control_tx, control_rx) = mpsc::unbounded_channel();
    let (video_tx, video_rx) = mpsc::unbounded_channel();
    let peer = Arc::new(Peer {
        generation,
        id: remote.clone(),
        conn: conn.clone(),
        control_tx,
        video_tx,
    });
    let previous = shared.active.lock().unwrap().replace(peer.clone());
    if let Some(previous) = previous {
        previous.conn.close(VarInt::from_u32(2), b"replaced");
    }
    shared.in_flight.store(0, Ordering::Relaxed);

    tokio::spawn(write_control(send, control_rx));
    tokio::spawn(send_video_frames(
        conn.clone(),
        video_rx,
        shared.in_flight.clone(),
    ));
    tokio::spawn(read_input(conn.clone(), shared.events.clone()));
    tokio::spawn(net::watch_path(
        conn.clone(),
        shared.events.clone(),
        serde_json::json!({"id": remote}),
    ));

    let path = net::selected_path(&conn);
    shared.events.json(serde_json::json!({
        "type": "peerConnected",
        "id": remote,
        "name": hello.name,
        "paired": paired,
        "path": path.as_ref().map(|p| p.kind),
        "rttMs": path.as_ref().map(|p| p.rtt_ms),
    }));

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
        .unwrap_or_else(|| "control stream closed".into());
    conn.close(VarInt::from_u32(0), b"bye");

    let was_active = {
        let mut active = shared.active.lock().unwrap();
        if active.as_ref().is_some_and(|p| p.generation == generation) {
            *active = None;
            true
        } else {
            false
        }
    };
    if was_active {
        shared.events.json(serde_json::json!({
            "type": "peerDisconnected", "id": remote, "reason": reason,
        }));
    }
    Ok(())
}

async fn write_control(mut send: SendStream, mut rx: mpsc::UnboundedReceiver<Vec<u8>>) {
    while let Some(msg) = rx.recv().await {
        if write_message(&mut send, &msg).await.is_err() {
            return;
        }
    }
    let _ = send.finish();
}

/// Each frame rides its own uni stream so a lost packet only stalls that frame.
/// A keyframe makes every older frame useless, so their streams are reset.
async fn send_video_frames(
    conn: Connection,
    mut rx: mpsc::UnboundedReceiver<Frame>,
    in_flight: Arc<AtomicU32>,
) {
    let (cancel_tx, _) = watch::channel(0u64);
    let mut sent: u64 = 0;
    while let Some(frame) = rx.recv().await {
        sent += 1;
        let order = sent;
        if frame.flags & FLAG_KEYFRAME != 0 {
            cancel_tx.send_replace(order);
        }
        let mut stream = match conn.open_uni().await {
            Ok(s) => s,
            Err(_) => {
                in_flight.fetch_sub(1, Ordering::Relaxed);
                break;
            }
        };
        let mut cancel_rx = cancel_tx.subscribe();
        let in_flight = in_flight.clone();
        tokio::spawn(async move {
            let header = VideoHeader {
                seq: frame.seq,
                pts_us: frame.pts_us,
                flags: frame.flags,
            }
            .encode();
            let cancelled = tokio::select! {
                _ = write_frame(&mut stream, &header, &frame.data) => false,
                _ = cancel_rx.wait_for(|&newest_key| newest_key > order) => true,
            };
            if cancelled {
                let _ = stream.reset(VarInt::from_u32(0));
            }
            let _ =
                in_flight.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_sub(1));
        });
    }
    while rx.try_recv().is_ok() {
        let _ = in_flight.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_sub(1));
    }
}

async fn write_frame(stream: &mut SendStream, header: &[u8], data: &[u8]) -> Result<(), String> {
    stream
        .write_all(&[STREAM_VIDEO])
        .await
        .map_err(|e| e.to_string())?;
    stream.write_all(header).await.map_err(|e| e.to_string())?;
    stream.write_all(data).await.map_err(|e| e.to_string())?;
    stream.finish().map_err(|e| e.to_string())?;
    let _ = stream.stopped().await;
    Ok(())
}

async fn read_input(conn: Connection, events: Events) {
    while let Ok(mut recv) = conn.accept_uni().await {
        let mut kind = [0u8; 1];
        if recv.read_exact(&mut kind).await.is_err() || kind[0] != STREAM_INPUT {
            continue;
        }
        let events = events.clone();
        tokio::spawn(async move {
            while let Ok(Some(record)) = read_input_record(&mut recv).await {
                events.emit(EVENT_INPUT, &record);
            }
        });
    }
}
