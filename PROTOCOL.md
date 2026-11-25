# Tetramote wire protocol, version 2

The phone dials the Mac over [iroh](https://iroh.computer) with ALPN `tetramote/1`. The ALPN stays the same
across protocol versions, so a phone and a Mac on different versions still get as far as `rejected` with
reason `version`. iroh authenticates both ends by their endpoint keys, so a link only needs to carry the
computer's endpoint id and a secret. Everything below is big-endian. `core/src/protocol.rs`
implements the framing; a change to either changes both in the same commit.

## Links and pairing

A computer shares one link, as a QR code and as text:

```
https://remote.tetramote.com/#id=<endpoint id, 64 hex chars>&secret=<32 hex chars>&name=<url-encoded computer name>
```

Browsers never send what follows `#` to a server, so the secret stays between the devices. `core/src/link.rs`
writes and reads the link. The secret is reusable: it lasts until the computer makes a new link. Dialers find the
computer by its endpoint id through iroh's address lookup, so the link never goes stale.

A `hello` with the current secret either pairs or joins as a guest:

- The phone and desktop apps pair. The computer adds their endpoint id to its trusted list and accepts them
  without a secret from then on, through later link changes, until the device is removed. An app keeps the
  computer's endpoint id (and the last ticket it saw, if any) to redial.
- A browser at remote.tetramote.com sends `guest: true`. The computer admits it for that connection only and
  closes the connection with code 4 (`linkChanged`) when it makes a new link. Browsers can't send UDP, so they
  always reach the computer through an iroh relay.

## Connection layout

| Channel | Opened by | Carries |
| --- | --- | --- |
| Control bi-stream | phone, first | Length-prefixed JSON messages both ways |
| Input uni-stream | phone, after `welcome` | First byte `0x10`, then input records |
| One uni-stream per video frame | Mac | First byte `0x01`, frame header, H.264 access unit |
| Datagrams | Mac | First byte `0x02`, audio packet |

### Control messages

Each message is `u32 length` followed by that many bytes of UTF-8 JSON (at most 1 MiB). The `t` field
names the message.

The phone's first message is `hello`. The Mac answers it with `welcome` or with `rejected`, and closes
the connection after `rejected`. The Mac closes a connection with code 1 after `rejected`, 2 when another
device's connection replaces it, 3 when the device is removed, and 4 when the link a guest used changes.

| `t` | Direction | Fields |
| --- | --- | --- |
| `hello` | phone → Mac | `v` (2), `name` (device name), `secret` (the link's secret, when not yet trusted), `guest` (true from a browser), `stream` (optional: `maxLongEdge`, the viewer's display size in pixels; `resolution`, a long edge in pixels that overrides it; `bitrate`, a maximum in bits per second, without which the Mac adapts between 1.5 and 20 Mbps; `fps`, a maximum frame rate from 1 to 120, 60 when absent; `cursor`, whether the Mac draws its pointer into the video from the start, like `cursor`'s `shown`, true when absent) |
| `welcome` | Mac → phone | `v`, `hostName`, `paired` (true when this hello paired the phone) |
| `rejected` | Mac → phone | `reason`: `notPaired`, `badSecret`, `version` or `badHello` |
| `status` | Mac → phone | `screenRecording`, `accessibility` (Mac permissions granted) |
| `displays` | Mac → phone | `displays` (`[{id, name, width, height, main}]`), `active` (display id) |
| `video` | Mac → phone | `codec` (`h264`), `width`, `height` (stream pixels), `pointWidth`, `pointHeight` (display size in Mac points), `displayId`; sent whenever the stream changes |
| `audio` | Mac → phone | `codec` (`opus`), `sampleRate` (48000), `channels` (2), `frameMs` (20) |
| `clipboard` | both | `text` |
| `getClipboard` | phone → Mac | (none); the Mac answers with `clipboard` |
| `selectDisplay` | phone → Mac | `id` |
| `setAudio` | phone → Mac | `enabled` |
| `stream` | phone → Mac | the same object as `hello`'s `stream`; the Mac restarts the stream to match. Without one, the Mac streams up to 2560 pixels at 8 to 20 Mbps |
| `cursor` | phone → Mac | `shown`: whether the Mac draws its pointer into the video (true until a viewer sends this; a viewer that shows its own pointer sends false). A Mac that can't change it mid-stream (Linux) keeps drawing it |
| `keyframe` | phone → Mac | (none); the phone lost a frame and needs a keyframe |

A side ignores message types it does not know.

### Video

H.264 (Annex B, start codes, no B-frames). Every keyframe carries its SPS and PPS in band. Each frame
travels on its own uni-stream:

```
u8  0x01
u32 seq       frame number, +1 per frame, wraps
u64 pts_us    capture time in microseconds
u8  flags     bit 0: keyframe
..  payload   one access unit, until the stream ends
```

The Mac resets the streams of every frame older than a keyframe it sends. The phone reads the streams in
order. After a missing sequence number or a reset stream, it drops frames until the next keyframe and
sends `keyframe` (at most every 300 ms). A Mac that falls behind skips frames but still spends their
sequence numbers, so the phone sees the gap.

### Audio

Opus at 48 kHz in stereo, one 20 ms packet (960 samples per channel) per datagram. The `audio` message
announces the stream; the format is fixed, so the Mac sends no Opus header and the phone builds its own.

```
u8  0x02
u32 seq
u64 pts_us
..  payload   one Opus packet
```

Audio is best effort; a lost datagram is a 20 ms gap.

### Input records

Every record is `u16 length` (type byte plus payload), then `u8 type`, then the payload. Coordinates and
deltas are `f32`.

| Type | Name | Payload |
| --- | --- | --- |
| `0x01` | move relative | `dx`, `dy` in Mac points |
| `0x02` | move absolute | `x`, `y` from 0 to 1 across the streamed display |
| `0x03` | button | `u8 button` (0 left, 1 right, 2 middle), `u8 down` (1 or 0), `u8 clicks` (1 to 3) |
| `0x04` | scroll | `dx`, `dy` (finger movement in points: positive `dy` drags content down), `u8 phase` (0 none, 1 began, 2 changed, 3 ended, 4 momentum) |
| `0x05` | key | `u16 keyCode` (macOS virtual key code), `u8 down`, `u32 flags` (CGEventFlags: shift `0x20000`, control `0x40000`, option `0x80000`, command `0x100000`) |
| `0x06` | text | UTF-8 text to type, at most 1000 bytes |

A record longer than 1024 bytes, or one of length 0, ends the input stream.

## What the core library hands each side

`tetra_next_event` returns one buffer per event. Its first byte is the kind:

| Kind | Body |
| --- | --- |
| 0 | none: the handle was stopped |
| 1 | JSON state event from the core (`connecting`, `connected`, `path`, `rejected`, `disconnected` on the phone; `ticket`, `paired`, `peerConnected`, `peerDisconnected`, `path`, `rejected`, `handshakeFailed` on the Mac) |
| 2 | a control message from the other side, raw JSON |
| 3 | one input record without its length (Mac only) |
| 4 | the 13-byte video header, then the access unit (phone only, already gated to decodable frames) |
| 5 | `u32 seq`, `u64 pts_us`, Opus packet (phone only) |
