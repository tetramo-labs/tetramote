//! Wire format shared by the host and the phone. `PROTOCOL.md` at the repo root
//! is the spec; a change here changes it in the same commit.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const ALPN: &[u8] = b"tetramote/1";
pub const PROTOCOL_VERSION: u32 = 2;

pub const STREAM_VIDEO: u8 = 0x01;
pub const STREAM_INPUT: u8 = 0x10;
pub const DATAGRAM_AUDIO: u8 = 0x02;

pub const FLAG_KEYFRAME: u8 = 0x01;

pub const MAX_CONTROL_MESSAGE: usize = 1 << 20;
pub const MAX_VIDEO_FRAME: usize = 16 << 20;
pub const MAX_INPUT_RECORD: usize = 1024;

pub const VIDEO_HEADER_LEN: usize = 13;
pub const AUDIO_HEADER_LEN: usize = 12;

pub const EVENT_CLOSED: u8 = 0;
pub const EVENT_STATE: u8 = 1;
pub const EVENT_CONTROL: u8 = 2;
pub const EVENT_INPUT: u8 = 3;
pub const EVENT_VIDEO: u8 = 4;
pub const EVENT_AUDIO: u8 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoHeader {
    pub seq: u32,
    pub pts_us: u64,
    pub flags: u8,
}

impl VideoHeader {
    pub fn encode(&self) -> [u8; VIDEO_HEADER_LEN] {
        let mut out = [0u8; VIDEO_HEADER_LEN];
        out[0..4].copy_from_slice(&self.seq.to_be_bytes());
        out[4..12].copy_from_slice(&self.pts_us.to_be_bytes());
        out[12] = self.flags;
        out
    }

    pub fn decode(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < VIDEO_HEADER_LEN {
            return None;
        }
        Some(Self {
            seq: u32::from_be_bytes(bytes[0..4].try_into().ok()?),
            pts_us: u64::from_be_bytes(bytes[4..12].try_into().ok()?),
            flags: bytes[12],
        })
    }

    pub fn is_keyframe(&self) -> bool {
        self.flags & FLAG_KEYFRAME != 0
    }
}

pub fn encode_audio_datagram(seq: u32, pts_us: u64, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(1 + AUDIO_HEADER_LEN + payload.len());
    out.push(DATAGRAM_AUDIO);
    out.extend_from_slice(&seq.to_be_bytes());
    out.extend_from_slice(&pts_us.to_be_bytes());
    out.extend_from_slice(payload);
    out
}

/// Returns the datagram minus its type byte (`seq`, `pts`, payload), the layout
/// of an `EVENT_AUDIO` event body.
pub fn audio_event_body(datagram: &[u8]) -> Option<&[u8]> {
    match datagram.split_first() {
        Some((&DATAGRAM_AUDIO, rest)) if rest.len() >= AUDIO_HEADER_LEN => Some(rest),
        _ => None,
    }
}

pub async fn write_message<W: AsyncWrite + Unpin>(w: &mut W, body: &[u8]) -> std::io::Result<()> {
    if body.len() > MAX_CONTROL_MESSAGE {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "control message over 1 MiB",
        ));
    }
    let mut frame = Vec::with_capacity(4 + body.len());
    frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
    frame.extend_from_slice(body);
    w.write_all(&frame).await
}

/// Reads one length-prefixed control message; `None` when the stream ended
/// cleanly between messages.
pub async fn read_message<R: AsyncRead + Unpin>(r: &mut R) -> std::io::Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_be_bytes(len) as usize;
    if len > MAX_CONTROL_MESSAGE {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "control message over 1 MiB",
        ));
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).await?;
    Ok(Some(body))
}

/// Reads one input record (`type` byte plus payload, without its length).
pub async fn read_input_record<R: AsyncRead + Unpin>(
    r: &mut R,
) -> std::io::Result<Option<Vec<u8>>> {
    let mut len = [0u8; 2];
    match r.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u16::from_be_bytes(len) as usize;
    if len == 0 || len > MAX_INPUT_RECORD {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "input record length out of range",
        ));
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).await?;
    Ok(Some(body))
}

#[derive(Debug, Clone, Deserialize)]
pub struct Hello {
    pub t: String,
    pub v: u32,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub secret: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Auth {
    Trusted,
    Paired,
    Rejected(&'static str),
}

pub fn authorize(
    remote_id: &str,
    hello: &Hello,
    trusted: &HashSet<String>,
    pairing_secret: Option<&str>,
) -> Auth {
    if hello.t != "hello" {
        return Auth::Rejected("badHello");
    }
    if hello.v != PROTOCOL_VERSION {
        return Auth::Rejected("version");
    }
    if trusted.contains(remote_id) {
        return Auth::Trusted;
    }
    match (hello.secret.as_deref(), pairing_secret) {
        (Some(offered), Some(expected))
            if !expected.is_empty() && constant_time_eq(offered, expected) =>
        {
            Auth::Paired
        }
        (Some(_), _) => Auth::Rejected("badSecret"),
        (None, _) => Auth::Rejected("notPaired"),
    }
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Decides which received frames the decoder may see. H.264 P-frames reference
/// the previous frame, so after any gap everything up to the next keyframe is
/// dropped and a keyframe is requested, at most once per `retry`.
#[derive(Debug)]
pub struct FrameGate {
    expected: Option<u32>,
    waiting_key: bool,
    last_request: Option<Instant>,
    retry: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GateDecision {
    pub deliver: bool,
    pub request_keyframe: bool,
}

impl FrameGate {
    pub fn new(retry: Duration) -> Self {
        Self {
            expected: None,
            waiting_key: true,
            last_request: None,
            retry,
        }
    }

    pub fn on_frame(&mut self, header: &VideoHeader, now: Instant) -> GateDecision {
        if self.expected.is_some_and(|e| e != header.seq) {
            self.waiting_key = true;
        }
        self.expected = Some(header.seq.wrapping_add(1));
        if header.is_keyframe() {
            self.waiting_key = false;
            self.last_request = None;
        }
        if !self.waiting_key {
            return GateDecision {
                deliver: true,
                request_keyframe: false,
            };
        }
        GateDecision {
            deliver: false,
            request_keyframe: self.take_request(now),
        }
    }

    pub fn on_lost(&mut self, now: Instant) -> bool {
        self.waiting_key = true;
        self.take_request(now)
    }

    fn take_request(&mut self, now: Instant) -> bool {
        let due = self
            .last_request
            .is_none_or(|t| now.duration_since(t) >= self.retry);
        if due {
            self.last_request = Some(now);
        }
        due
    }
}

pub fn hex_encode(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 0xf) as usize] as char);
    }
    out
}

pub fn hex_decode_32(s: &str) -> Option<[u8; 32]> {
    let s = s.trim();
    if s.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, chunk) in s.as_bytes().chunks(2).enumerate() {
        let hi = (chunk[0] as char).to_digit(16)?;
        let lo = (chunk[1] as char).to_digit(16)?;
        out[i] = (hi * 16 + lo) as u8;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hello(secret: Option<&str>) -> Hello {
        Hello {
            t: "hello".into(),
            v: 2,
            name: "Duo".into(),
            secret: secret.map(Into::into),
        }
    }

    #[test]
    fn video_header_layout_is_big_endian() {
        let h = VideoHeader {
            seq: 0x01020304,
            pts_us: 0x1122334455667788,
            flags: FLAG_KEYFRAME,
        };
        assert_eq!(
            h.encode(),
            [1, 2, 3, 4, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 1]
        );
        assert_eq!(VideoHeader::decode(&h.encode()), Some(h));
        assert_eq!(VideoHeader::decode(&[0; 12]), None);
    }

    #[test]
    fn audio_datagram_round_trip() {
        let d = encode_audio_datagram(7, 1000, &[0xaa, 0xbb]);
        assert_eq!(d, [2, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0x03, 0xe8, 0xaa, 0xbb]);
        assert_eq!(
            audio_event_body(&d),
            Some(&[0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0x03, 0xe8, 0xaa, 0xbb][..])
        );
        assert_eq!(audio_event_body(&[2, 0, 0]), None);
        assert_eq!(audio_event_body(&[9; 20]), None);
    }

    #[tokio::test]
    async fn control_messages_are_length_prefixed() {
        let mut buf = Vec::new();
        write_message(&mut buf, b"{}").await.unwrap();
        assert_eq!(buf, [0, 0, 0, 2, b'{', b'}']);
        let mut r = &buf[..];
        assert_eq!(read_message(&mut r).await.unwrap(), Some(b"{}".to_vec()));
        assert_eq!(read_message(&mut r).await.unwrap(), None);
    }

    #[tokio::test]
    async fn input_records_reject_zero_and_oversized_lengths() {
        let mut r = &[0u8, 3, 1, 2, 3][..];
        assert_eq!(
            read_input_record(&mut r).await.unwrap(),
            Some(vec![1, 2, 3])
        );
        assert!(read_input_record(&mut &[0u8, 0][..]).await.is_err());
        assert!(read_input_record(&mut &[0x10u8, 0][..]).await.is_err());
    }

    #[test]
    fn authorize_trusted_paired_and_rejected() {
        let trusted: HashSet<String> = ["known".to_string()].into();
        assert_eq!(
            authorize("known", &hello(None), &trusted, None),
            Auth::Trusted
        );
        assert_eq!(
            authorize("new", &hello(Some("s3cret")), &trusted, Some("s3cret")),
            Auth::Paired
        );
        assert_eq!(
            authorize("new", &hello(Some("guess")), &trusted, Some("s3cret")),
            Auth::Rejected("badSecret")
        );
        assert_eq!(
            authorize("new", &hello(Some("s3cret")), &trusted, None),
            Auth::Rejected("badSecret")
        );
        assert_eq!(
            authorize("new", &hello(Some("")), &trusted, Some("")),
            Auth::Rejected("badSecret")
        );
        assert_eq!(
            authorize("new", &hello(None), &trusted, Some("s3cret")),
            Auth::Rejected("notPaired")
        );
        let mut old = hello(None);
        old.v = 1;
        assert_eq!(
            authorize("known", &old, &trusted, None),
            Auth::Rejected("version")
        );
    }

    fn frame(seq: u32, key: bool) -> VideoHeader {
        VideoHeader {
            seq,
            pts_us: 0,
            flags: if key { FLAG_KEYFRAME } else { 0 },
        }
    }

    #[test]
    fn gate_waits_for_first_keyframe_then_drops_after_gap() {
        let t0 = Instant::now();
        let mut g = FrameGate::new(Duration::from_millis(300));
        let deliver = |d: GateDecision| d.deliver;

        let first = g.on_frame(&frame(0, false), t0);
        assert_eq!(
            first,
            GateDecision {
                deliver: false,
                request_keyframe: true
            }
        );
        assert!(!g.on_frame(&frame(1, false), t0).request_keyframe);
        assert!(deliver(g.on_frame(&frame(2, true), t0)));
        assert!(deliver(g.on_frame(&frame(3, false), t0)));

        let gap = g.on_frame(&frame(5, false), t0 + Duration::from_millis(10));
        assert_eq!(
            gap,
            GateDecision {
                deliver: false,
                request_keyframe: true
            }
        );
        assert!(
            !g.on_frame(&frame(6, false), t0 + Duration::from_millis(100))
                .request_keyframe
        );
        assert!(
            g.on_frame(&frame(7, false), t0 + Duration::from_millis(400))
                .request_keyframe
        );
        assert!(deliver(
            g.on_frame(&frame(8, true), t0 + Duration::from_millis(500))
        ));
    }

    #[test]
    fn gate_treats_a_lost_stream_as_a_gap() {
        let t0 = Instant::now();
        let mut g = FrameGate::new(Duration::from_millis(300));
        assert!(g.on_frame(&frame(0, true), t0).deliver);
        assert!(g.on_lost(t0));
        assert!(!g.on_frame(&frame(2, false), t0).deliver);
        assert!(g.on_frame(&frame(3, true), t0).deliver);
    }

    #[test]
    fn gate_follows_sequence_wraparound() {
        let t0 = Instant::now();
        let mut g = FrameGate::new(Duration::from_millis(300));
        assert!(g.on_frame(&frame(u32::MAX, true), t0).deliver);
        assert!(g.on_frame(&frame(0, false), t0).deliver);
    }

    #[test]
    fn hex_round_trip() {
        let key = [0xabu8; 32];
        assert_eq!(hex_encode(&[0x01, 0xfe]), "01fe");
        assert_eq!(hex_decode_32(&hex_encode(&key)), Some(key));
        assert_eq!(hex_decode_32("zz"), None);
    }
}
