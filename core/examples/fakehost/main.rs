//! A stand-in Mac for testing the phone app: streams an Annex B H.264 file
//! (encoded with access unit delimiters) and optionally an Ogg Opus file of
//! 20 ms packets over the real protocol, logs every event it receives as JSON
//! lines, and answers clipboard and display requests.
//!
//! ffmpeg -f lavfi -i testsrc2=size=1280x800:rate=30 -t 10 -c:v libx264 -bf 0 -g 30 \
//!   -x264-params aud=1:repeat-headers=1 -pix_fmt yuv420p -f h264 test.h264
//! ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000 -ac 2 -t 10 -c:a libopus -b:a 128k \
//!   -frame_duration 20 -application lowdelay test.ogg
//! cargo run --release --example fakehost -- --h264 test.h264 --opus test.ogg --pairing-file /tmp/pair.txt

mod ogg;

use std::fs;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use tetra_core::protocol::{hex_encode, EVENT_CONTROL, EVENT_INPUT, EVENT_STATE, FLAG_KEYFRAME};
use tetra_core::{EndpointConfig, Events, Host, HostConfig};

struct Args {
    h264: String,
    opus: Option<String>,
    fps: u32,
    pairing_file: Option<String>,
    log: Option<String>,
    local_only: bool,
}

fn parse_args() -> Args {
    let mut args = Args {
        h264: String::new(),
        opus: None,
        fps: 30,
        pairing_file: None,
        log: None,
        local_only: false,
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        match flag.as_str() {
            "--h264" => args.h264 = it.next().expect("--h264 <file>"),
            "--opus" => args.opus = it.next(),
            "--fps" => args.fps = it.next().and_then(|v| v.parse().ok()).expect("--fps <n>"),
            "--pairing-file" => args.pairing_file = it.next(),
            "--log" => args.log = it.next(),
            "--local-only" => args.local_only = true,
            other => panic!("unknown flag {other}"),
        }
    }
    assert!(!args.h264.is_empty(), "--h264 <file> is required");
    args
}

struct AccessUnit {
    data: Vec<u8>,
    key: bool,
}

fn nal_starts(data: &[u8]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i + 3 <= data.len() {
        if data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
            let start = if i > 0 && data[i - 1] == 0 { i - 1 } else { i };
            out.push((start, i + 3));
            i += 3;
        } else {
            i += 1;
        }
    }
    out
}

fn split_access_units(data: &[u8]) -> Vec<AccessUnit> {
    let starts = nal_starts(data);
    let mut units = Vec::new();
    let mut current: Option<(usize, bool)> = None;
    for (n, &(start, payload)) in starts.iter().enumerate() {
        let kind = data.get(payload).map(|b| b & 0x1f).unwrap_or(0);
        if kind == 9 {
            if let Some((from, key)) = current.take() {
                units.push(AccessUnit {
                    data: data[from..start].to_vec(),
                    key,
                });
            }
            current = Some((start, false));
        }
        if kind == 5 {
            if let Some((_, key)) = current.as_mut() {
                *key = true;
            }
        }
        if n == starts.len() - 1 {
            if let Some((from, key)) = current.take() {
                units.push(AccessUnit {
                    data: data[from..].to_vec(),
                    key,
                });
            }
        }
    }
    units
}

fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn random_hex(len: usize) -> String {
    let key = tetra_core::net::generate_secret_key();
    key[..len].to_string()
}

fn decode_input(record: &[u8]) -> serde_json::Value {
    let f = |at: usize| f32::from_be_bytes(record[at..at + 4].try_into().unwrap_or([0; 4]));
    match record.first() {
        Some(0x01) if record.len() >= 9 => {
            serde_json::json!({"input": "move", "dx": f(1), "dy": f(5)})
        }
        Some(0x02) if record.len() >= 9 => {
            serde_json::json!({"input": "moveTo", "x": f(1), "y": f(5)})
        }
        Some(0x03) if record.len() >= 4 => {
            serde_json::json!({"input": "button", "button": record[1], "down": record[2], "clicks": record[3]})
        }
        Some(0x04) if record.len() >= 10 => {
            serde_json::json!({"input": "scroll", "dx": f(1), "dy": f(5), "phase": record[9]})
        }
        Some(0x05) if record.len() >= 8 => serde_json::json!({
            "input": "key",
            "keyCode": u16::from_be_bytes([record[1], record[2]]),
            "down": record[3],
            "flags": u32::from_be_bytes(record[4..8].try_into().unwrap()),
        }),
        Some(0x06) => {
            serde_json::json!({"input": "text", "text": String::from_utf8_lossy(&record[1..])})
        }
        _ => serde_json::json!({"input": "unknown", "bytes": hex_encode(record)}),
    }
}

fn main() {
    let args = parse_args();
    let video = split_access_units(&fs::read(&args.h264).expect("read --h264"));
    assert!(
        video.iter().any(|u| u.key),
        "the H.264 file has no IDR frames"
    );
    let audio = args.opus.as_ref().map(|p| {
        ogg::opus_packets(&fs::read(p).expect("read --opus"))
            .unwrap_or_else(|e| panic!("--opus {p}: {e}"))
    });
    eprintln!(
        "fakehost: {} video frames ({} keyframes), {} audio packets",
        video.len(),
        video.iter().filter(|u| u.key).count(),
        audio.as_ref().map_or(0, Vec::len)
    );

    let key_path = "/tmp/tetratop-fakehost.key";
    let secret_key = fs::read_to_string(key_path)
        .ok()
        .filter(|k| k.trim().len() == 64)
        .unwrap_or_else(|| {
            let k = tetra_core::net::generate_secret_key();
            fs::write(key_path, &k).unwrap();
            k
        });
    let pairing_secret = random_hex(32);
    let (events, rx) = Events::channel();
    let runtime = tetra_core::net::runtime();
    let host = Arc::new(
        runtime
            .block_on(Host::start(
                HostConfig {
                    endpoint: EndpointConfig {
                        secret_key: secret_key.trim().to_string(),
                        relay_url: None,
                        local_only: args.local_only,
                    },
                    host_name: "Fake Mac".into(),
                    trusted: Vec::new(),
                    pairing_secret: Some(pairing_secret.clone()),
                },
                events,
            ))
            .expect("host start"),
    );

    let log = Arc::new(Mutex::new(
        args.log
            .as_ref()
            .map(|p| fs::File::create(p).expect("create --log")),
    ));
    let write_log = {
        let log = log.clone();
        move |v: serde_json::Value| {
            println!("{v}");
            if let Some(f) = log.lock().unwrap().as_mut() {
                let _ = writeln!(f, "{v}");
            }
        }
    };

    let streaming = Arc::new(AtomicBool::new(false));
    let next_frame = Arc::new(AtomicUsize::new(0));
    let video = Arc::new(video);
    let (width, height) = (1280, 800);

    let start_stream = {
        let host = host.clone();
        let streaming = streaming.clone();
        let next_frame = next_frame.clone();
        let video = video.clone();
        let audio = audio.clone();
        let fps = args.fps;
        move || {
            if streaming.swap(true, Ordering::SeqCst) {
                return;
            }
            next_frame.store(0, Ordering::SeqCst);
            let host_v = host.clone();
            let streaming_v = streaming.clone();
            let video = video.clone();
            let next_frame = next_frame.clone();
            std::thread::spawn(move || {
                let started = Instant::now();
                let interval = Duration::from_secs_f64(1.0 / f64::from(fps));
                let mut tick = 0u64;
                while streaming_v.load(Ordering::SeqCst) {
                    let i = next_frame.fetch_add(1, Ordering::SeqCst) % video.len();
                    let unit = &video[i];
                    let flags = if unit.key { FLAG_KEYFRAME } else { 0 };
                    let pts = started.elapsed().as_micros() as u64;
                    if host_v.send_video(pts, flags, &unit.data) == 1 {
                        let k = (i + 1..video.len()).find(|&j| video[j].key).unwrap_or(0);
                        next_frame.store(k, Ordering::SeqCst);
                    }
                    tick += 1;
                    let due = started + interval * tick as u32;
                    std::thread::sleep(due.saturating_duration_since(Instant::now()));
                }
            });
            if let Some(packets) = audio.clone() {
                let host_a = host.clone();
                let streaming_a = streaming.clone();
                std::thread::spawn(move || {
                    let started = Instant::now();
                    let interval = Duration::from_millis(20);
                    let mut n = 0u32;
                    while streaming_a.load(Ordering::SeqCst) {
                        let packet = &packets[n as usize % packets.len()];
                        host_a.send_audio(started.elapsed().as_micros() as u64, packet);
                        n += 1;
                        std::thread::sleep(
                            (started + interval * n).saturating_duration_since(Instant::now()),
                        );
                    }
                });
            }
        }
    };

    let video_message = |display: u64| {
        serde_json::json!({
            "t": "video", "codec": "h264", "width": width, "height": height,
            "pointWidth": width, "pointHeight": height, "displayId": display,
        })
        .to_string()
    };

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    ctrlc_like(stop_tx);
    loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }
        let Ok(event) = rx.recv_timeout(Duration::from_millis(250)) else {
            continue;
        };
        let (kind, body) = (event[0], &event[1..]);
        match kind {
            EVENT_STATE => {
                let v: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
                match v["type"].as_str() {
                    Some("ticket") => {
                        let url = format!(
                            "tetratop://pair?ticket={}&secret={}&name={}",
                            v["ticket"].as_str().unwrap_or(""),
                            pairing_secret,
                            percent_encode("Fake Mac")
                        );
                        eprintln!("pairing URL: {url}");
                        if let Some(p) = &args.pairing_file {
                            fs::write(p, &url).unwrap();
                        }
                        continue;
                    }
                    Some("peerConnected") => {
                        host.send_control(
                            br#"{"t":"status","screenRecording":true,"accessibility":true}"#,
                        );
                        host.send_control(
                            serde_json::json!({"t": "displays", "active": 1, "displays": [
                                {"id": 1, "name": "Built-in Retina Display", "width": 2560, "height": 1600, "main": true},
                                {"id": 2, "name": "Studio Display", "width": 5120, "height": 2880, "main": false},
                            ]})
                            .to_string()
                            .as_bytes(),
                        );
                        host.send_control(video_message(1).as_bytes());
                        if audio.is_some() {
                            host.send_control(
                                br#"{"t":"audio","codec":"opus","sampleRate":48000,"channels":2,"frameMs":20}"#,
                            );
                        }
                        start_stream();
                    }
                    Some("peerDisconnected") => streaming.store(false, Ordering::SeqCst),
                    _ => {}
                }
                write_log(v);
            }
            EVENT_CONTROL => {
                let v: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
                match v["t"].as_str() {
                    Some("keyframe") => {
                        let i = next_frame.load(Ordering::SeqCst) % video.len();
                        let k = (i..video.len())
                            .chain(0..i)
                            .find(|&j| video[j].key)
                            .unwrap_or(0);
                        next_frame.store(k, Ordering::SeqCst);
                    }
                    Some("getClipboard") => {
                        host.send_control(br#"{"t":"clipboard","text":"hello from fakehost"}"#);
                    }
                    Some("selectDisplay") => {
                        let id = v["id"].as_u64().unwrap_or(1);
                        host.send_control(video_message(id).as_bytes());
                    }
                    _ => {}
                }
                write_log(serde_json::json!({"control": v}));
            }
            EVENT_INPUT => write_log(decode_input(body)),
            _ => {}
        }
    }
    streaming.store(false, Ordering::SeqCst);
    runtime.block_on(host.close());
}

fn ctrlc_like(tx: mpsc::Sender<()>) {
    if let Ok(seconds) = std::env::var("FAKEHOST_SECONDS").map(|s| s.parse::<u64>().unwrap_or(0)) {
        if seconds > 0 {
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(seconds));
                let _ = tx.send(());
            });
        }
    }
}
