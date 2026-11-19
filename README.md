# Tetratop

Control your Mac from your iPhone (or an Android phone) over [iroh](https://iroh.computer). There's no
account and no Tetratop server: the Mac shows a QR code, the phone scans it once, and from then on the
two find each other by their keys. Connections are end-to-end encrypted QUIC. They go direct (hole-punched)
when they can, and fall back to n0's public relays, or a relay you run yourself, when they can't.

```
iPhone (Expo app)                                        Mac (menu bar app)
  RemoteSurface gestures ─ input records ─┐           ┌─ CGEvent injection
  AVSampleBufferDisplayLayer ◄─ H.264 ────┤  iroh     ├── VideoToolbox ◄─ ScreenCaptureKit
  AudioQueue ◄─ AAC ──────────────────────┤  QUIC     ├── AVAudioConverter ◄─ system audio
  clipboard / displays ◄─ control JSON ───┘           └─ NSPasteboard / SCShareableContent
        └── core/ (Rust, iroh 1.4) ─────────── same crate ───────────┘
```

## Layout

- `core/`: the Rust transport both sides link. It handles iroh endpoints, pairing and trust, the control
  stream, one QUIC stream per video frame, audio datagrams and input records, and exposes a C API
  (`core/include/tetra_core.h`) plus JNI glue for Android. `PROTOCOL.md` is the wire spec.
- `mac/`: the SwiftUI menu bar host. See [`mac/README.md`](mac/README.md).
- `mobile/`: the phone app (Expo 58, React Native 0.88, expo-router, Uniwind, Zustand, MMKV, i18next). It
  follows the Glassly App's design and stack. The native module `mobile/modules/remote` wraps the core,
  decodes video and audio natively and renders the screen in a native view, so frames never cross the JS
  bridge.

## Build

Requirements: Rust with the Apple and Android targets listed in `scripts/build-core.sh`, cargo-ndk, Xcode
27, XcodeGen, bun 1.4, and Java 17 plus the Android SDK for Android builds.

```bash
scripts/build-core.sh            # macos | ios | android | all
cd core && cargo test            # protocol unit tests and loopback sessions

cd mac && xcodegen generate && xcodebuild -scheme Tetratop build
cd mobile && bun install && bun ios        # connected iPhone; --simulator, --release, --prebuild
cd mobile && bun android                   # connected Android phone; --emulator
cd mobile && bun run test && bun compile && bun run lint:check
```

## Pairing and trust

1. The Mac generates an iroh key (kept in the Keychain) and a one-time 128-bit pairing secret, and shows
   `tetratop://pair?ticket=…&secret=…&name=…` as a QR code.
2. The phone dials the ticket and sends the secret in its hello. iroh's TLS already proves both endpoint
   keys, so the secret only has to show that this phone saw the QR code.
3. The Mac adds the phone's endpoint id to its trusted list and spends the secret. Later connections need no
   secret, and removing a phone in the Mac's menu drops its live session.

Nothing about the pairing ever leaves the two devices. Relays and n0's DNS address lookup see endpoint ids
and encrypted packets only.

## Testing without hardware

- `cargo run --release --example fakehost -- --h264 test.h264 --aac test.aac --pairing-file /tmp/pair.txt`
  streams a recorded clip to the phone and logs the input it receives. The example's header shows how to
  make the clip with ffmpeg. To pair a simulator without scanning, launch the app with the URL:
  `xcrun simctl launch <udid> com.tetramo.tetratop -TetratopPairURL "$(cat /tmp/pair.txt)"` (on Android, a
  `TetratopPairURL` string extra on the launch intent). `simctl openurl` works too, but iOS asks to confirm.
- `cargo run --release --example probe -- --pair "<url>" --out /tmp/probe.h264` acts as a phone against the
  Mac app. Run the app with `-TetratopTestPattern YES` so no Screen Recording grant is needed.
