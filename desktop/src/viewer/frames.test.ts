import {describe, expect, it} from "vitest"

import {codecString, nalUnits, parseFrame} from "@/viewer/frames"

const SPS = [0x67, 0x64, 0x00, 0x28, 0xac]
const PPS = [0x68, 0xee, 0x3c]
const IDR = [0x65, 0x88, 0x84]
const keyframe = new Uint8Array([0, 0, 0, 1, ...SPS, 0, 0, 0, 1, ...PPS, 0, 0, 1, ...IDR])

describe("frames", () => {
  it("parses the 13-byte header", () => {
    const buffer = new Uint8Array([0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0x03, 0xe8, 1, 0xaa, 0xbb]).buffer
    const frame = parseFrame(buffer)
    expect(frame?.seq).toBe(7)
    expect(frame?.ptsUs).toBe(1000)
    expect(frame?.keyframe).toBe(true)
    expect(Array.from(frame?.data ?? [])).toEqual([0xaa, 0xbb])
    expect(parseFrame(new Uint8Array(13).buffer)).toBeNull()
  })

  it("splits Annex B with 3- and 4-byte start codes", () => {
    expect(nalUnits(keyframe).map((n) => Array.from(n))).toEqual([SPS, PPS, IDR])
  })

  it("builds the codec string from the SPS", () => {
    expect(codecString(keyframe)).toBe("avc1.640028")
    expect(codecString(new Uint8Array([0, 0, 1, ...IDR]))).toBeNull()
  })
})
