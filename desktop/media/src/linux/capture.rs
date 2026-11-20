//! Screen capture from the portal's PipeWire stream. The PipeWire loop
//! copies each frame out as BGRx and an encoder thread takes the newest one,
//! so a slow encode drops frames instead of stalling PipeWire. Compositors
//! send frames only when the screen changes, so a keyframe requested on a
//! still screen re-encodes the last frame.

use std::io::Cursor;
use std::os::fd::OwnedFd;
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use pipewire as pw;
use pw::context::ContextRc;
use pw::main_loop::MainLoopRc;
use pw::properties::properties;
use pw::spa::buffer::ChunkFlags;
use pw::spa::param::format::{FormatProperties, MediaSubtype, MediaType};
use pw::spa::param::format_utils;
use pw::spa::param::video::{VideoFormat, VideoInfoRaw};
use pw::spa::param::ParamType;
use pw::spa::pod::serialize::PodSerializer;
use pw::spa::pod::{Pod, Value};
use pw::spa::utils::{Direction, Fraction, Rectangle, SpaTypes};
use pw::stream::{StreamBox, StreamFlags, StreamState};

use super::audio;
use super::portal::Portal;
use crate::host::{now_us, scale_bgra, stream_size};
use crate::software::SoftwareEncoder;
use crate::{DisplayInfo, MediaError, Result, ScreenStream, StreamConfig, StreamInfo, StreamSink};

const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(10);
const STILL_KEYFRAME_AFTER: Duration = Duration::from_millis(100);

pub fn start(config: StreamConfig, sink: Arc<dyn StreamSink>) -> Result<Box<dyn ScreenStream>> {
    let portal = Portal::shared()?;
    let screen = portal.screen(config.display_id).ok_or_else(|| {
        MediaError::Unsupported(
            "The screen share has no screen. Reconnect and pick a screen to share.".into(),
        )
    })?;
    let fd = portal.pipewire_fd()?;
    let ended = portal.clone();
    let mut stream = capture_node(fd, screen.node_id, &config, sink.clone(), move || {
        ended.close()
    })?;
    let display = &stream.info.display;
    portal.set_pixel_size(screen.node_id, (display.width, display.height));
    stream.info.display = portal.display(&screen);
    stream._portal = Some(portal);
    if config.audio {
        stream._audio = audio::start(sink)
            .map_err(|e| log::warn!("streaming without system audio: {e}"))
            .ok();
    }
    Ok(Box::new(stream))
}

/// Streams one PipeWire video node reached through `fd`; `on_end` runs when
/// the node goes away (the user stopped sharing).
fn capture_node(
    fd: OwnedFd,
    node_id: u32,
    config: &StreamConfig,
    sink: Arc<dyn StreamSink>,
    on_end: impl Fn() + Send + 'static,
) -> Result<LinuxStream> {
    let fps = config.fps.max(1);
    let shared = Arc::new(Shared::default());
    let (ready_tx, ready_rx) = mpsc::channel();
    let (quit_tx, quit_rx) = pw::channel::channel();
    let pipewire = {
        let shared = shared.clone();
        let sink = sink.clone();
        std::thread::Builder::new()
            .name("tetra-pipewire".into())
            .spawn(move || {
                let node = Node {
                    fd,
                    id: node_id,
                    fps,
                };
                if let Err(e) = pipewire_loop(node, &shared, &sink, on_end, &ready_tx, quit_rx) {
                    let _ = ready_tx.send(Err(e));
                }
            })
            .map_err(|e| {
                MediaError::Failed(format!(
                    "The PipeWire thread didn't start: {e}. Reconnect to try again."
                ))
            })?
    };
    let mut stream = LinuxStream {
        info: StreamInfo {
            display: DisplayInfo {
                id: node_id as u64,
                name: "Screen 1".into(),
                width: 0,
                height: 0,
                point_width: 0,
                point_height: 0,
                main: true,
            },
            width: 0,
            height: 0,
            encoder: "openh264",
        },
        shared: shared.clone(),
        quit: quit_tx,
        threads: vec![pipewire],
        _audio: None,
        _portal: None,
    };
    let (pixel_width, pixel_height) = match ready_rx.recv_timeout(FIRST_FRAME_TIMEOUT) {
        Ok(result) => result?,
        Err(_) => {
            return Err(MediaError::Failed(
                "The screen share started but PipeWire sent no picture within 10 seconds. Reconnect to try again.".into(),
            ))
        }
    };
    let (width, height) = stream_size(pixel_width, pixel_height, config.max_long_edge);
    let encoder = SoftwareEncoder::new(width, height, config.bitrate_bps, fps)?;
    let encoding = std::thread::Builder::new()
        .name("tetra-encode".into())
        .spawn(move || {
            encode_loop(
                encoder,
                (width as usize, height as usize),
                &shared,
                sink.as_ref(),
            )
        })
        .map_err(|e| {
            MediaError::Failed(format!(
                "The encoder thread didn't start: {e}. Reconnect to try again."
            ))
        })?;
    stream.threads.push(encoding);
    let display = &mut stream.info.display;
    (display.width, display.height) = (pixel_width, pixel_height);
    (display.point_width, display.point_height) = (pixel_width, pixel_height);
    (stream.info.width, stream.info.height) = (width, height);
    Ok(stream)
}

struct LinuxStream {
    info: StreamInfo,
    shared: Arc<Shared>,
    quit: pw::channel::Sender<()>,
    threads: Vec<JoinHandle<()>>,
    _audio: Option<audio::AudioCapture>,
    _portal: Option<Arc<Portal>>,
}

impl ScreenStream for LinuxStream {
    fn info(&self) -> &StreamInfo {
        &self.info
    }

    fn request_keyframe(&self) {
        let mut state = self.shared.lock();
        if state.keyframe_since.is_none() {
            state.keyframe_since = Some(Instant::now());
        }
        drop(state);
        self.shared.wake.notify_one();
    }

    fn set_bitrate(&self, bps: u32) {
        self.shared.lock().bitrate = Some(bps);
        self.shared.wake.notify_one();
    }
}

impl Drop for LinuxStream {
    fn drop(&mut self) {
        self.shared.lock().stop = true;
        self.shared.wake.notify_all();
        let _ = self.quit.send(());
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

struct Frame {
    data: Vec<u8>,
    width: usize,
    height: usize,
    pts_us: u64,
}

#[derive(Default)]
struct State {
    frame: Option<Frame>,
    spare: Option<Vec<u8>>,
    stop: bool,
    keyframe_since: Option<Instant>,
    bitrate: Option<u32>,
}

#[derive(Default)]
struct Shared {
    state: Mutex<State>,
    wake: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn put(&self, src: &[u8], width: usize, height: usize, stride: usize, swap_red_blue: bool) {
        let mut data = {
            let mut state = self.lock();
            state
                .frame
                .take()
                .map(|f| f.data)
                .or_else(|| state.spare.take())
                .unwrap_or_default()
        };
        copy_bgrx(src, width, height, stride, swap_red_blue, &mut data);
        self.lock().frame = Some(Frame {
            data,
            width,
            height,
            pts_us: now_us(),
        });
        self.wake.notify_one();
    }
}

/// Packs rows into `out` as BGRx, swapping red and blue for RGB layouts.
fn copy_bgrx(
    src: &[u8],
    width: usize,
    height: usize,
    stride: usize,
    swap_red_blue: bool,
    out: &mut Vec<u8>,
) {
    out.resize(width * height * 4, 0);
    for (row, line) in out.chunks_exact_mut(width * 4).enumerate() {
        line.copy_from_slice(&src[row * stride..row * stride + width * 4]);
        if swap_red_blue {
            for px in line.as_chunks_mut::<4>().0 {
                px.swap(0, 2);
            }
        }
    }
}

struct VideoState {
    format: VideoInfoRaw,
    size: (usize, usize),
    swap_red_blue: bool,
    streaming: bool,
    ready: Option<mpsc::Sender<Result<(u32, u32)>>>,
}

struct Node {
    fd: OwnedFd,
    id: u32,
    fps: u32,
}

fn pipewire_loop(
    node: Node,
    shared: &Arc<Shared>,
    sink: &Arc<dyn StreamSink>,
    on_end: impl Fn() + 'static,
    ready: &mpsc::Sender<Result<(u32, u32)>>,
    quit: pw::channel::Receiver<()>,
) -> Result<()> {
    let mainloop = MainLoopRc::new(None).map_err(pipewire_failed)?;
    let context = ContextRc::new(&mainloop, None).map_err(pipewire_failed)?;
    let core = context
        .connect_fd_rc(node.fd, None)
        .map_err(pipewire_failed)?;
    let stream = StreamBox::new(
        &core,
        "tetramote-screen",
        properties! {
            *pw::keys::MEDIA_TYPE => "Video",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
        },
    )
    .map_err(pipewire_failed)?;
    let state = VideoState {
        format: VideoInfoRaw::default(),
        size: (0, 0),
        swap_red_blue: false,
        streaming: false,
        ready: Some(ready.clone()),
    };
    let _listener = stream
        .add_local_listener_with_user_data(state)
        .param_changed(|_, state, id, param| {
            let Some(param) = param else { return };
            if id != ParamType::Format.as_raw() {
                return;
            }
            let Ok((media_type, media_subtype)) = format_utils::parse_format(param) else { return };
            if media_type != MediaType::Video || media_subtype != MediaSubtype::Raw || state.format.parse(param).is_err() {
                return;
            }
            let size = state.format.size();
            let format = state.format.format();
            state.size = (size.width as usize, size.height as usize);
            state.swap_red_blue = format == VideoFormat::RGBx || format == VideoFormat::RGBA;
            if let Some(ready) = state.ready.take() {
                let _ = ready.send(Ok((size.width, size.height)));
            }
        })
        .process({
            let shared = shared.clone();
            move |stream, state| {
                let Some(mut buffer) = stream.dequeue_buffer() else { return };
                let Some(data) = buffer.datas_mut().first_mut() else { return };
                let chunk = data.chunk();
                let (offset, size, stride, flags) = (chunk.offset() as usize, chunk.size(), chunk.stride(), chunk.flags());
                let (width, height) = state.size;
                if size == 0 || width == 0 || height == 0 || flags.contains(ChunkFlags::CORRUPTED) {
                    return;
                }
                let stride = if stride > 0 { stride as usize } else { width * 4 };
                let Some(bytes) = data.data() else { return };
                if bytes.len() < offset + stride * (height - 1) + width * 4 {
                    return;
                }
                shared.put(&bytes[offset..], width, height, stride, state.swap_red_blue);
            }
        })
        .state_changed({
            let mainloop = mainloop.clone();
            let sink = sink.clone();
            move |_, state, _, new| match new {
                StreamState::Streaming => state.streaming = true,
                StreamState::Error(message) => {
                    sink.on_error(MediaError::Failed(format!(
                        "The screen share's PipeWire stream failed ({message}). Reconnect to share again."
                    )));
                    on_end();
                    mainloop.quit();
                }
                StreamState::Unconnected if state.streaming => {
                    sink.on_error(MediaError::Failed(
                        "Screen sharing was stopped on this computer. Reconnect to share it again.".into(),
                    ));
                    on_end();
                    mainloop.quit();
                }
                _ => {}
            }
        })
        .register()
        .map_err(pipewire_failed)?;
    let format = video_format(node.fps)?;
    let mut params = [Pod::from_bytes(&format)
        .ok_or_else(|| pipewire_failed("the video format didn't serialize"))?];
    stream
        .connect(
            Direction::Input,
            Some(node.id),
            StreamFlags::AUTOCONNECT | StreamFlags::MAP_BUFFERS,
            &mut params,
        )
        .map_err(pipewire_failed)?;
    let _quit = quit.attach(mainloop.loop_(), {
        let mainloop = mainloop.clone();
        move |()| mainloop.quit()
    });
    mainloop.run();
    Ok(())
}

fn pipewire_failed(e: impl std::fmt::Display) -> MediaError {
    MediaError::Failed(format!(
        "Reading the screen through PipeWire failed: {e}. Reconnect to try again."
    ))
}

/// Packed 8-bit RGB layouts only, and no DMA-BUF modifiers, so compositors
/// hand over frames in shared memory the CPU can read.
fn video_format(fps: u32) -> Result<Vec<u8>> {
    let object = pw::spa::pod::object!(
        SpaTypes::ObjectParamFormat,
        ParamType::EnumFormat,
        pw::spa::pod::property!(FormatProperties::MediaType, Id, MediaType::Video),
        pw::spa::pod::property!(FormatProperties::MediaSubtype, Id, MediaSubtype::Raw),
        pw::spa::pod::property!(
            FormatProperties::VideoFormat,
            Choice,
            Enum,
            Id,
            VideoFormat::BGRx,
            VideoFormat::BGRx,
            VideoFormat::BGRA,
            VideoFormat::RGBx,
            VideoFormat::RGBA,
        ),
        pw::spa::pod::property!(
            FormatProperties::VideoSize,
            Choice,
            Range,
            Rectangle,
            Rectangle {
                width: 1920,
                height: 1080
            },
            Rectangle {
                width: 1,
                height: 1
            },
            Rectangle {
                width: 8192,
                height: 8192
            }
        ),
        pw::spa::pod::property!(
            FormatProperties::VideoFramerate,
            Choice,
            Range,
            Fraction,
            Fraction { num: fps, denom: 1 },
            Fraction { num: 0, denom: 1 },
            Fraction { num: fps, denom: 1 }
        ),
    );
    PodSerializer::serialize(Cursor::new(Vec::new()), &Value::Object(object))
        .map(|(cursor, _)| cursor.into_inner())
        .map_err(|e| pipewire_failed(format!("{e:?}")))
}

fn encode_loop(
    mut encoder: SoftwareEncoder,
    (width, height): (usize, usize),
    shared: &Shared,
    sink: &dyn StreamSink,
) {
    let mut last: Option<Frame> = None;
    let mut scaled = Vec::new();
    loop {
        let (fresh, keyframe, bitrate) = {
            let mut state = shared.lock();
            loop {
                if state.stop {
                    return;
                }
                let still_keyframe = last.is_some()
                    && state
                        .keyframe_since
                        .is_some_and(|since| since.elapsed() >= STILL_KEYFRAME_AFTER);
                if state.frame.is_some() || still_keyframe || state.bitrate.is_some() {
                    break;
                }
                state = shared
                    .wake
                    .wait_timeout(state, STILL_KEYFRAME_AFTER)
                    .map(|(guard, _)| guard)
                    .unwrap_or_else(|e| e.into_inner().0);
            }
            let fresh = state.frame.take();
            let keyframe =
                (fresh.is_some() || last.is_some()) && state.keyframe_since.take().is_some();
            (fresh, keyframe, state.bitrate.take())
        };
        if let Some(bps) = bitrate {
            encoder.set_bitrate(bps);
        }
        let pts_us = match fresh {
            Some(frame) => {
                let pts_us = frame.pts_us;
                if let Some(old) = last.replace(frame) {
                    shared.lock().spare = Some(old.data);
                }
                pts_us
            }
            None if keyframe => now_us(),
            None => continue,
        };
        let Some(frame) = &last else { continue };
        if !sink.should_encode() {
            if keyframe {
                shared.lock().keyframe_since = Some(Instant::now());
            }
            continue;
        }
        let pixels = if (frame.width, frame.height) == (width, height) {
            &frame.data
        } else {
            scale_bgra(
                &frame.data,
                frame.width,
                frame.height,
                frame.width * 4,
                width,
                height,
                &mut scaled,
            );
            &scaled
        };
        match encoder.encode_bgra(pixels, width * 4, pts_us, keyframe) {
            Ok(Some(encoded)) => sink.on_video(encoded),
            Ok(None) => {}
            Err(e) => {
                sink.on_error(e);
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::net::UnixStream;
    use std::path::PathBuf;

    use super::*;
    use crate::{AudioPacket, EncodedFrame};

    #[derive(Default)]
    struct Frames {
        frames: Mutex<Vec<EncodedFrame>>,
        errors: Mutex<Vec<String>>,
    }

    impl StreamSink for Frames {
        fn should_encode(&self) -> bool {
            true
        }

        fn on_video(&self, frame: EncodedFrame) {
            self.frames.lock().unwrap().push(frame);
        }

        fn on_audio(&self, _packet: AudioPacket) {}

        fn on_error(&self, error: MediaError) {
            self.errors.lock().unwrap().push(error.to_string());
        }
    }

    /// Needs a running PipeWire with a 640x360 video source whose node id is
    /// in `TETRA_TEST_VIDEO_NODE`; run with `--ignored`.
    #[test]
    #[ignore]
    fn encodes_a_pipewire_video_node() {
        let node: u32 = std::env::var("TETRA_TEST_VIDEO_NODE")
            .unwrap()
            .parse()
            .unwrap();
        let runtime = PathBuf::from(std::env::var_os("XDG_RUNTIME_DIR").unwrap());
        let fd = OwnedFd::from(UnixStream::connect(runtime.join("pipewire-0")).unwrap());
        let frames = Arc::new(Frames::default());
        let config = StreamConfig {
            audio: false,
            max_long_edge: 320,
            ..StreamConfig::default()
        };
        let stream = capture_node(fd, node, &config, frames.clone(), || {}).unwrap();
        let started = Instant::now();
        while frames.frames.lock().unwrap().len() < 5 && started.elapsed() < Duration::from_secs(5)
        {
            std::thread::sleep(Duration::from_millis(20));
        }
        stream.request_keyframe();
        std::thread::sleep(Duration::from_millis(300));
        let info = stream.info().clone();
        drop(stream);
        assert_eq!(*frames.errors.lock().unwrap(), Vec::<String>::new());
        let frames = frames.frames.lock().unwrap();
        eprintln!("{} frames of {info:?}", frames.len());
        assert!(frames.len() >= 5);
        assert!(frames[0].keyframe);
        assert!(frames[1..].iter().any(|f| f.keyframe));
        assert_eq!((info.width, info.height), (320, 180));
        assert_eq!((info.display.width, info.display.height), (640, 360));
    }

    #[test]
    fn packs_rows_and_swaps_rgb_layouts() {
        let src = [
            1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 9, 10, 11, 12, 13, 14, 15, 16, 0, 0,
        ];
        let mut out = Vec::new();
        copy_bgrx(&src, 2, 2, 10, false, &mut out);
        assert_eq!(out, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        copy_bgrx(&src, 2, 2, 10, true, &mut out);
        assert_eq!(out, [3, 2, 1, 4, 7, 6, 5, 8, 11, 10, 9, 12, 15, 14, 13, 16]);
    }

    #[test]
    fn serializes_the_video_format() {
        let format = video_format(60).unwrap();
        assert!(Pod::from_bytes(&format).is_some());
    }

    #[test]
    fn hands_the_encoder_only_the_newest_frame() {
        let shared = Shared::default();
        shared.put(&[1; 16], 2, 2, 8, false);
        shared.put(&[2; 16], 2, 2, 8, false);
        let frame = shared.lock().frame.take().unwrap();
        assert_eq!(frame.data, [2; 16]);
        assert_eq!((frame.width, frame.height), (2, 2));
    }
}
