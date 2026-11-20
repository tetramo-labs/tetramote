export const HEADER_BYTES = 13

export interface Frame {
  seq: number
  ptsUs: number
  keyframe: boolean
  data: Uint8Array
}

/** A video event: the 13-byte frame header from PROTOCOL.md, then an Annex B access unit. */
export function parseFrame(buffer: Uint8Array): Frame | null {
  if (buffer.byteLength <= HEADER_BYTES) return null
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  return {
    seq: view.getUint32(0),
    ptsUs: Number(view.getBigUint64(4)),
    keyframe: (view.getUint8(12) & 1) === 1,
    data: buffer.subarray(HEADER_BYTES),
  }
}

/** NAL unit payloads (start codes removed) in an Annex B buffer. */
export function nalUnits(data: Uint8Array): Uint8Array[] {
  const units: Uint8Array[] = []
  let start = -1
  let i = 0
  while (i + 2 < data.length) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      if (start >= 0) {
        let end = i
        while (end > start && data[end - 1] === 0) end--
        units.push(data.subarray(start, end))
      }
      i += 3
      start = i
    } else {
      i++
    }
  }
  if (start >= 0 && start < data.length) units.push(data.subarray(start))
  return units
}

const hex = (n: number) => n.toString(16).padStart(2, "0")

/** The WebCodecs codec string (`avc1.PPCCLL`) for the SPS in a keyframe, or null without one. */
export function codecString(keyframe: Uint8Array): string | null {
  const sps = nalUnits(keyframe).find((n) => (n[0] & 0x1f) === 7 && n.length >= 4)
  return sps ? `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}` : null
}

const MAX_QUEUE = 4

interface Callbacks {
  draw: (frame: VideoFrame) => void
  needKeyframe: () => void
  onError: (message: string) => void
}

/**
 * H.264 decoding through WebCodecs, configured from the first keyframe's SPS. After an error or a backed-up queue
 * it drops everything up to the next keyframe and asks the computer for one.
 */
export class VideoPipe {
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
    this.cb.onError(`Video decoding hit an error (${message}). Asking the computer for a fresh picture.`)
    this.close()
    this.codec = null
    this.waitingForKey = true
    this.cb.needKeyframe()
  }
}
