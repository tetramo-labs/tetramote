use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use tetra_core::protocol::{
    hex_encode, VideoHeader, EVENT_AUDIO, EVENT_CONTROL, EVENT_INPUT, EVENT_STATE, EVENT_VIDEO,
    FLAG_KEYFRAME,
};
use tetra_core::{Client, ConnectRequest, EndpointConfig, Events, Host, HostConfig};

fn local(seed: u8) -> EndpointConfig {
    EndpointConfig {
        secret_key: hex_encode(&[seed; 32]),
        relay_url: None,
        local_only: true,
    }
}

fn wait_for(rx: &Receiver<Vec<u8>>, mut pred: impl FnMut(u8, &[u8]) -> bool) -> Vec<u8> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let event = rx.recv_timeout(left).expect("timed out waiting for event");
        if pred(event[0], &event[1..]) {
            return event;
        }
    }
}

fn state_type(kind: u8, body: &[u8], ty: &str) -> bool {
    kind == EVENT_STATE
        && serde_json::from_slice::<serde_json::Value>(body).is_ok_and(|v| v["type"] == ty)
}

fn json(body: &[u8]) -> serde_json::Value {
    serde_json::from_slice(body).unwrap()
}

async fn host(trusted: Vec<String>, secret: Option<&str>) -> (Host, Receiver<Vec<u8>>) {
    let (events, rx) = Events::channel();
    let host = Host::start(
        HostConfig {
            endpoint: local(1),
            host_name: "Studio Mac".into(),
            trusted,
            pairing_secret: secret.map(Into::into),
        },
        events,
    )
    .await
    .unwrap();
    (host, rx)
}

async fn client(seed: u8) -> (Client, Receiver<Vec<u8>>) {
    let (events, rx) = Events::channel();
    (Client::start(local(seed), events).await.unwrap(), rx)
}

fn request(host: &Host, secret: Option<&str>) -> ConnectRequest {
    ConnectRequest {
        ticket: Some(host.ticket()),
        endpoint_id: host.endpoint().id().to_string(),
        pairing_secret: secret.map(Into::into),
        device_name: "Duo".into(),
        guest: false,
        timeout_ms: 5000,
    }
}

fn guest_request(host: &Host, secret: &str) -> ConnectRequest {
    ConnectRequest {
        device_name: "Safari on Mac".into(),
        guest: true,
        ..request(host, Some(secret))
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn pairs_then_streams_video_audio_input_and_control() {
    let (host, host_rx) = host(vec![], Some("one-time")).await;
    let (client, client_rx) = client(2).await;
    let phone_id = client.endpoint().id().to_string();

    client.connect(request(&host, Some("one-time")));
    let connected = wait_for(&client_rx, |k, b| state_type(k, b, "connected"));
    assert_eq!(json(&connected[1..])["hostName"], "Studio Mac");
    assert_eq!(json(&connected[1..])["paired"], true);
    let welcome = wait_for(&client_rx, |k, _| k == EVENT_CONTROL);
    assert_eq!(json(&welcome[1..])["t"], "welcome");

    let paired = wait_for(&host_rx, |k, b| state_type(k, b, "paired"));
    assert_eq!(json(&paired[1..])["id"], phone_id);
    assert_eq!(json(&paired[1..])["name"], "Duo");
    wait_for(&host_rx, |k, b| state_type(k, b, "peerConnected"));

    assert_eq!(host.send_video(10, 0, b"before-key"), 0);
    assert_eq!(host.send_video(20, FLAG_KEYFRAME, b"key"), 0);
    assert_eq!(host.send_video(30, 0, b"delta"), 0);
    let first = wait_for(&client_rx, |k, _| k == EVENT_VIDEO);
    let header = VideoHeader::decode(&first[1..]).unwrap();
    assert_eq!(
        (header.seq, header.pts_us, header.is_keyframe()),
        (1, 20, true)
    );
    assert_eq!(&first[14..], b"key");
    let second = wait_for(&client_rx, |k, _| k == EVENT_VIDEO);
    assert_eq!(VideoHeader::decode(&second[1..]).unwrap().seq, 2);
    assert_eq!(&second[14..], b"delta");
    let keyframe_request = wait_for(&host_rx, |k, _| k == EVENT_CONTROL);
    assert_eq!(json(&keyframe_request[1..])["t"], "keyframe");

    assert_eq!(host.send_audio(99, &[1, 2, 3]), 0);
    let audio = wait_for(&client_rx, |k, _| k == EVENT_AUDIO);
    assert_eq!(&audio[1..], &[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 99, 1, 2, 3]);

    assert_eq!(client.send_input(&[0, 3, 0x05, 0xaa, 0xbb, 0, 1, 0x07]), 0);
    let a = wait_for(&host_rx, |k, _| k == EVENT_INPUT);
    assert_eq!(&a[1..], &[0x05, 0xaa, 0xbb]);
    let b = wait_for(&host_rx, |k, _| k == EVENT_INPUT);
    assert_eq!(&b[1..], &[0x07]);

    assert_eq!(client.send_control(br#"{"t":"getClipboard"}"#), 0);
    let ctl = wait_for(&host_rx, |k, b| {
        k == EVENT_CONTROL && json(b)["t"] == "getClipboard"
    });
    assert_eq!(json(&ctl[1..])["t"], "getClipboard");
    assert_eq!(host.send_control(br#"{"t":"clipboard","text":"hi"}"#), 0);
    let clip = wait_for(&client_rx, |k, b| {
        k == EVENT_CONTROL && json(b)["t"] == "clipboard"
    });
    assert_eq!(json(&clip[1..])["text"], "hi");

    client.disconnect();
    wait_for(&host_rx, |k, b| state_type(k, b, "peerDisconnected"));
    assert_eq!(host.send_video(40, FLAG_KEYFRAME, b"k"), -2);

    client.connect(request(&host, None));
    let again = wait_for(&client_rx, |k, b| state_type(k, b, "connected"));
    assert_eq!(json(&again[1..])["paired"], false);

    client.close().await;
    host.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_link_secret_pairs_many_devices_until_it_changes() {
    let (host, host_rx) = host(vec![], Some("0123456789abcdef0123456789abcdef")).await;
    let (stranger, stranger_rx) = client(3).await;
    stranger.connect(request(&host, None));
    let rejected = wait_for(&stranger_rx, |k, b| state_type(k, b, "rejected"));
    assert_eq!(json(&rejected[1..])["reason"], "notPaired");
    wait_for(&host_rx, |k, b| state_type(k, b, "rejected"));

    let (first, first_rx) = client(4).await;
    first.connect(request(&host, Some("0123456789abcdef0123456789abcdef")));
    wait_for(&first_rx, |k, b| state_type(k, b, "connected"));
    wait_for(&host_rx, |k, b| state_type(k, b, "paired"));

    stranger.connect(request(&host, Some("0123456789abcdef0123456789abcdef")));
    let second = wait_for(&stranger_rx, |k, b| state_type(k, b, "connected"));
    assert_eq!(json(&second[1..])["paired"], true);

    host.set_pairing_secret(Some("fedcba9876543210fedcba9876543210".into()));
    let (late, late_rx) = client(6).await;
    late.connect(request(&host, Some("0123456789abcdef0123456789abcdef")));
    let old_link = wait_for(&late_rx, |k, b| state_type(k, b, "rejected"));
    assert_eq!(json(&old_link[1..])["reason"], "badSecret");

    first.connect(request(&host, None));
    wait_for(&first_rx, |k, b| state_type(k, b, "connected"));

    late.close().await;
    stranger.close().await;
    first.close().await;
    host.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_guest_stays_untrusted_and_leaves_when_the_link_changes() {
    let secret = "0123456789abcdef0123456789abcdef";
    let (host, host_rx) = host(vec![], Some(secret)).await;
    let (browser, browser_rx) = client(7).await;
    browser.connect(guest_request(&host, secret));
    let welcome = wait_for(&browser_rx, |k, b| state_type(k, b, "connected"));
    assert_eq!(json(&welcome[1..])["paired"], false);
    let peer = wait_for(&host_rx, |k, b| state_type(k, b, "peerConnected"));
    assert_eq!(json(&peer[1..])["guest"], true);
    assert_eq!(json(&peer[1..])["name"], "Safari on Mac");

    host.set_pairing_secret(Some(secret.into()));
    host.set_pairing_secret(Some("fedcba9876543210fedcba9876543210".into()));
    let gone = wait_for(&browser_rx, |k, b| state_type(k, b, "disconnected"));
    assert!(json(&gone[1..])["reason"]
        .as_str()
        .unwrap()
        .contains("linkChanged"));

    browser.connect(request(&host, None));
    let untrusted = wait_for(&browser_rx, |k, b| state_type(k, b, "rejected"));
    assert_eq!(json(&untrusted[1..])["reason"], "notPaired");

    let (phone, phone_rx) = client(8).await;
    phone.connect(request(&host, Some("fedcba9876543210fedcba9876543210")));
    wait_for(&phone_rx, |k, b| state_type(k, b, "connected"));
    host.set_pairing_secret(Some("00000000000000000000000000000000".into()));
    assert!(phone_rx
        .recv_timeout(std::time::Duration::from_millis(500))
        .map_or(true, |e| !state_type(e[0], &e[1..], "disconnected")));

    phone.close().await;
    browser.close().await;
    host.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn revoking_a_trusted_phone_drops_its_session() {
    let (client, client_rx) = client(5).await;
    let id = client.endpoint().id().to_string();
    let (host, host_rx) = host(vec![id], None).await;
    client.connect(request(&host, None));
    wait_for(&client_rx, |k, b| state_type(k, b, "connected"));
    wait_for(&host_rx, |k, b| state_type(k, b, "peerConnected"));

    host.set_trusted(vec![]);
    wait_for(&client_rx, |k, b| state_type(k, b, "disconnected"));
    client.connect(request(&host, None));
    let rejected = wait_for(&client_rx, |k, b| state_type(k, b, "rejected"));
    assert_eq!(json(&rejected[1..])["reason"], "notPaired");

    client.close().await;
    host.close().await;
}
