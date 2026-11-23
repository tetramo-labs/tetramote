//! A headless phone for testing a Tetramote host:
//! `cargo run --release --example probe -- --pair '<https://remote.tetramote.com/#...>' [--seconds 8] [--out /tmp/probe.h264] [--secret] [--guest] [--local-only --ticket <ticket>]`
//!
//! The phone key is kept at /tmp/tetramote-probe.key, so the first run pairs with the link's secret and later
//! runs reconnect as a trusted phone without it. `--guest` connects the way a browser does instead.

use std::collections::BTreeMap;
use std::io::Write;
use std::time::{Duration, Instant};

use tetra_core::protocol::{
    VideoHeader, EVENT_AUDIO, EVENT_CLOSED, EVENT_CONTROL, EVENT_STATE, EVENT_VIDEO,
    VIDEO_HEADER_LEN,
};
use tetra_core::{net, Client, ConnectRequest, EndpointConfig, Events};

const KEY_FILE: &str = "/tmp/tetramote-probe.key";

struct Args {
    pair: String,
    seconds: u64,
    out: String,
    local_only: bool,
    force_secret: bool,
    guest: bool,
    ticket: Option<String>,
}

fn parse_args() -> Result<Args, String> {
    let mut args = Args {
        pair: String::new(),
        seconds: 8,
        out: "/tmp/probe.h264".into(),
        local_only: false,
        force_secret: false,
        guest: false,
        ticket: None,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--pair" => args.pair = it.next().ok_or("--pair needs a URL")?,
            "--seconds" => {
                args.seconds = it
                    .next()
                    .and_then(|s| s.parse().ok())
                    .ok_or("--seconds needs a number")?
            }
            "--out" => args.out = it.next().ok_or("--out needs a path")?,
            "--local-only" => args.local_only = true,
            "--secret" => args.force_secret = true,
            "--guest" => args.guest = true,
            "--ticket" => args.ticket = Some(it.next().ok_or("--ticket needs a ticket")?),
            other => return Err(format!("unknown argument {other}")),
        }
    }
    if args.pair.is_empty() {
        return Err("--pair <https://remote.tetramote.com/#...> is required".into());
    }
    Ok(args)
}

fn phone_key() -> (String, bool) {
    if let Ok(key) = std::fs::read_to_string(KEY_FILE) {
        if net::endpoint_id_for(key.trim()).is_some() {
            return (key.trim().to_string(), false);
        }
    }
    let key = net::generate_secret_key();
    let _ = std::fs::write(KEY_FILE, &key);
    (key, true)
}

fn input_records() -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&9u16.to_be_bytes());
    out.push(0x01);
    out.extend_from_slice(&5f32.to_be_bytes());
    out.extend_from_slice(&5f32.to_be_bytes());
    out.extend_from_slice(&10u16.to_be_bytes());
    out.push(0x04);
    out.extend_from_slice(&0f32.to_be_bytes());
    out.extend_from_slice(&(-20f32).to_be_bytes());
    out.push(2);
    out
}

fn main() {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    let Some(link) = tetra_core::link::parse(&args.pair) else {
        eprintln!("--pair is not a Tetramote link");
        std::process::exit(2);
    };
    let (key, fresh) = phone_key();
    let secret = (fresh || args.force_secret || args.guest).then(|| link.secret.clone());

    let rt = tokio::runtime::Runtime::new().expect("runtime");
    let (events, rx) = Events::channel();
    let config = EndpointConfig {
        secret_key: key,
        relay_url: None,
        local_only: args.local_only,
    };
    let client = rt
        .block_on(Client::start(config, events))
        .unwrap_or_else(|e| {
            eprintln!("probe could not bind: {e}");
            std::process::exit(1);
        });
    {
        let _guard = rt.enter();
        client.connect(ConnectRequest {
            ticket: args.ticket.clone(),
            endpoint_id: link.endpoint_id.clone(),
            pairing_secret: secret.clone(),
            device_name: "Probe".into(),
            guest: args.guest,
            stream: None,
            timeout_ms: 20_000,
        });
    }

    let mut out = std::fs::File::create(&args.out).expect("output file");
    let mut frames = 0u64;
    let mut keyframes = 0u64;
    let mut bytes = 0u64;
    let mut audio = 0u64;
    let mut controls: BTreeMap<String, u64> = BTreeMap::new();
    let mut video_config = serde_json::Value::Null;
    let mut connected = serde_json::Value::Null;
    let mut path = serde_json::Value::Null;
    let mut outcome = String::from("timeout");
    let mut deadline = Instant::now() + Duration::from_secs(25);
    let mut sent_input = false;

    while Instant::now() < deadline {
        let left = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = rx.recv_timeout(left.min(Duration::from_millis(250))) else {
            continue;
        };
        let (kind, body) = (event[0], &event[1..]);
        match kind {
            EVENT_STATE => {
                let v: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
                match v["type"].as_str() {
                    Some("connected") => {
                        connected = v.clone();
                        outcome = "connected".into();
                        deadline = Instant::now() + Duration::from_secs(args.seconds);
                    }
                    Some("path") => path = v.clone(),
                    Some("rejected") => {
                        outcome = format!("rejected:{}", v["reason"].as_str().unwrap_or(""));
                        break;
                    }
                    Some("disconnected") => {
                        outcome = format!("disconnected:{}", v["reason"].as_str().unwrap_or(""));
                        break;
                    }
                    _ => {}
                }
            }
            EVENT_CONTROL => {
                let v: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
                let t = v["t"].as_str().unwrap_or("?").to_string();
                if t == "video" {
                    video_config = v.clone();
                }
                *controls.entry(t).or_default() += 1;
            }
            EVENT_VIDEO => {
                let Some(header) = VideoHeader::decode(body) else {
                    continue;
                };
                let data = &body[VIDEO_HEADER_LEN..];
                frames += 1;
                if header.is_keyframe() {
                    keyframes += 1;
                }
                bytes += data.len() as u64;
                let _ = out.write_all(data);
                if !sent_input {
                    sent_input = true;
                    client.send_input(&input_records());
                    client.send_control(br#"{"t":"getClipboard"}"#);
                }
            }
            EVENT_AUDIO => audio += 1,
            EVENT_CLOSED => break,
            _ => {}
        }
    }

    let seconds = args.seconds as f64;
    let summary = serde_json::json!({
        "outcome": outcome,
        "pairedWithSecret": secret.is_some(),
        "hostName": connected["hostName"],
        "pairedNow": connected["paired"],
        "frames": frames,
        "keyframes": keyframes,
        "bytes": bytes,
        "kbps": (bytes as f64 * 8.0 / 1000.0 / seconds).round(),
        "audioPackets": audio,
        "controls": controls,
        "video": video_config,
        "path": path["path"].as_str().or(connected["path"].as_str()),
        "rttMs": path["rttMs"].as_u64().or(connected["rttMs"].as_u64()),
        "out": args.out,
    });
    println!("{}", serde_json::to_string_pretty(&summary).unwrap());
    rt.block_on(client.close());
    if keyframes == 0 {
        std::process::exit(1);
    }
}
