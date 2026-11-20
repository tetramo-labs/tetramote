const SAMPLE_RATE = 48000
const CHANNELS = 2
const AUDIO_HEADER_BYTES = 12
const LEAD_SECONDS = 0.06
const MAX_AHEAD_SECONDS = 0.3

/**
 * The computer's Opus audio (48 kHz stereo, one 20 ms packet per event) through WebCodecs, scheduled a little
 * ahead on an AudioContext. A late packet resets the schedule instead of piling up delay.
 */
export class AudioPipe {
  private readonly context = new AudioContext({sampleRate: SAMPLE_RATE, latencyHint: "interactive"})
  private readonly decoder: AudioDecoder
  private playhead = 0

  static supported(): boolean {
    return typeof AudioDecoder !== "undefined" && typeof AudioContext !== "undefined"
  }

  constructor() {
    this.decoder = new AudioDecoder({output: (data) => this.play(data), error: () => undefined})
    this.decoder.configure({codec: "opus", sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS})
  }

  /** Browsers start audio only after a tap or click; call this from one. */
  resume() {
    void this.context.resume()
  }

  push(event: Uint8Array) {
    if (event.byteLength <= AUDIO_HEADER_BYTES || this.decoder.state !== "configured") return
    const view = new DataView(event.buffer, event.byteOffset, event.byteLength)
    try {
      this.decoder.decode(
        new EncodedAudioChunk({
          type: "key",
          timestamp: Number(view.getBigUint64(4)),
          data: event.subarray(AUDIO_HEADER_BYTES),
        }),
      )
    } catch {
      return
    }
  }

  close() {
    if (this.decoder.state !== "closed") this.decoder.close()
    void this.context.close()
  }

  private play(data: AudioData) {
    const frames = data.numberOfFrames
    const buffer = this.context.createBuffer(data.numberOfChannels, frames, data.sampleRate)
    for (let channel = 0; channel < data.numberOfChannels; channel++) {
      const plane = new Float32Array(frames)
      data.copyTo(plane, {planeIndex: channel, format: "f32-planar"})
      buffer.copyToChannel(plane, channel)
    }
    data.close()
    const now = this.context.currentTime
    if (this.playhead < now || this.playhead > now + MAX_AHEAD_SECONDS) this.playhead = now + LEAD_SECONDS
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.context.destination)
    source.start(this.playhead)
    this.playhead += buffer.duration
  }
}
