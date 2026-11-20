//! The browser end of a Tetramote session. It joins as a guest with the link's secret, through iroh relays only
//! (browsers have no UDP), and hands JavaScript the same event buffers `tetra_next_event` gives the apps.

use std::cell::RefCell;
use std::rc::Rc;
use std::str::FromStr;
use std::time::Duration;

use iroh::address_lookup::{
    AddressLookup, AddressLookupBuilder, AddressLookupBuilderError, EndpointData, EndpointInfo,
    Error as LookupError, Item, PkarrResolver,
};
use iroh::endpoint::{presets, Connection, RecvStream, VarInt};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMap, RelayMode, RelayUrl, TransportAddr};
use n0_future::boxed::BoxStream;
use n0_future::time::{sleep, timeout};
use n0_future::StreamExt;
use tetra_core::protocol::{
    audio_event_body, read_message, write_message, FrameGate, VideoHeader, ALPN, EVENT_AUDIO,
    EVENT_CONTROL, EVENT_STATE, EVENT_VIDEO, MAX_VIDEO_FRAME, PROTOCOL_VERSION, STREAM_INPUT,
    STREAM_VIDEO, VIDEO_HEADER_LEN,
};
use tokio::sync::mpsc;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::spawn_local;
use web_time::Instant;

#[path = "../../../desktop/media/src/keymap.rs"]
#[allow(dead_code)]
mod keymap;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const KEYFRAME_RETRY: Duration = Duration::from_millis(300);

/// n0's relay URLs end in a dot, and Safari refuses HTTPS and WebSocket connections to such host names.
fn dotless(url: &RelayUrl) -> RelayUrl {
    let mut url = (**url).clone();
    let host = url.host_str().map(|h| h.trim_end_matches('.').to_string());
    if let Some(host) = host.filter(|h| !h.is_empty()) {
        let _ = url.set_host(Some(&host));
    }
    RelayUrl::from(url)
}

fn dotless_info(info: &EndpointInfo) -> EndpointInfo {
    let addrs = info
        .addrs()
        .map(|addr| match addr {
            TransportAddr::Relay(url) => TransportAddr::Relay(dotless(url)),
            other => other.clone(),
        })
        .collect();
    EndpointInfo::from_parts(info.endpoint_id, EndpointData::new(addrs))
        .with_user_data(info.user_data().cloned())
}

/// The computer's address from n0's DNS, with its relay URL made reachable from Safari.
#[derive(Debug)]
struct DotlessLookup<T>(T);

impl<T: AddressLookup> AddressLookup for DotlessLookup<T> {
    fn resolve(&self, endpoint_id: EndpointId) -> Option<BoxStream<Result<Item, LookupError>>> {
        let items = self.0.resolve(endpoint_id)?;
        Some(Box::pin(items.map(|item| {
            item.map(|i| {
                Item::new(
                    dotless_info(i.endpoint_info()),
                    i.provenance(),
                    i.last_updated(),
                )
            })
        })))
    }
}

#[derive(Debug)]
struct DotlessLookupBuilder<B>(B);

impl<B: AddressLookupBuilder> AddressLookupBuilder for DotlessLookupBuilder<B> {
    fn into_address_lookup(
        self,
        endpoint: &Endpoint,
    ) -> Result<impl AddressLookup, AddressLookupBuilderError> {
        Ok(DotlessLookup(self.0.into_address_lookup(endpoint)?))
    }
}

#[derive(Clone)]
struct Events(js_sys::Function);

impl Events {
    fn emit(&self, kind: u8, parts: &[&[u8]]) {
        let len = 1 + parts.iter().map(|p| p.len()).sum::<usize>();
        let out = js_sys::Uint8Array::new_with_length(len as u32);
        out.set_index(0, kind);
        let mut at = 1u32;
        for part in parts {
            out.subarray(at, at + part.len() as u32).copy_from(part);
            at += part.len() as u32;
        }
        let _ = self.0.call1(&JsValue::NULL, &out);
    }

    fn json(&self, value: serde_json::Value) {
        self.emit(EVENT_STATE, &[value.to_string().as_bytes()]);
    }
}

struct Live {
    generation: u64,
    conn: Connection,
    control_tx: mpsc::UnboundedSender<Vec<u8>>,
    input_tx: mpsc::UnboundedSender<Vec<u8>>,
}

struct Inner {
    endpoint: Endpoint,
    events: Events,
    live: RefCell<Option<Live>>,
    generation: RefCell<u64>,
}

#[wasm_bindgen]
pub struct Session {
    inner: Rc<Inner>,
}

#[wasm_bindgen]
impl Session {
    /// Binds an endpoint with a fresh key for this page; `on_event` receives one `Uint8Array` per event.
    pub async fn start(on_event: js_sys::Function) -> Result<Session, JsError> {
        let relays: Vec<RelayUrl> = iroh::defaults::prod::default_relay_map().urls();
        let endpoint = Endpoint::builder(presets::Minimal)
            .relay_mode(RelayMode::Custom(
                relays.iter().map(dotless).collect::<RelayMap>(),
            ))
            .address_lookup(DotlessLookupBuilder(PkarrResolver::n0_dns()))
            .bind()
            .await
            .map_err(|e| JsError::new(&format!("iroh endpoint bind failed: {e}")))?;
        Ok(Session {
            inner: Rc::new(Inner {
                endpoint,
                events: Events(on_event),
                live: RefCell::new(None),
                generation: RefCell::new(0),
            }),
        })
    }

    /// Replaces any current session. Progress arrives as `connecting`, `connected`, `path`, `rejected` and
    /// `disconnected` state events.
    pub fn connect(&self, endpoint_id: String, secret: String, device_name: String) {
        let generation = {
            let mut g = self.inner.generation.borrow_mut();
            *g += 1;
            *g
        };
        if let Some(old) = self.inner.live.borrow_mut().take() {
            old.conn.close(VarInt::from_u32(0), b"replaced");
        }
        let inner = self.inner.clone();
        spawn_local(async move {
            inner.events.json(serde_json::json!({"type": "connecting"}));
            if let Err(reason) =
                run(inner.clone(), generation, endpoint_id, secret, device_name).await
            {
                if *inner.generation.borrow() == generation {
                    inner
                        .events
                        .json(serde_json::json!({"type": "disconnected", "reason": reason}));
                }
            }
        });
    }

    pub fn send_control(&self, json: &[u8]) -> bool {
        self.inner
            .live
            .borrow()
            .as_ref()
            .is_some_and(|l| l.control_tx.send(json.to_vec()).is_ok())
    }

    pub fn send_input(&self, records: &[u8]) -> bool {
        self.inner
            .live
            .borrow()
            .as_ref()
            .is_some_and(|l| l.input_tx.send(records.to_vec()).is_ok())
    }

    /// Ends any session and shuts the endpoint down, closing its relay connections.
    pub fn close(&self) {
        self.disconnect();
        let endpoint = self.inner.endpoint.clone();
        spawn_local(async move { endpoint.close().await });
    }

    pub fn disconnect(&self) {
        *self.inner.generation.borrow_mut() += 1;
        if let Some(live) = self.inner.live.borrow_mut().take() {
            live.conn.close(VarInt::from_u32(0), b"bye");
            self.inner
                .events
                .json(serde_json::json!({"type": "disconnected", "reason": "local"}));
        }
    }
}

async fn run(
    inner: Rc<Inner>,
    generation: u64,
    endpoint_id: String,
    secret: String,
    device_name: String,
) -> Result<(), String> {
    let id = EndpointId::from_str(endpoint_id.trim()).map_err(|_| "notALink".to_string())?;
    let conn = timeout(
        CONNECT_TIMEOUT,
        inner.endpoint.connect(EndpointAddr::from(id), ALPN),
    )
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
        "name": device_name,
        "secret": secret,
        "guest": true,
    })
    .to_string();
    write_message(&mut send, hello.as_bytes())
        .await
        .map_err(|e| format!("sending hello failed: {e}"))?;
    let reply = timeout(CONNECT_TIMEOUT, read_message(&mut recv))
        .await
        .map_err(|_| "timedOut".to_string())?
        .map_err(|e| format!("reading welcome failed: {e}"))?
        .ok_or("host closed the control stream")?;
    let parsed: serde_json::Value =
        serde_json::from_slice(&reply).map_err(|e| format!("welcome is not JSON: {e}"))?;
    if parsed["t"] == "rejected" {
        conn.close(VarInt::from_u32(1), b"rejected");
        if *inner.generation.borrow() == generation {
            let reason = parsed["reason"].as_str().unwrap_or("rejected");
            inner
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
    {
        if *inner.generation.borrow() != generation {
            conn.close(VarInt::from_u32(0), b"replaced");
            return Ok(());
        }
        *inner.live.borrow_mut() = Some(Live {
            generation,
            conn: conn.clone(),
            control_tx: control_tx.clone(),
            input_tx,
        });
    }

    spawn_local(async move {
        while let Some(msg) = control_rx.recv().await {
            if write_message(&mut send, &msg).await.is_err() {
                return;
            }
        }
    });
    spawn_local(async move {
        while let Some(records) = input_rx.recv().await {
            if input.write_all(&records).await.is_err() {
                return;
            }
        }
    });
    spawn_local(read_video(conn.clone(), inner.events.clone(), control_tx));
    spawn_local(read_audio(conn.clone(), inner.events.clone()));
    spawn_local(watch_rtt(conn.clone(), inner.events.clone()));

    inner.events.json(serde_json::json!({
        "type": "connected",
        "hostName": parsed["hostName"],
        "endpointId": conn.remote_id().to_string(),
        "path": "relay",
        "rttMs": rtt_ms(&conn),
    }));
    inner.events.emit(EVENT_CONTROL, &[&reply]);

    let events = inner.events.clone();
    let reader = async {
        while let Ok(Some(msg)) = read_message(&mut recv).await {
            events.emit(EVENT_CONTROL, &[&msg]);
        }
    };
    n0_future::future::race(reader, async {
        conn.closed().await;
    })
    .await;
    let reason = conn
        .close_reason()
        .map(|r| r.to_string())
        .unwrap_or_else(|| "host closed the control stream".into());
    conn.close(VarInt::from_u32(0), b"bye");

    let was_current = {
        let mut live = inner.live.borrow_mut();
        if live.as_ref().is_some_and(|l| l.generation == generation) {
            *live = None;
            true
        } else {
            false
        }
    };
    if was_current {
        inner
            .events
            .json(serde_json::json!({"type": "disconnected", "reason": reason}));
    }
    Ok(())
}

fn rtt_ms(conn: &Connection) -> Option<u64> {
    let paths = conn.paths();
    let path = paths.iter().find(|p| p.is_selected())?;
    Some(path.rtt().as_millis() as u64)
}

async fn watch_rtt(conn: Connection, events: Events) {
    loop {
        let closed = n0_future::future::race(
            async {
                conn.closed().await;
                true
            },
            async {
                sleep(Duration::from_secs(5)).await;
                false
            },
        )
        .await;
        if closed {
            return;
        }
        events.json(serde_json::json!({"type": "path", "path": "relay", "rttMs": rtt_ms(&conn)}));
    }
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
                    events.emit(EVENT_VIDEO, &[&header.encode(), &data]);
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
            events.emit(EVENT_AUDIO, &[body]);
        }
    }
}

/// The macOS virtual key code the wire carries for a DOM `KeyboardEvent.code`, from the desktop app's key table.
#[wasm_bindgen]
pub fn mac_key_code(dom_code: &str) -> Option<u16> {
    keymap::mac_key_code(dom_code)
}

/// Sends iroh's logs at `level` (`error` to `trace`) to the browser console, for diagnosing a connection.
#[wasm_bindgen]
pub fn enable_logs(level: &str) {
    let level = tracing::Level::from_str(level).unwrap_or(tracing::Level::INFO);
    let config = wasm_tracing::WasmLayerConfig::new()
        .set_max_level(level)
        .to_owned();
    let _ = wasm_tracing::set_as_global_default_with_config(config);
}
