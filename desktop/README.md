# Tetramote desktop

The desktop app shares a Mac, Windows or Linux computer with the phone app, or controls one from another
computer. `media/` (`tetra_media`) is its platform layer: list displays, capture one as H.264 plus system
audio as Opus, and post the phone's input records as OS input. `src-tauri/` (Rust) and `src/` (React) are the
Tauri app around it.

```bash
cd desktop
cargo test -p tetra_media
cargo clippy -p tetra_media -- -D warnings
```

Every platform builds libopus from source, so CMake must be on the `PATH`. `.github/workflows/desktop.yml`
runs the tests and Clippy on macOS, Windows and Ubuntu.

## macOS

Capture uses ScreenCaptureKit and encoding uses VideoToolbox, the hardware H.264 encoder. Input goes through
CGEvent. The app needs Screen Recording and Accessibility, which `permissions()` reports and the
`request_*` functions ask for.

## Windows

Requirements: Windows 10 or later, the MSVC Rust toolchain with the Visual Studio C++ build tools, and CMake.

- Capture: DXGI Desktop Duplication of one monitor. The GPU hands each frame to the CPU, which turns rotated
  monitors upright, draws the cursor in and converts to NV12.
- Video: the Media Foundation hardware H.264 encoder (Intel Quick Sync, NVIDIA NVENC or AMD AMF, whichever
  the GPU driver installs), in low-latency CBR with keyframes on request. Without one, or if it fails mid
  stream, encoding falls back to openh264 in software. `StreamInfo.encoder` says which one runs:
  `mediafoundation` or `openh264`.
- Audio: WASAPI loopback of the default output device, resampled to 48 kHz stereo and encoded as Opus in
  software.
- Input: `SendInput`. The wire's Mac modifiers map Command and Control to Ctrl, Option to Alt and Shift to
  Shift, and a missing double click is replayed, since Windows counts clicks by timing.
- Windows blocks capture of the secure desktop (UAC prompts and the lock screen), so the stream pauses there.
  It also blocks input into apps running as administrator unless Tetramote runs as administrator too.

## Linux

Requirements: a running PipeWire, and xdg-desktop-portal with a backend that implements both ScreenCast and
RemoteDesktop. GNOME (`xdg-desktop-portal-gnome`) and KDE Plasma (`xdg-desktop-portal-kde`) do, on Wayland or
X11. wlroots compositors don't implement RemoteDesktop yet. The released `.deb` and AppImage are built on Ubuntu
24.04, so they need glibc 2.39 or newer (Ubuntu 24.04, Debian 13, Fedora 40 and later). Building needs
`libpipewire-0.3-dev libspa-0.2-dev libclang-dev libasound2-dev pkg-config cmake`.

- Sharing starts one portal session for both capture and input. The portal asks the user which screen to
  share and whether to allow control. Where it supports restore tokens, the grant is remembered in
  `$XDG_STATE_HOME/tetramote/portal-restore-token`.
- Until a session exists, `displays()` returns a single "Entire screen" entry with no size, because the
  portal only names its screens once the user has picked one.
- Capture: PipeWire frames in shared memory (BGRx, BGRA, RGBx or RGBA), scaled on the CPU.
- Video: openh264 in software, so `StreamInfo.encoder` is `openh264`. VAAPI hardware encoding can come
  later.
- Audio: the default sink's monitor through PipeWire, encoded as Opus in software.
- Input: the portal's RemoteDesktop pointer, axis and keyboard calls, with evdev key codes and the same
  Command-to-Ctrl mapping as Windows. Text is typed as keysyms.
