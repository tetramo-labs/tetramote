export const HEADER_BYTES = 13

export interface Frame {
  seq: number
  ptsUs: number
  keyframe: boolean
  data: Uint8Array
}

/** A video event from the backend: the 13-byte frame header, then an Annex B access unit. */
export function parseFrame(buffer: ArrayBuffer): Frame | null {
  if (buffer.byteLength <= HEADER_BYTES) return null
  const view = new DataView(buffer)
  return {
    seq: view.getUint32(0),
    ptsUs: Number(view.getBigUint64(4)),
    keyframe: (view.getUint8(12) & 1) === 1,
    data: new Uint8Array(buffer, HEADER_BYTES),
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
