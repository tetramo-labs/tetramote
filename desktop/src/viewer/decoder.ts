import {codecString, type Frame} from "@/viewer/frames"

const MAX_QUEUE = 4

interface Callbacks {
  draw: (frame: VideoFrame) => void
  needKeyframe: () => void
  onError: (message: string) => void
}

/**
 * Hardware H.264 decoding through WebCodecs. Configured from the first
 * keyframe's SPS; after an error or a backed-up queue it drops everything up
 * to the next keyframe and asks the host for one.
 */
export class RemoteDecoder {
  private decoder: VideoDecoder | null = null
  private codec: string | null = null
  private waitingForKey = true

  constructor(private readonly cb: Callbacks) {}

  static supported(): boolean {
    return typeof VideoDecoder !== "undefined"
  }

  push(frame: Frame) {
    if (frame.keyframe) {
      const codec = codecString(frame.data)
      if (codec && codec !== this.codec) this.configure(codec)
      this.waitingForKey = false
    }
    const decoder = this.decoder
    if (!decoder || decoder.state !== "configured" || this.waitingForKey) return
    if (!frame.keyframe && decoder.decodeQueueSize > MAX_QUEUE) {
      this.waitingForKey = true
      this.cb.needKeyframe()
      return
    }
    try {
      decoder.decode(
        new EncodedVideoChunk({type: frame.keyframe ? "key" : "delta", timestamp: frame.ptsUs, data: frame.data}),
      )
    } catch (error) {
      this.recover(String(error))
    }
  }

  close() {
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close()
    this.decoder = null
  }

  private configure(codec: string) {
    this.close()
    this.codec = codec
    this.decoder = new VideoDecoder({
      output: (frame) => this.cb.draw(frame),
      error: (error) => this.recover(String(error)),
    })
    this.decoder.configure({codec, optimizeForLatency: true, hardwareAcceleration: "prefer-hardware"})
  }

  private recover(message: string) {
    this.cb.onError(`Video decoding hit an error (${message}); asking for a fresh picture.`)
    this.close()
    this.codec = null
    this.waitingForKey = true
    this.cb.needKeyframe()
  }
}
