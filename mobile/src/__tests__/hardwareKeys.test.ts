import {FLAG_COMMAND, FLAG_SHIFT} from "@tetramote/remote"

import {HardwareKeys} from "@/services/hardwareKeys"

describe("HardwareKeys", () => {
  it("sends keys by position with the modifiers held, raw", () => {
    const keys = new HardwareKeys()
    expect(keys.handle({usage: 0xe3, down: true}, "raw")).toEqual({
      send: [{kind: "key", keyCode: 0x37, down: true, flags: FLAG_COMMAND}],
      repeat: false,
    })
    expect(keys.handle({usage: 0x06, down: true}, "raw")).toEqual({
      send: [{kind: "key", keyCode: 0x08, down: true, flags: FLAG_COMMAND}],
      repeat: true,
    })
    keys.handle({usage: 0xe3, down: false}, "raw")
    expect(keys.flags()).toBe(0)
  })

  it("maps Android key codes through the same positions", () => {
    const keys = new HardwareKeys()
    keys.handle({code: 59, down: true}, "raw")
    expect(keys.handle({code: 29, down: true}, "raw")).toEqual({
      send: [{kind: "key", keyCode: 0x00, down: true, flags: FLAG_SHIFT}],
      repeat: true,
    })
  })

  it("types with the phone's layout when translated, but keeps arrows and shortcuts by position", () => {
    const keys = new HardwareKeys()
    expect(keys.handle({code: 29, down: true, unicode: 0x72}, "translated")).toEqual({type: "r"})
    expect(keys.handle({usage: 0x04, down: true}, "translated")).toEqual({ignore: true})
    expect(keys.handle({usage: 0x50, down: true}, "translated")).toEqual({
      send: [{kind: "key", keyCode: 0x7b, down: true, flags: 0}],
      repeat: true,
    })
    keys.handle({usage: 0xe0, down: true}, "translated")
    expect(keys.handle({usage: 0x04, down: true}, "translated")).toMatchObject({send: [{keyCode: 0x00}]})
  })

  it("leaves shifted characters to the phone's text field on iOS when translated", () => {
    const keys = new HardwareKeys()
    keys.handle({usage: 0xe1, down: true}, "translated")
    expect(keys.handle({usage: 0x04, down: true}, "translated")).toEqual({ignore: true})
    expect(keys.handle({usage: 0x1e, down: true}, "translated")).toEqual({ignore: true})
  })

  it("sends Return, Delete and Command shortcuts by position when translated", () => {
    const keys = new HardwareKeys()
    expect(keys.handle({usage: 0x28, down: true}, "translated")).toEqual({
      send: [{kind: "key", keyCode: 0x24, down: true, flags: 0}],
      repeat: true,
    })
    expect(keys.handle({usage: 0x2a, down: true}, "translated")).toEqual({
      send: [{kind: "key", keyCode: 0x33, down: true, flags: 0}],
      repeat: true,
    })
    keys.handle({usage: 0xe3, down: true}, "translated")
    expect(keys.handle({usage: 0x06, down: true}, "translated")).toEqual({
      send: [{kind: "key", keyCode: 0x08, down: true, flags: FLAG_COMMAND}],
      repeat: true,
    })
  })
})
