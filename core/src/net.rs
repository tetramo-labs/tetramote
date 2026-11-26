use std::str::FromStr;
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::Duration;

use iroh::dns::{DnsResolver, FallbackMode};
use iroh::endpoint::{presets, Connection};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode, RelayUrl, SecretKey};
use iroh_tickets::endpoint::EndpointTicket;
use serde::Deserialize;

use crate::protocol::{hex_decode_32, ALPN, EVENT_STATE};

pub fn runtime() -> &'static tokio::runtime::Runtime {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(3)
            .thread_name("tetra")
            .enable_all()
            .build()
            .expect("tetra runtime")
    })
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointConfig {
    pub secret_key: String,
    #[serde(default)]
    pub relay_url: Option<String>,
    #[serde(default)]
    pub local_only: bool,
}

/// `local_only` turns off relays and address lookup; tests dial direct addresses.
pub async fn bind(config: &EndpointConfig) -> Result<Endpoint, String> {
    let key = hex_decode_32(&config.secret_key).ok_or("secret key must be 64 hex characters")?;
    let secret = SecretKey::from_bytes(&key);
    let builder = if config.local_only {
        Endpoint::builder(presets::Minimal)
            .relay_mode(RelayMode::Disabled)
            .bind_addr("127.0.0.1:0")
            .map_err(|e| format!("bad bind address: {e}"))?
    } else {
        let custom_relay = config
            .relay_url
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty());
        let mut b = Endpoint::builder(presets::N0).dns_resolver(resolver(custom_relay.is_some()));
        if let Some(url) = custom_relay {
            let url = RelayUrl::from_str(url)
                .map_err(|e| format!("relay URL {url:?} is invalid: {e}"))?;
            b = b.relay_mode(RelayMode::custom([url]));
        }
        b
    };
    builder
        .secret_key(secret)
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await
        .map_err(|e| format!("iroh endpoint bind failed: {e}"))
}

/// Public resolvers (plain DNS and DNS over HTTPS) raced together, rather than the system's nameservers, which
/// can be stale or unreachable (a network's servers kept after moving to another) and then stall every lookup.
/// Tetramote only looks up public names; a custom relay keeps the system's nameservers in case its name is private.
fn resolver(custom_relay: bool) -> DnsResolver {
    let builder = DnsResolver::builder().with_fallback_mode(FallbackMode::Eager);
    if custom_relay {
        builder.with_system_defaults().build()
    } else {
        builder.build()
    }
}

pub fn parse_addr(ticket: Option<&str>, endpoint_id: &str) -> Result<EndpointAddr, String> {
    if let Some(t) = ticket.map(str::trim).filter(|t| !t.is_empty()) {
        if let Ok(t) = EndpointTicket::from_str(t) {
            return Ok(t.endpoint_addr().clone());
        }
    }
    EndpointId::from_str(endpoint_id.trim())
        .map(EndpointAddr::from)
        .map_err(|_| "not an iroh endpoint ticket or id".to_string())
}

pub fn ticket_for(endpoint: &Endpoint) -> String {
    EndpointTicket::new(endpoint.addr()).to_string()
}

pub fn generate_secret_key() -> String {
    crate::protocol::hex_encode(&SecretKey::generate().to_bytes())
}

pub fn endpoint_id_for(secret_hex: &str) -> Option<String> {
    let key = hex_decode_32(secret_hex)?;
    Some(SecretKey::from_bytes(&key).public().to_string())
}

#[derive(Debug, Clone, PartialEq)]
pub struct PathInfo {
    pub kind: &'static str,
    pub rtt_ms: u64,
}

pub fn selected_path(conn: &Connection) -> Option<PathInfo> {
    let paths = conn.paths();
    let path = paths.iter().find(|p| p.is_selected())?;
    Some(PathInfo {
        kind: if path.is_relay() { "relay" } else { "direct" },
        rtt_ms: path.rtt().as_millis() as u64,
    })
}

/// Reports the selected path when it changes kind and every few seconds for RTT.
pub async fn watch_path(conn: Connection, events: Events, extra: serde_json::Value) {
    let mut last_kind = None;
    let mut ticks = 0u32;
    loop {
        if let Some(p) = selected_path(&conn) {
            if last_kind != Some(p.kind) || ticks.is_multiple_of(5) {
                last_kind = Some(p.kind);
                let mut v = serde_json::json!({"type": "path", "path": p.kind, "rttMs": p.rtt_ms});
                if let (Some(obj), Some(more)) = (v.as_object_mut(), extra.as_object()) {
                    obj.extend(more.clone());
                }
                events.json(v);
            }
        }
        ticks = ticks.wrapping_add(1);
        tokio::select! {
            _ = conn.closed() => return,
            _ = tokio::time::sleep(Duration::from_secs(1)) => {}
        }
    }
}

#[derive(Clone)]
pub struct Events {
    tx: mpsc::Sender<Vec<u8>>,
}

impl Events {
    pub fn channel() -> (Self, mpsc::Receiver<Vec<u8>>) {
        let (tx, rx) = mpsc::channel();
        (Self { tx }, rx)
    }

    pub fn emit(&self, kind: u8, body: &[u8]) {
        let mut out = Vec::with_capacity(1 + body.len());
        out.push(kind);
        out.extend_from_slice(body);
        let _ = self.tx.send(out);
    }

    pub fn emit_parts(&self, kind: u8, head: &[u8], body: &[u8]) {
        let mut out = Vec::with_capacity(1 + head.len() + body.len());
        out.push(kind);
        out.extend_from_slice(head);
        out.extend_from_slice(body);
        let _ = self.tx.send(out);
    }

    pub fn json(&self, value: serde_json::Value) {
        self.emit(EVENT_STATE, value.to_string().as_bytes());
    }
}
