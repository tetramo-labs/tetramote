# Tetramote

Control your computers from your phone, another computer or a browser, over [iroh](https://iroh.computer).
There's no account and no Tetramote server: a computer shares a link (also shown as a QR code), and anything
that opens it can connect. The apps pair once and then find the computer by its key; a browser at
remote.tetramote.com joins for as long as the link stays the same. Connections are end-to-end encrypted QUIC.
They go direct (hole-punched) when they can, and fall back to n0's public relays, or a relay you run yourself,
when they can't. Browsers always go through a relay.

```
Phone (Expo app)  or  desktop viewer (Tauri)                   Desktop host (Tauri)
  gestures / mouse + keyboard ─ input records ─┐            ┌─ CGEvent · SendInput · RemoteDesktop portal
  native decoder or WebCodecs ◄─ H.264 ────────┤   iroh     ├── VideoToolbox · Media Foundation · openh264
  AudioQueue · MediaCodec · cpal ◄─ Opus ──────┤   QUIC     ├── system audio → Opus
  clipboard / displays ◄─ control JSON ────────┘            └─ clipboard, display list
            └──────── core/ (Rust, iroh 1.4): the same crate on every side ────────┘
```

## Layout

- `core/`: the Rust transport every side links. It handles iroh endpoints, pairing and trust, the control
  stream, one QUIC stream per video frame, audio datagrams and input records, and exposes a C API
  (`core/include/tetra_core.h`) plus JNI glue for Android. `PROTOCOL.md` is the wire spec.
- `desktop/`: the desktop app for macOS, Windows and Linux, on [Tauri 2](https://v2.tauri.app). One app
  shares its computer (menu bar or tray popover with the pairing QR code) and controls others (a viewer
  window). `desktop/src-tauri` is the Rust backend, `desktop/src` the React frontend, and `desktop/media`
  (`tetra_media`) the per-OS screen capture, H.264 encoding, Opus audio and input injection. See
  [`desktop/README.md`](desktop/README.md).
- `mobile/`: the phone app (Expo 58, React Native 0.88, expo-router, Uniwind, Zustand, MMKV, i18next). It
  follows the Glassly App's design and stack. The native module `mobile/modules/remote` wraps the core,
  decodes video and audio natively and renders the screen in a native view, so frames never cross the JS
  bridge.
- `web/`: the browser client at [remote.tetramote.com](https://remote.tetramote.com), static files on
  Cloudflare Pages. `web/wasm` (`tetra_web`) is the core's protocol plus iroh compiled to WebAssembly, built
  into `web/src/core/` by `scripts/build-web-core.sh` and committed; the React app around it decodes video and
  audio with WebCodecs. `?debug` in the URL sends iroh's logs to the console.
- `site/`: [tetramote.com](https://tetramote.com), a static React and Vite page prerendered at build time
  and deployed by Cloudflare Pages from `main`. `cd site && bun install && bun run dev` serves it locally.

## Build

Requirements: Rust (with the Apple and Android targets in `scripts/build-core.sh` for the phone), bun 1.4,
cmake, Xcode 27.1 or later on macOS, cargo-ndk plus Java 17 and the Android SDK for Android, and Tauri's
system packages on Linux (see `desktop/README.md`). iOS gives an app the iPhone Duo's full window, status
rail included, only when it is linked against the 27.1 SDK or later; `bun ios` builds with the newest Xcode
in `/Applications` for that reason.

```bash
cd core && cargo test                      # protocol unit tests and loopback sessions

cd desktop && bun install && bunx tauri dev                      # the desktop app
cd desktop && cargo test -p tetra_media -p tetramote-desktop      # cap jobs at 2 on macOS 27: CARGO_BUILD_JOBS=2
cd desktop && bunx vitest run && bunx tsc --noEmit -p . && bunx eslint .

scripts/build-core.sh ios|android          # the core for the phone
cd mobile && bun install && bun ios        # connected iPhone; --simulator, --release, --prebuild
cd mobile && bun android                   # connected Android phone; --emulator
cd mobile && bun run test && bun compile && bun run lint:check

scripts/build-web-core.sh                  # web/wasm -> web/src/core (rustup llvm-tools, wasm-bindgen-cli)
cd web && bun install && bun run dev       # the browser client; open it with a link's #fragment
cd web && bunx vitest run && bun run build && bunx eslint .
```

## Releases and updates

`scripts/release-desktop.sh <version>` publishes the desktop app as the GitHub release `v<version>`: it
builds and signs the universal macOS app on this Mac, then `.github/workflows/release-desktop.yml` adds the
Windows and Linux builds. Installed copies check `latest.json` on the newest release every few hours and,
unless "Install updates automatically" is off, install while nothing is connected. Updates are signed with
the updater key (`~/.tauri/tetramote.key`, also the `TAURI_SIGNING_PRIVATE_KEY` Actions secret); back it up,
since installed copies only accept updates signed with it. The macOS app is signed with an Apple Development
certificate and not notarized for now.

## iPhone Duo

The phone app is designed for the iPhone Duo first and widens rather than switching designs:

- Whenever the window has room under the Mac's screen, the session becomes a laptop: screen on top, a
  trackpad below. On the open display it splits at the fold when iOS reports one (reserved regions).
- On the folded display and the open display held sideways, the session controls, Back, Close and Settings
  move into the status rail, Close first; what doesn't fit goes behind More. Elsewhere they sit under the
  trackpad or beside the screen.
- Full screen (toolbar button, or Settings › Open sessions in full screen) works like a video player: the
  Mac fills the display, the status bar and rail turn off, and the controls float over it and hide on their
  own.
- Settings › Hide controls automatically fades the controls after a few seconds outside full screen too; a
  three-finger tap or the handle that stays behind brings them back.

`duoctl` (`brew install skarol/tap/duoctl`) folds, rotates, taps and screenshots the Duo simulator.

## Pairing and trust

1. The shared computer keeps an iroh key and a 128-bit link secret in the system keychain, and shows
   `https://remote.tetramote.com/#id=…&secret=…&name=…` as a QR code and a copyable link.
2. A phone, another computer or a browser dials the endpoint id and sends the secret in its hello. iroh's TLS
   already proves both endpoint keys, so the secret only has to show that this device has the link.
3. The apps pair: the computer adds their endpoint id to its trusted list, and later connections need no
   secret. A browser joins as a guest for that connection only. New link in the popover replaces the secret,
   which stops the old link and disconnects a guest that used it; removing a paired device drops its session.

The secret sits after `#`, which browsers keep to themselves, so neither Cloudflare (serving remote.tetramote.com)
nor the relays or n0's DNS address lookup ever see it. They see endpoint ids and encrypted packets only.

## Testing without hardware

- `cargo run --release --example fakehost -- --h264 test.h264 --opus test.ogg --pairing-file /tmp/pair.txt`
  streams a recorded clip to the phone and logs the input it receives. The example's header shows how to
  make the clip with ffmpeg. To pair a simulator without scanning, launch the app with the URL:
  `xcrun simctl launch <udid> com.tetramo.tetramote -TetramotePairURL "$(cat /tmp/pair.txt)"` (on Android, a
  `TetramotePairURL` string extra on the launch intent). `simctl openurl` with the link opens the browser
  client in Safari instead, which is how to test `web/` on a phone.
- `cargo run --release --example probe -- --pair "<url>" --out /tmp/probe.h264` acts as a phone (or, with
  `--guest`, a browser) against the desktop app. Environment variables for the desktop app in tests:
  - `TETRAMOTE_PROFILE=<name>`: separate settings and keys, so the real ones are never read (no keychain
    prompts).
  - `TETRAMOTE_TEST_PATTERN=1`: share a synthetic display (software encoder, silent audio) instead of the
    screen; `TETRAMOTE_INPUT_LOG=<file>` then receives the input records instead of the pointer and keyboard.
  - `TETRAMOTE_PAIRING_FILE=<file>`: write the pairing link there.
  - `TETRAMOTE_CONNECT=<link>`: connect to another computer at launch.
  - `TETRAMOTE_SHOW_POPOVER=1`: open the popover at launch and keep it open.

## License

MIT. See [LICENSE](LICENSE).
