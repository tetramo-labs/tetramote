import {describe, expect, it} from "vitest"

import {codeForCharacter, contentRect, encodeRecords, FLAG_COMMAND, MOUSE_RIGHT, scrollFromWheel} from "@/input"

const bytes = (events: Parameters<typeof encodeRecords>[0]) => [...encodeRecords(events)]

describe("input records", () => {
  it("encodes the same bytes as the core and the phone", () => {
    expect(bytes([{kind: "move", dx: 1, dy: -2}])).toEqual([0, 9, 0x01, 0x3f, 0x80, 0, 0, 0xc0, 0, 0, 0])
    expect(bytes([{kind: "button", button: MOUSE_RIGHT, down: true, clicks: 2}])).toEqual([0, 4, 0x03, 1, 1, 2])
    expect(bytes([{kind: "key", keyCode: 0x08, down: true, flags: FLAG_COMMAND}])).toEqual([
      0, 8, 0x05, 0, 0x08, 1, 0, 0x10, 0, 0,
    ])
    expect(bytes([{kind: "text", text: "é"}])).toEqual([0, 3, 0x06, 0xc3, 0xa9])
  })

  it("lays out absolute moves and scrolls as PROTOCOL.md does", () => {
    expect(bytes([{kind: "moveTo", x: 0.5, y: 1}])).toEqual([0, 9, 0x02, 0x3f, 0, 0, 0, 0x3f, 0x80, 0, 0])
    expect(bytes([{kind: "scroll", dx: 0, dy: 2, phase: 2}])).toEqual([0, 10, 0x04, 0, 0, 0, 0, 0x40, 0, 0, 0, 2])
  })

  it("joins records and cuts long text on a character boundary", () => {
    expect(
      encodeRecords([
        {kind: "move", dx: 0, dy: 0},
        {kind: "text", text: "a"},
      ]).length,
    ).toBe(11 + 4)
    const long = encodeRecords([{kind: "text", text: "é".repeat(600)}])
    expect(long.length).toBe(2 + 1 + 1000)
    expect(encodeRecords([{kind: "text", text: ""}]).length).toBe(0)
  })

  it("maps wheel deltas to finger movement and fits the picture", () => {
    expect(scrollFromWheel({deltaX: 0, deltaY: 3, deltaMode: 1})).toEqual({kind: "scroll", dx: -0, dy: -48, phase: 0})
    expect(contentRect({left: 0, top: 0, width: 400, height: 400}, 2)).toEqual({
      left: 0,
      top: 100,
      width: 400,
      height: 200,
    })
    expect(codeForCharacter("c")).toBe("KeyC")
    expect(codeForCharacter("7")).toBe("Digit7")
    expect(codeForCharacter("é")).toBeNull()
  })
})
