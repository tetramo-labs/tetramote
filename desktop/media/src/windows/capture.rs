//! Desktop Duplication of one output on a capture thread that also runs the
//! encoder. Duplication leaves the cursor out and hands rotated outputs over
//! in scanout orientation, so frames are turned upright and the cursor is
//! drawn in before encoding.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Win32::Foundation::{E_ACCESSDENIED, HMODULE};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_MODE_ROTATION, DXGI_MODE_ROTATION_ROTATE180, DXGI_MODE_ROTATION_ROTATE270,
    DXGI_MODE_ROTATION_ROTATE90, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource, DXGI_ERROR_ACCESS_LOST,
    DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO, DXGI_OUTDUPL_POINTER_SHAPE_INFO,
    DXGI_OUTDUPL_POINTER_SHAPE_TYPE_COLOR, DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR,
    DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME,
};

use windows::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
};

use super::mft::HardwareEncoder;
use super::{audio, display, failed, input, Com};
use crate::host::{now_us, scale_bgra, stream_size};
use crate::software::{bgra_to_yuv420, SoftwareEncoder};
use crate::{
    DisplayInfo, EncodedFrame, MediaError, PointerShape, Result, ScreenStream, StreamConfig,
    StreamInfo, StreamSink,
};

const IDLE_WAIT_MS: u32 = 50;
const REDUPLICATE_EVERY: Duration = Duration::from_millis(250);

pub fn start(config: StreamConfig, sink: Arc<dyn StreamSink>) -> Result<Box<dyn ScreenStream>> {
    input::wake_display();
    let displays = display::displays()?;
    let display = config
        .display_id
        .and_then(|id| displays.iter().find(|d| d.id == id))
        .or_else(|| displays.iter().find(|d| d.main))
        .or(displays.first())
        .cloned()
        .ok_or_else(|| {
            MediaError::Unsupported(
                "No display to stream. Connect a display, then reconnect.".into(),
            )
        })?;
    let (width, height) = stream_size(display.width, display.height, config.max_long_edge);
    let control = Arc::new(Control {
        stop: AtomicBool::new(false),
        keyframe: AtomicBool::new(true),
        bitrate: AtomicU32::new(0),
        cursor: AtomicBool::new(config.cursor),
    });
    let (ready_tx, ready_rx) = mpsc::channel();
    let thread = {
        let control = control.clone();
        let sink = sink.clone();
        let display = display.clone();
        let fps = config.fps.max(1);
        let bitrate = config.bitrate_bps;
        std::thread::Builder::new()
            .name("tetra-capture".into())
            .spawn(move || {
                run(
                    display,
                    (width, height),
                    fps,
                    bitrate,
                    control,
                    sink,
                    ready_tx,
                )
            })
            .map_err(|e| {
                MediaError::Failed(format!(
                    "The capture thread didn't start: {e}. Reconnect to try again."
                ))
            })?
    };
    let encoder = ready_rx.recv().map_err(|_| {
        MediaError::Failed("Screen capture stopped while starting. Reconnect to try again.".into())
    })??;
    let audio = if config.audio {
        audio::start(sink)
            .map_err(|e| log::warn!("streaming without system audio: {e}"))
            .ok()
    } else {
        None
    };
    Ok(Box::new(WindowsStream {
        info: StreamInfo {
            display,
            width,
            height,
            encoder,
        },
        control,
        thread: Some(thread),
        _audio: audio,
    }))
}

struct Control {
    stop: AtomicBool,
    keyframe: AtomicBool,
    bitrate: AtomicU32,
    cursor: AtomicBool,
}

struct WindowsStream {
    info: StreamInfo,
    control: Arc<Control>,
    thread: Option<JoinHandle<()>>,
    _audio: Option<audio::AudioCapture>,
}

impl ScreenStream for WindowsStream {
    fn info(&self) -> &StreamInfo {
        &self.info
    }

    fn request_keyframe(&self) {
        self.control.keyframe.store(true, Ordering::Relaxed);
    }

    fn set_bitrate(&self, bps: u32) {
        self.control.bitrate.store(bps.max(1), Ordering::Relaxed);
    }

    fn set_cursor(&self, shown: bool) {
        if self.control.cursor.swap(shown, Ordering::Relaxed) != shown {
            self.control.keyframe.store(true, Ordering::Relaxed);
        }
    }
}

impl Drop for WindowsStream {
    fn drop(&mut self) {
        self.control.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct Awake;

impl Awake {
    fn hold() -> Self {
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED)
        };
        Self
    }
}

impl Drop for Awake {
    fn drop(&mut self) {
        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
    }
}

fn run(
    display: DisplayInfo,
    size: (u32, u32),
    fps: u32,
    bitrate: u32,
    control: Arc<Control>,
    sink: Arc<dyn StreamSink>,
    ready: mpsc::Sender<Result<&'static str>>,
) {
    let _com = Com::init();
    let _awake = Awake::hold();
    let opened =
        Duplicator::open(&display).and_then(|d| Ok((d, VideoEncoder::new(size, fps, bitrate)?)));
    let (mut duplicator, mut encoder) = match opened {
        Ok(v) => v,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    let _ = ready.send(Ok(encoder.name()));
    if let Err(e) = capture(
        &mut duplicator,
        &mut encoder,
        size,
        fps,
        &control,
        sink.as_ref(),
    ) {
        sink.on_error(e);
    }
}

fn capture(
    duplicator: &mut Duplicator,
    encoder: &mut VideoEncoder,
    (width, height): (u32, u32),
    fps: u32,
    control: &Control,
    sink: &dyn StreamSink,
) -> Result<()> {
    let interval = Duration::from_micros(1_000_000 / fps as u64);
    let (width, height) = (width as usize, height as usize);
    let mut last_encode: Option<Instant> = None;
    let mut have_frame = false;
    let mut dirty = false;
    let mut sent_pointer: Option<PointerShape> = None;
    let mut composed = Vec::new();
    let mut scaled = Vec::new();
    let mut yuv = Vec::new();
    while !control.stop.load(Ordering::Relaxed) {
        let bitrate = control.bitrate.swap(0, Ordering::Relaxed);
        if bitrate > 0 {
            encoder.set_bitrate(bitrate);
        }
        for frame in encoder.poll()? {
            sink.on_video(frame);
        }
        let until_due =
            last_encode.map_or(Duration::ZERO, |t| interval.saturating_sub(t.elapsed()));
        let wait_ms = if encoder.busy() {
            1
        } else if dirty {
            until_due.as_millis().clamp(1, IDLE_WAIT_MS as u128) as u32
        } else {
            IDLE_WAIT_MS
        };
        if duplicator.next(wait_ms)? {
            have_frame = true;
            dirty = true;
        }
        if let Some(shape) = duplicator.pointer.arrived.take() {
            if sent_pointer.as_ref() != Some(&shape) {
                sink.on_pointer(shape.clone());
                sent_pointer = Some(shape);
            }
        }
        let keyframe_wanted = control.keyframe.load(Ordering::Relaxed);
        if !have_frame || !(dirty || keyframe_wanted) || !encoder.accepts_input() {
            continue;
        }
        if last_encode.is_some_and(|t| t.elapsed() < interval) {
            continue;
        }
        dirty = false;
        if !sink.should_encode() {
            continue;
        }
        let keyframe = control.keyframe.swap(false, Ordering::Relaxed);
        duplicator.compose(&mut composed, control.cursor.load(Ordering::Relaxed));
        let frame = if (duplicator.width, duplicator.height) == (width, height) {
            &composed
        } else {
            scale_bgra(
                &composed,
                duplicator.width,
                duplicator.height,
                duplicator.width * 4,
                width,
                height,
                &mut scaled,
            );
            &scaled
        };
        for out in encoder.encode(frame, &mut yuv, now_us(), keyframe)? {
            sink.on_video(out);
        }
        last_encode = Some(Instant::now());
    }
    Ok(())
}

/// The hardware encoder when one works, else openh264; a hardware encoder
/// that fails mid-stream is swapped for openh264 and the next frame is a
/// keyframe.
struct VideoEncoder {
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u32,
    kind: Kind,
}

enum Kind {
    Hardware(HardwareEncoder),
    Software(SoftwareEncoder),
}

impl VideoEncoder {
    fn new((width, height): (u32, u32), fps: u32, bitrate: u32) -> Result<Self> {
        let kind = match HardwareEncoder::new(width, height, fps, bitrate) {
            Ok(encoder) => Kind::Hardware(encoder),
            Err(e) => {
                log::info!("encoding with openh264: {e}");
                Kind::Software(SoftwareEncoder::new(width, height, bitrate, fps)?)
            }
        };
        Ok(Self {
            width,
            height,
            fps,
            bitrate,
            kind,
        })
    }

    fn name(&self) -> &'static str {
        match self.kind {
            Kind::Hardware(_) => "mediafoundation",
            Kind::Software(_) => "openh264",
        }
    }

    fn busy(&self) -> bool {
        matches!(&self.kind, Kind::Hardware(e) if e.in_flight())
    }

    fn accepts_input(&self) -> bool {
        match &self.kind {
            Kind::Hardware(e) => e.accepts_input(),
            Kind::Software(_) => true,
        }
    }

    fn set_bitrate(&mut self, bps: u32) {
        self.bitrate = bps;
        match &mut self.kind {
            Kind::Hardware(e) => e.set_bitrate(bps),
            Kind::Software(e) => e.set_bitrate(bps),
        }
    }

    fn poll(&mut self) -> Result<Vec<EncodedFrame>> {
        let Kind::Hardware(encoder) = &mut self.kind else {
            return Ok(Vec::new());
        };
        match encoder.poll() {
            Ok(frames) => Ok(frames),
            Err(e) => {
                self.fall_back(e)?;
                Ok(Vec::new())
            }
        }
    }

    fn encode(
        &mut self,
        bgra: &[u8],
        yuv: &mut Vec<u8>,
        pts_us: u64,
        keyframe: bool,
    ) -> Result<Vec<EncodedFrame>> {
        let (width, height) = (self.width as usize, self.height as usize);
        if let Kind::Hardware(encoder) = &mut self.kind {
            bgra_to_yuv420(bgra, width, height, width * 4, true, yuv);
            match encoder
                .submit(yuv, pts_us, keyframe)
                .and_then(|()| encoder.poll())
            {
                Ok(frames) => return Ok(frames),
                Err(e) => self.fall_back(e)?,
            }
        }
        let Kind::Software(encoder) = &mut self.kind else {
            return Ok(Vec::new());
        };
        Ok(encoder
            .encode_bgra(bgra, width * 4, pts_us, keyframe)?
            .into_iter()
            .collect())
    }

    fn fall_back(&mut self, error: windows::core::Error) -> Result<()> {
        log::warn!("the hardware H.264 encoder failed ({error}); switching to openh264");
        self.kind = Kind::Software(SoftwareEncoder::new(
            self.width,
            self.height,
            self.bitrate,
            self.fps,
        )?);
        Ok(())
    }
}

struct Pointer {
    visible: bool,
    x: i32,
    y: i32,
    shape: Option<DuplicatedShape>,
    arrived: Option<PointerShape>,
}

struct DuplicatedShape {
    kind: i32,
    width: usize,
    height: usize,
    pitch: usize,
    data: Vec<u8>,
}

struct Duplicator {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    output: IDXGIOutput1,
    duplication: Option<IDXGIOutputDuplication>,
    lost_at: Option<Instant>,
    turns: u8,
    staging: Option<(ID3D11Texture2D, u32, u32)>,
    desktop: Vec<u8>,
    width: usize,
    height: usize,
    pixels_per_point: f32,
    pointer: Pointer,
}

impl Duplicator {
    fn open(display: &DisplayInfo) -> Result<Self> {
        let output = display::outputs()?
            .into_iter()
            .find(|o| o.info.id == display.id)
            .ok_or_else(|| {
                MediaError::Unsupported(format!(
                    "{} is no longer connected. Pick another display, then reconnect.",
                    display.name
                ))
            })?;
        let mut device = None;
        let mut context = None;
        unsafe {
            D3D11CreateDevice(
                &output.adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
        }
        .map_err(|e| failed("Opening the graphics adapter", e))?;
        let (Some(device), Some(context)) = (device, context) else {
            return Err(MediaError::Failed(
                "The graphics adapter opened without a device. Update the graphics driver, then reconnect.".into(),
            ));
        };
        let output: IDXGIOutput1 = output
            .output
            .cast()
            .map_err(|e| failed("Opening the display output", e))?;
        let mut duplicator = Self {
            device,
            context,
            output,
            duplication: None,
            lost_at: None,
            turns: 0,
            staging: None,
            desktop: Vec::new(),
            width: display.width as usize,
            height: display.height as usize,
            pixels_per_point: display.width as f32 / display.point_width.max(1) as f32,
            pointer: Pointer {
                visible: false,
                x: 0,
                y: 0,
                shape: None,
                arrived: None,
            },
        };
        duplicator.duplicate().map_err(|e| {
            if e.code() == E_ACCESSDENIED {
                MediaError::PermissionDenied(
                    "Windows refused screen capture. Run Tetramote in your signed-in desktop session (not as a service), unlock the computer, then reconnect.".into(),
                )
            } else {
                failed("Starting screen capture", e)
            }
        })?;
        Ok(duplicator)
    }

    fn duplicate(&mut self) -> windows::core::Result<()> {
        self.duplication = None;
        let duplication = unsafe { self.output.DuplicateOutput(&self.device) }?;
        self.turns = quarter_turns(unsafe { duplication.GetDesc() }.Rotation);
        self.duplication = Some(duplication);
        self.lost_at = None;
        Ok(())
    }

    /// Waits up to `timeout_ms` for the desktop or the pointer to change;
    /// true when something did.
    fn next(&mut self, timeout_ms: u32) -> Result<bool> {
        let Some(duplication) = self.duplication.clone() else {
            if self
                .lost_at
                .is_none_or(|t| t.elapsed() >= REDUPLICATE_EVERY)
            {
                if let Err(e) = self.duplicate() {
                    log::debug!("screen capture is paused: {e}");
                    self.lost_at = Some(Instant::now());
                }
            }
            std::thread::sleep(Duration::from_millis(timeout_ms as u64));
            return Ok(false);
        };
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource: Option<IDXGIResource> = None;
        match unsafe { duplication.AcquireNextFrame(timeout_ms, &mut info, &mut resource) } {
            Ok(()) => {}
            Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(false),
            Err(e) if e.code() == DXGI_ERROR_ACCESS_LOST => {
                self.duplication = None;
                self.lost_at = None;
                return Ok(false);
            }
            Err(e) => return Err(failed("Capturing the screen", e)),
        }
        let read = self.read(&duplication, &info, resource);
        unsafe {
            let _ = duplication.ReleaseFrame();
        }
        read.map(|()| true)
    }

    fn read(
        &mut self,
        duplication: &IDXGIOutputDuplication,
        info: &DXGI_OUTDUPL_FRAME_INFO,
        resource: Option<IDXGIResource>,
    ) -> Result<()> {
        if info.LastPresentTime != 0 {
            if let Some(resource) = resource {
                let texture: ID3D11Texture2D = resource
                    .cast()
                    .map_err(|e| failed("Reading the screen", e))?;
                self.copy_desktop(&texture)
                    .map_err(|e| failed("Reading the screen", e))?;
            }
        }
        if info.LastMouseUpdateTime != 0 {
            self.pointer.visible = info.PointerPosition.Visible.as_bool();
            self.pointer.x = info.PointerPosition.Position.x;
            self.pointer.y = info.PointerPosition.Position.y;
        }
        if info.PointerShapeBufferSize > 0 {
            let mut data = vec![0u8; info.PointerShapeBufferSize as usize];
            let mut required = 0u32;
            let mut shape = DXGI_OUTDUPL_POINTER_SHAPE_INFO::default();
            let read = unsafe {
                duplication.GetFramePointerShape(
                    data.len() as u32,
                    data.as_mut_ptr().cast(),
                    &mut required,
                    &mut shape,
                )
            };
            if read.is_ok() {
                let duplicated = DuplicatedShape {
                    kind: shape.Type as i32,
                    width: shape.Width as usize,
                    height: shape.Height as usize,
                    pitch: shape.Pitch as usize,
                    data,
                };
                let (width, height, rgba) = straight_rgba(&duplicated);
                self.pointer.arrived = PointerShape::from_rgba(
                    width as u32,
                    height as u32,
                    &rgba,
                    shape.HotSpot.x as f32,
                    shape.HotSpot.y as f32,
                    self.pixels_per_point,
                );
                self.pointer.shape = Some(duplicated);
            }
        }
        Ok(())
    }

    fn copy_desktop(&mut self, texture: &ID3D11Texture2D) -> windows::core::Result<()> {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { texture.GetDesc(&mut desc) };
        let staging = match &self.staging {
            Some((staging, w, h)) if (*w, *h) == (desc.Width, desc.Height) => staging.clone(),
            _ => {
                let staging_desc = D3D11_TEXTURE2D_DESC {
                    Width: desc.Width,
                    Height: desc.Height,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: desc.Format,
                    SampleDesc: DXGI_SAMPLE_DESC {
                        Count: 1,
                        Quality: 0,
                    },
                    Usage: D3D11_USAGE_STAGING,
                    BindFlags: 0,
                    CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                    MiscFlags: 0,
                };
                let mut created = None;
                unsafe {
                    self.device
                        .CreateTexture2D(&staging_desc, None, Some(&mut created))
                }?;
                let created = created.ok_or_else(windows::core::Error::empty)?;
                self.staging = Some((created.clone(), desc.Width, desc.Height));
                created
            }
        };
        unsafe { self.context.CopyResource(&staging, texture) };
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe {
            self.context
                .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
        }?;
        let (width, height, pitch) = (
            desc.Width as usize,
            desc.Height as usize,
            mapped.RowPitch as usize,
        );
        let pixels = unsafe {
            std::slice::from_raw_parts(mapped.pData as *const u8, pitch * (height - 1) + width * 4)
        };
        (self.width, self.height) =
            turn(pixels, width, height, pitch, self.turns, &mut self.desktop);
        unsafe { self.context.Unmap(&staging, 0) };
        Ok(())
    }

    fn compose(&self, out: &mut Vec<u8>, cursor: bool) {
        out.clear();
        out.extend_from_slice(&self.desktop);
        out.resize(self.width * self.height * 4, 0);
        if cursor && self.pointer.visible {
            if let Some(shape) = &self.pointer.shape {
                draw_pointer(
                    out,
                    self.width,
                    self.height,
                    shape,
                    self.pointer.x,
                    self.pointer.y,
                );
            }
        }
    }
}

fn quarter_turns(rotation: DXGI_MODE_ROTATION) -> u8 {
    match rotation {
        DXGI_MODE_ROTATION_ROTATE90 => 1,
        DXGI_MODE_ROTATION_ROTATE180 => 2,
        DXGI_MODE_ROTATION_ROTATE270 => 3,
        _ => 0,
    }
}

/// Copies a scanout-orientation image upright (`turns` quarter turns
/// clockwise) into a tightly packed buffer and returns its size.
fn turn(
    src: &[u8],
    width: usize,
    height: usize,
    pitch: usize,
    turns: u8,
    out: &mut Vec<u8>,
) -> (usize, usize) {
    out.resize(width * height * 4, 0);
    if turns == 0 {
        for (row, line) in out.chunks_exact_mut(width * 4).enumerate() {
            line.copy_from_slice(&src[row * pitch..row * pitch + width * 4]);
        }
        return (width, height);
    }
    let (out_width, out_height) = if turns == 2 {
        (width, height)
    } else {
        (height, width)
    };
    for y in 0..height {
        for x in 0..width {
            let (tx, ty) = match turns {
                1 => (height - 1 - y, x),
                2 => (width - 1 - x, height - 1 - y),
                _ => (y, width - 1 - x),
            };
            let at = (ty * out_width + tx) * 4;
            out[at..at + 4].copy_from_slice(&src[y * pitch + x * 4..y * pitch + x * 4 + 4]);
        }
    }
    (out_width, out_height)
}

fn draw_pointer(
    frame: &mut [u8],
    width: usize,
    height: usize,
    shape: &DuplicatedShape,
    left: i32,
    top: i32,
) {
    let monochrome = shape.kind == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME.0;
    let rows = if monochrome {
        shape.height / 2
    } else {
        shape.height
    };
    for row in 0..rows {
        let y = top + row as i32;
        if y < 0 || y >= height as i32 {
            continue;
        }
        for col in 0..shape.width {
            let x = left + col as i32;
            if x < 0 || x >= width as i32 {
                continue;
            }
            let at = (y as usize * width + x as usize) * 4;
            let dst = &mut frame[at..at + 3];
            if monochrome {
                let bit =
                    |r: usize| shape.data[r * shape.pitch + col / 8] & (0x80 >> (col % 8)) != 0;
                let (and, xor) = (bit(row), bit(row + rows));
                for c in dst.iter_mut() {
                    *c = (if and { *c } else { 0 }) ^ (if xor { 0xff } else { 0 });
                }
                continue;
            }
            let src = &shape.data[row * shape.pitch + col * 4..row * shape.pitch + col * 4 + 4];
            if shape.kind == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR.0 {
                for (c, s) in dst.iter_mut().zip(src) {
                    *c = if src[3] == 0 { *s } else { *c ^ *s };
                }
            } else if shape.kind == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_COLOR.0 {
                let alpha = src[3] as u32;
                for (c, s) in dst.iter_mut().zip(src) {
                    *c = ((*s as u32 * alpha + *c as u32 * (255 - alpha) + 127) / 255) as u8;
                }
            }
        }
    }
}

/// The pointer as straight RGBA for a viewer to draw. A pixel that inverts
/// the screen has no colour of its own, so it comes out opaque black.
fn straight_rgba(shape: &DuplicatedShape) -> (usize, usize, Vec<u8>) {
    let monochrome = shape.kind == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME.0;
    let masked = shape.kind == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR.0;
    let rows = if monochrome {
        shape.height / 2
    } else {
        shape.height
    };
    let mut rgba = Vec::with_capacity(shape.width * rows * 4);
    for row in 0..rows {
        for col in 0..shape.width {
            let pixel = if monochrome {
                let bit =
                    |r: usize| shape.data[r * shape.pitch + col / 8] & (0x80 >> (col % 8)) != 0;
                match (bit(row), bit(row + rows)) {
                    (true, false) => [0, 0, 0, 0],
                    (false, true) => [0xff, 0xff, 0xff, 0xff],
                    _ => [0, 0, 0, 0xff],
                }
            } else {
                let at = row * shape.pitch + col * 4;
                let (b, g, r, a) = (
                    shape.data[at],
                    shape.data[at + 1],
                    shape.data[at + 2],
                    shape.data[at + 3],
                );
                match (masked, a, [r, g, b]) {
                    (false, _, _) => [r, g, b, a],
                    (true, 0, _) => [r, g, b, 0xff],
                    (true, _, [0, 0, 0]) => [0, 0, 0, 0],
                    (true, _, _) => [0, 0, 0, 0xff],
                }
            };
            rgba.extend_from_slice(&pixel);
        }
    }
    (shape.width, rows, rgba)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

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

        fn on_audio(&self, _packet: crate::AudioPacket) {}

        fn on_error(&self, error: MediaError) {
            self.errors.lock().unwrap().push(error.to_string());
        }
    }

    /// Only machines with a desktop to duplicate (not every CI runner) get
    /// past `start`; there the first frame must be a keyframe.
    #[test]
    fn streams_the_main_display_where_there_is_one() {
        let frames = Arc::new(Frames::default());
        let config = StreamConfig {
            audio: false,
            ..StreamConfig::default()
        };
        let stream = match start(config, frames.clone()) {
            Ok(stream) => stream,
            Err(e) => {
                eprintln!("no desktop to capture: {e}");
                return;
            }
        };
        stream.request_keyframe();
        let started = Instant::now();
        while frames.frames.lock().unwrap().is_empty() && started.elapsed() < Duration::from_secs(5)
        {
            std::thread::sleep(Duration::from_millis(20));
        }
        let info = stream.info().clone();
        drop(stream);
        assert_eq!(*frames.errors.lock().unwrap(), Vec::<String>::new());
        let frames = frames.frames.lock().unwrap();
        eprintln!("captured {} frames of {info:?}", frames.len());
        let first = frames.first().expect("a frame within 5 seconds");
        assert!(first.keyframe);
        assert!(first
            .data
            .windows(5)
            .any(|w| w[..4] == [0, 0, 0, 1] && w[4] & 0x1f == 7));
        assert!(info.width.is_multiple_of(2) && info.height.is_multiple_of(2));
        assert!(info.encoder == "mediafoundation" || info.encoder == "openh264");
    }

    fn pixels(values: &[u8]) -> Vec<u8> {
        values.iter().flat_map(|&v| [v, v, v, 255]).collect()
    }

    #[test]
    fn turns_rotated_outputs_upright() {
        let src = pixels(&[1, 2, 3, 4, 5, 6]);
        let mut out = Vec::new();
        assert_eq!(turn(&src, 3, 2, 12, 0, &mut out), (3, 2));
        assert_eq!(out, pixels(&[1, 2, 3, 4, 5, 6]));
        assert_eq!(turn(&src, 3, 2, 12, 1, &mut out), (2, 3));
        assert_eq!(out, pixels(&[4, 1, 5, 2, 6, 3]));
        assert_eq!(turn(&src, 3, 2, 12, 2, &mut out), (3, 2));
        assert_eq!(out, pixels(&[6, 5, 4, 3, 2, 1]));
        assert_eq!(turn(&src, 3, 2, 12, 3, &mut out), (2, 3));
        assert_eq!(out, pixels(&[3, 6, 2, 5, 1, 4]));
    }

    #[test]
    fn skips_row_padding() {
        let mut src = pixels(&[7, 8]);
        src.extend_from_slice(&[0; 8]);
        src.extend(pixels(&[9, 10]));
        let mut out = Vec::new();
        assert_eq!(turn(&src, 2, 2, 16, 0, &mut out), (2, 2));
        assert_eq!(out, pixels(&[7, 8, 9, 10]));
    }

    #[test]
    fn blends_colour_pointers_and_clips_them() {
        let mut frame = pixels(&[100; 4]);
        let shape = DuplicatedShape {
            kind: DXGI_OUTDUPL_POINTER_SHAPE_TYPE_COLOR.0,
            width: 2,
            height: 1,
            pitch: 8,
            data: vec![255, 255, 255, 255, 0, 0, 0, 0],
        };
        draw_pointer(&mut frame, 2, 2, &shape, 1, 1);
        assert_eq!(frame, pixels(&[100, 100, 100, 255]));
        draw_pointer(&mut frame, 2, 2, &shape, -1, 0);
        assert_eq!(frame, pixels(&[100, 100, 100, 255]));
    }

    #[test]
    fn applies_monochrome_and_and_xor_masks() {
        let mut frame = pixels(&[100, 100]);
        let shape = DuplicatedShape {
            kind: DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME.0,
            width: 2,
            height: 2,
            pitch: 1,
            data: vec![0b0100_0000, 0b1100_0000],
        };
        draw_pointer(&mut frame, 2, 1, &shape, 0, 0);
        assert_eq!(frame, pixels(&[255, 155]));
    }

    #[test]
    fn masked_colour_pointers_replace_or_invert() {
        let mut frame = pixels(&[100, 100]);
        let shape = DuplicatedShape {
            kind: DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR.0,
            width: 2,
            height: 1,
            pitch: 8,
            data: vec![10, 10, 10, 0, 0xff, 0xff, 0xff, 0xff],
        };
        draw_pointer(&mut frame, 2, 1, &shape, 0, 0);
        assert_eq!(frame, pixels(&[10, 155]));
    }

    #[test]
    fn monochrome_pointers_become_transparent_black_or_white() {
        let shape = DuplicatedShape {
            kind: DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME.0,
            width: 4,
            height: 2,
            pitch: 1,
            data: vec![0b1001_0000, 0b0011_0000],
        };
        assert_eq!(
            straight_rgba(&shape),
            (
                4,
                1,
                vec![0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0xff]
            )
        );
    }

    #[test]
    fn masked_colour_pointers_keep_their_colour_and_blacken_inversions() {
        let shape = DuplicatedShape {
            kind: DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR.0,
            width: 3,
            height: 1,
            pitch: 12,
            data: vec![10, 20, 30, 0, 0, 0, 0, 0xff, 5, 6, 7, 0xff],
        };
        assert_eq!(
            straight_rgba(&shape),
            (3, 1, vec![30, 20, 10, 0xff, 0, 0, 0, 0, 0, 0, 0, 0xff])
        );
    }

    #[test]
    fn colour_pointers_swap_bgra_to_rgba_and_skip_row_padding() {
        let shape = DuplicatedShape {
            kind: DXGI_OUTDUPL_POINTER_SHAPE_TYPE_COLOR.0,
            width: 2,
            height: 2,
            pitch: 12,
            data: vec![
                1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, //
                9, 10, 11, 12, 13, 14, 15, 16, 0, 0, 0, 0,
            ],
        };
        assert_eq!(
            straight_rgba(&shape),
            (
                2,
                2,
                vec![3, 2, 1, 4, 7, 6, 5, 8, 11, 10, 9, 12, 15, 14, 13, 16]
            )
        );
    }
}
