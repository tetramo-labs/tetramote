import {encodeInput, FLAG_COMMAND, MOUSE_RIGHT, SCROLL_CHANGED} from "./input"

const bytes = (a: Uint8Array) => Array.from(a)

describe("encodeInput", () => {
  it("frames a relative move as u16 length, type 0x01, two big-endian f32", () => {
    expect(bytes(encodeInput([{kind: "move", dx: 1, dy: -2}]))).toEqual([0, 9, 0x01, 0x3f, 0x80, 0, 0, 0xc0, 0, 0, 0])
  })

  it("frames a right-button press with its click count", () => {
    expect(bytes(encodeInput([{kind: "button", button: MOUSE_RIGHT, down: true, clicks: 2}]))).toEqual([
      0, 4, 0x03, 1, 1, 2,
    ])
  })

  it("frames a scroll with its phase byte", () => {
    expect(bytes(encodeInput([{kind: "scroll", dx: 0, dy: 0.5, phase: SCROLL_CHANGED}]))).toEqual([
      0, 10, 0x04, 0, 0, 0, 0, 0x3f, 0, 0, 0, 2,
    ])
  })

  it("frames ⌘C as key code, down flag and CGEventFlags", () => {
    expect(bytes(encodeInput([{kind: "key", keyCode: 0x08, down: true, flags: FLAG_COMMAND}]))).toEqual([
      0, 8, 0x05, 0, 0x08, 1, 0, 0x10, 0, 0,
    ])
  })

  it("concatenates records and encodes text as UTF-8", () => {
    expect(
      bytes(
        encodeInput([
          {kind: "text", text: "é"},
          {kind: "moveTo", x: 0, y: 1},
        ]),
      ),
    ).toEqual([0, 3, 0x06, 0xc3, 0xa9, 0, 9, 0x02, 0, 0, 0, 0, 0x3f, 0x80, 0, 0])
  })

  it("cuts long text at 1000 bytes without splitting a character", () => {
    const record = encodeInput([{kind: "text", text: "a" + "é".repeat(600)}])
    expect(record.length).toBe(3 + 999)
    expect((record[0] << 8) | record[1]).toBe(1000)
  })
})
