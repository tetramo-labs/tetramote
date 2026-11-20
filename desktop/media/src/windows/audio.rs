//! System audio through WASAPI loopback: cpal opens the default output
//! device as an input stream, which captures what it plays. cpal streams
//! aren't `Send` everywhere, so the stream lives on its own thread.

use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;

use crate::host::{now_us, AudioPacketizer};
use crate::{MediaError, Result, StreamSink};

pub struct AudioCapture {
    stop: mpsc::Sender<()>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for AudioCapture {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub fn start(sink: Arc<dyn StreamSink>) -> Result<AudioCapture> {
    let (stop_tx, stop_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let thread = std::thread::Builder::new()
        .name("tetra-loopback".into())
        .spawn(move || match open(sink) {
            Ok(stream) => {
                let _ = ready_tx.send(Ok(()));
                let _ = stop_rx.recv();
                drop(stream);
            }
            Err(e) => {
                let _ = ready_tx.send(Err(e));
            }
        })
        .map_err(|e| {
            MediaError::Failed(format!(
                "The system audio thread didn't start: {e}. Reconnect to try again."
            ))
        })?;
    ready_rx.recv().map_err(|_| {
        MediaError::Failed(
            "System audio capture stopped while starting. Reconnect to try again.".into(),
        )
    })??;
    Ok(AudioCapture {
        stop: stop_tx,
        thread: Some(thread),
    })
}

fn open(sink: Arc<dyn StreamSink>) -> Result<cpal::Stream> {
    let device = cpal::default_host().default_output_device().ok_or_else(|| {
        MediaError::Unsupported("No audio output device to capture. Connect speakers or headphones, then reconnect.".into())
    })?;
    let supported = device.default_output_config().map_err(|e| {
        MediaError::Failed(format!("Reading the audio output format failed: {e}. Check Windows sound settings, then reconnect."))
    })?;
    let config = supported.config();
    let mut packetizer = AudioPacketizer::new(config.sample_rate, config.channels as usize)?;
    let on_error = |e: cpal::Error| log::warn!("system audio capture error: {e}");
    let stream = match supported.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| deliver(&mut packetizer, sink.as_ref(), data),
            on_error,
            None,
        ),
        SampleFormat::I16 => {
            let mut scratch = Vec::new();
            device.build_input_stream(
                config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    scratch.clear();
                    scratch.extend(data.iter().map(|&s| s as f32 / 32_768.0));
                    deliver(&mut packetizer, sink.as_ref(), &scratch);
                },
                on_error,
                None,
            )
        }
        other => {
            return Err(MediaError::Unsupported(format!(
                "System audio plays as {other}, which Tetramote can't capture yet. Switch the output device to a 16-bit or 32-bit float format in Windows sound settings."
            )))
        }
    }
    .map_err(|e| {
        MediaError::Failed(format!("Opening system audio capture failed: {e}. Check Windows sound settings, then reconnect."))
    })?;
    stream.play().map_err(|e| {
        MediaError::Failed(format!("Starting system audio capture failed: {e}. Check Windows sound settings, then reconnect."))
    })?;
    Ok(stream)
}

fn deliver(packetizer: &mut AudioPacketizer, sink: &dyn StreamSink, samples: &[f32]) {
    match packetizer.push(samples, now_us()) {
        Ok(packets) => packets.into_iter().for_each(|p| sink.on_audio(p)),
        Err(e) => log::warn!("system audio encoding failed: {e}"),
    }
}
