//! System audio from the default sink's monitor through PipeWire, which
//! converts it to the 48 kHz stereo f32 the Opus packetizer wants.

use std::io::Cursor;
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;

use pipewire as pw;
use pw::context::ContextRc;
use pw::main_loop::MainLoopRc;
use pw::properties::properties;
use pw::spa::param::audio::{AudioFormat, AudioInfoRaw, MAX_CHANNELS};
use pw::spa::param::ParamType;
use pw::spa::pod::serialize::PodSerializer;
use pw::spa::pod::{Object, Pod, Value};
use pw::spa::utils::{Direction, SpaTypes};
use pw::stream::{StreamBox, StreamFlags};

use crate::host::{now_us, AudioPacketizer};
use crate::opus::{OPUS_CHANNELS, OPUS_SAMPLE_RATE};
use crate::{MediaError, Result, StreamSink};

pub struct AudioCapture {
    quit: pw::channel::Sender<()>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for AudioCapture {
    fn drop(&mut self) {
        let _ = self.quit.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub fn start(sink: Arc<dyn StreamSink>) -> Result<AudioCapture> {
    let (quit_tx, quit_rx) = pw::channel::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let thread = std::thread::Builder::new()
        .name("tetra-sink-monitor".into())
        .spawn(move || {
            if let Err(e) = run(sink, quit_rx, &ready_tx) {
                let _ = ready_tx.send(Err(e));
            }
        })
        .map_err(|e| {
            MediaError::Failed(format!(
                "The system audio thread didn't start: {e}. Reconnect to try again."
            ))
        })?;
    let started = ready_rx
        .recv()
        .map_err(|_| {
            MediaError::Failed(
                "System audio capture stopped while starting. Reconnect to try again.".into(),
            )
        })
        .and_then(|r| r);
    let capture = AudioCapture {
        quit: quit_tx,
        thread: Some(thread),
    };
    started.map(|()| capture)
}

fn run(
    sink: Arc<dyn StreamSink>,
    quit: pw::channel::Receiver<()>,
    ready: &mpsc::Sender<Result<()>>,
) -> Result<()> {
    let mainloop = MainLoopRc::new(None).map_err(unavailable)?;
    let context = ContextRc::new(&mainloop, None).map_err(unavailable)?;
    let core = context.connect_rc(None).map_err(unavailable)?;
    let stream = StreamBox::new(
        &core,
        "tetratop-system-audio",
        properties! {
            *pw::keys::MEDIA_TYPE => "Audio",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Music",
            *pw::keys::STREAM_CAPTURE_SINK => "true",
            *pw::keys::NODE_LATENCY => "480/48000",
        },
    )
    .map_err(unavailable)?;
    let packetizer = AudioPacketizer::new(OPUS_SAMPLE_RATE, OPUS_CHANNELS)?;
    let mut samples = Vec::new();
    let _listener = stream
        .add_local_listener_with_user_data(packetizer)
        .process(move |stream, packetizer| {
            let Some(mut buffer) = stream.dequeue_buffer() else {
                return;
            };
            let Some(data) = buffer.datas_mut().first_mut() else {
                return;
            };
            let (offset, size) = (data.chunk().offset() as usize, data.chunk().size() as usize);
            let Some(bytes) = data.data() else { return };
            let end = (offset + size).min(bytes.len());
            samples.clear();
            samples.extend(
                bytes[offset.min(end)..end]
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .map(|&b| f32::from_le_bytes(b)),
            );
            match packetizer.push(&samples, now_us()) {
                Ok(packets) => packets.into_iter().for_each(|p| sink.on_audio(p)),
                Err(e) => log::warn!("system audio encoding failed: {e}"),
            }
        })
        .register()
        .map_err(unavailable)?;
    let format = audio_format()?;
    let mut params =
        [Pod::from_bytes(&format)
            .ok_or_else(|| unavailable("the audio format didn't serialize"))?];
    stream
        .connect(
            Direction::Input,
            None,
            StreamFlags::AUTOCONNECT | StreamFlags::MAP_BUFFERS,
            &mut params,
        )
        .map_err(unavailable)?;
    let _quit = quit.attach(mainloop.loop_(), {
        let mainloop = mainloop.clone();
        move |()| mainloop.quit()
    });
    let _ = ready.send(Ok(()));
    mainloop.run();
    Ok(())
}

fn unavailable(e: impl std::fmt::Display) -> MediaError {
    MediaError::Unsupported(format!(
        "System audio can't be captured through PipeWire ({e}). Start PipeWire with its PulseAudio replacement, or turn sound off for this session."
    ))
}

fn audio_format() -> Result<Vec<u8>> {
    let mut info = AudioInfoRaw::new();
    info.set_format(AudioFormat::F32LE);
    info.set_rate(OPUS_SAMPLE_RATE);
    info.set_channels(OPUS_CHANNELS as u32);
    let mut position = [0; MAX_CHANNELS];
    position[0] = pw::spa::sys::SPA_AUDIO_CHANNEL_FL;
    position[1] = pw::spa::sys::SPA_AUDIO_CHANNEL_FR;
    info.set_position(position);
    let object = Object {
        type_: SpaTypes::ObjectParamFormat.as_raw(),
        id: ParamType::EnumFormat.as_raw(),
        properties: info.into(),
    };
    PodSerializer::serialize(Cursor::new(Vec::new()), &Value::Object(object))
        .map(|(cursor, _)| cursor.into_inner())
        .map_err(|e| unavailable(format!("{e:?}")))
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use super::*;
    use crate::{AudioPacket, EncodedFrame};

    #[derive(Default)]
    struct Packets {
        packets: Mutex<Vec<AudioPacket>>,
        errors: Mutex<Vec<String>>,
    }

    impl StreamSink for Packets {
        fn should_encode(&self) -> bool {
            true
        }

        fn on_video(&self, _frame: EncodedFrame) {}

        fn on_audio(&self, packet: AudioPacket) {
            self.packets.lock().unwrap().push(packet);
        }

        fn on_error(&self, error: MediaError) {
            self.errors.lock().unwrap().push(error.to_string());
        }
    }

    /// Needs a running PipeWire with a default sink; run with `--ignored`.
    #[test]
    #[ignore]
    fn packets_the_default_sinks_monitor() {
        let packets = Arc::new(Packets::default());
        let capture = start(packets.clone()).unwrap();
        let started = Instant::now();
        while packets.packets.lock().unwrap().len() < 10
            && started.elapsed() < Duration::from_secs(5)
        {
            std::thread::sleep(Duration::from_millis(20));
        }
        drop(capture);
        assert_eq!(*packets.errors.lock().unwrap(), Vec::<String>::new());
        let packets = packets.packets.lock().unwrap();
        eprintln!("{} packets from the sink monitor", packets.len());
        assert!(packets.len() >= 10);
        assert!(packets.windows(2).all(|w| w[1].pts_us > w[0].pts_us));
        assert!(packets.iter().all(|p| !p.data.is_empty()));
    }

    #[test]
    fn serializes_the_audio_format() {
        let format = audio_format().unwrap();
        assert!(Pod::from_bytes(&format).is_some());
    }
}
