import {describe, expect, it} from "vitest"

import {deviceName, failureText} from "@/messages"
import {codecString, parseFrame} from "@/video"

describe("device names and failures", () => {
  it("names the browser and its system", () => {
    expect(
      deviceName(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 27_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.1 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPhone")
    expect(
      deviceName(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0",
      ),
    ).toBe("Edge on Windows")
    expect(deviceName("Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0")).toBe(
      "Firefox on Linux",
    )
  })

  it("says what to do when the link changed or the computer can't be reached", () => {
    expect(failureText("badSecret", "Studio Mac")).toBe(
      "This link no longer works because Studio Mac made a new one. Copy the current link from Tetramote on that computer.",
    )
    expect(failureText("closed by peer: linkChanged (code 4)", "Studio Mac")).toContain("made a new one")
    expect(failureText("timedOut", "Studio Mac")).toBe(
      "Couldn't reach Studio Mac. Check that it's on and Tetramote is running, then try again.",
    )
    expect(failureText("closed by peer: replaced (code 2)", "Studio Mac")).toContain("Another device connected")
  })
})

describe("video frames", () => {
  it("reads the 13-byte header and the SPS profile", () => {
    const event = Uint8Array.of(0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0x03, 0xe8, 1, 0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28, 0xac)
    const frame = parseFrame(event)
    expect(frame?.seq).toBe(7)
    expect(frame?.ptsUs).toBe(1000)
    expect(frame?.keyframe).toBe(true)
    expect(codecString(frame!.data)).toBe("avc1.640028")
  })
})
