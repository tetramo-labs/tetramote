# Tetratop for Mac

The menu-bar host the phone connects to. It captures a display with ScreenCaptureKit, encodes H.264 with
VideoToolbox and AAC with AVAudioConverter, and posts the phone's pointer and keyboard input as CGEvents.
All networking is the Rust core in `../core`, linked as a static library. The wire format is
[`../PROTOCOL.md`](../PROTOCOL.md).

## Build and run

```bash
../scripts/build-core.sh macos      # core/target/macos/libtetra_core.a
xcodegen generate                   # Tetratop.xcodeproj (generated, not committed)
xcodebuild -project Tetratop.xcodeproj -scheme Tetratop -configuration Debug \
  -derivedDataPath build/DerivedData -allowProvisioningUpdates build
open build/DerivedData/Build/Products/Debug/Tetratop.app
```

Tests: the same `xcodebuild` line with `test` instead of `build`. They cover the pure parts (input
records, AVCC to Annex B, the pairing URL, the AAC config bytes, bitrate steps).

The app is signed with the team's Apple Development certificate. Keep the signature stable: macOS ties
the Screen Recording and Accessibility grants, and the Keychain item holding the host key, to it.

## Permissions

- Screen Recording lets the phone see the screen. Without it the phone gets a `status` message saying so,
  and no video.
- Accessibility lets the phone move the pointer and type. Without it input is dropped.

Both rows in the popover open the right System Settings pane.

## Launch arguments

| Argument | Effect |
| --- | --- |
| `-TetratopTestPattern YES` | Streams a synthetic 1280x800 picture and a 440 Hz tone instead of the screen, so the pipeline runs without Screen Recording. Uses the `test` profile. |
| `-TetratopLocalOnly YES` | No relays and no address lookup; only direct addresses (loopback tests). |
| `-TetratopPairingFile <path>` | Writes the current pairing URL to the file whenever it changes. |
| `-TetratopProfile <name>` | Keeps the host key and paired phones under a separate Keychain account and defaults suite. |
| `-TetratopSnapshot <path>` | Renders the popover to a PNG once the pairing code is ready. |

## End-to-end check without a phone

```bash
APP=build/DerivedData/Build/Products/Debug/Tetratop.app
"$APP/Contents/MacOS/Tetratop" -TetratopTestPattern YES -TetratopLocalOnly YES \
  -TetratopPairingFile /tmp/tetratop-pair.txt &
(cd ../core && cargo run --release --example probe -- \
  --pair "$(cat /tmp/tetratop-pair.txt)" --local-only --out /tmp/probe.h264)
ffprobe -v error -count_frames -show_entries stream=codec_name,width,height,nb_read_frames /tmp/probe.h264
kill %1
```

The probe keeps its key at `/tmp/tetratop-probe.key`. The first run pairs with the URL's secret, and
later runs reconnect as a trusted phone. To forget the test runs:

```bash
defaults delete com.tetramo.tetratop.host.test
security delete-generic-password -s com.tetramo.tetratop.host -a endpoint-secret-key.test
```
