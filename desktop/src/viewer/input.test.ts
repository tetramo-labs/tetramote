import {describe, expect, it} from "vitest"

import {
  contentRect,
  keyAction,
  type KeyEvent,
  modifierFlags,
  normalized,
  protocolButton,
  scrollFromWheel,
} from "@/viewer/input"

const NONE = {shiftKey: false, ctrlKey: false, altKey: false, metaKey: false}
const down = (code: string, key: string, mods: Partial<KeyEvent> = {}): KeyEvent => ({
  type: "keydown",
  code,
  key,
  ...NONE,
  ...mods,
})
const up = (code: string, key: string, mods: Partial<KeyEvent> = {}): KeyEvent => ({
  ...down(code, key, mods),
  type: "keyup",
})
const nothingDown = new Set<string>()

describe("viewer input", () => {
  it("finds the letterboxed picture and maps clicks into it", () => {
    const content = contentRect({left: 0, top: 40, width: 1000, height: 800}, 1.6)
    expect(content).toEqual({left: 0, top: 127.5, width: 1000, height: 625})
    expect(normalized(500, 440, content)).toEqual({x: 0.5, y: 0.5})
    expect(normalized(-20, 1000, content)).toEqual({x: 0, y: 1})
  })

  it("maps buttons and modifiers to the protocol", () => {
    expect([0, 1, 2, 3].map(protocolButton)).toEqual([0, 2, 1, null])
    expect(modifierFlags({shiftKey: true, ctrlKey: false, altKey: true, metaKey: true})).toBe(0x1a0000)
  })

  it("turns wheel deltas into finger-direction pixels", () => {
    expect(scrollFromWheel({deltaX: 2, deltaY: -10, deltaMode: 0})).toEqual({kind: "scroll", dx: -2, dy: 10})
    expect(scrollFromWheel({deltaX: 0, deltaY: 3, deltaMode: 1})).toEqual({kind: "scroll", dx: -0, dy: -48})
  })

  it("types this computer's characters in Translated and drops their keyups", () => {
    expect(keyAction(down("KeyA", "a"), "translated", nothingDown)).toEqual({kind: "text", text: "a"})
    expect(keyAction(down("KeyA", "A", {shiftKey: true}), "translated", nothingDown)).toEqual({kind: "text", text: "A"})
    expect(keyAction(down("KeyE", "é", {altKey: true}), "translated", nothingDown)).toEqual({kind: "text", text: "é"})
    expect(keyAction(down("KeyY", "z"), "translated", nothingDown)).toEqual({kind: "text", text: "z"})
    expect(keyAction(down("Space", " "), "translated", nothingDown)).toEqual({kind: "text", text: " "})
    expect(keyAction(up("KeyA", "a"), "translated", nothingDown)).toBeNull()
  })

  it("sends shortcuts, modifiers and keys without a character by position in Translated", () => {
    expect(keyAction(down("KeyC", "c", {metaKey: true}), "translated", nothingDown)).toEqual({
      kind: "key",
      code: "KeyC",
      down: true,
      flags: 0x100000,
    })
    expect(keyAction(down("KeyA", "a", {ctrlKey: true}), "translated", nothingDown)).toEqual({
      kind: "key",
      code: "KeyA",
      down: true,
      flags: 0x40000,
    })
    expect(keyAction(down("ArrowLeft", "ArrowLeft"), "translated", nothingDown)).toEqual({
      kind: "key",
      code: "ArrowLeft",
      down: true,
      flags: 0,
    })
    expect(keyAction(down("Enter", "Enter"), "translated", nothingDown)).toEqual({
      kind: "key",
      code: "Enter",
      down: true,
      flags: 0,
    })
    expect(keyAction(down("ShiftLeft", "Shift", {shiftKey: true}), "translated", nothingDown)).toEqual({
      kind: "key",
      code: "ShiftLeft",
      down: true,
      flags: 0x20000,
    })
    expect(keyAction(up("ShiftLeft", "Shift"), "translated", new Set(["ShiftLeft"]))).toEqual({
      kind: "key",
      code: "ShiftLeft",
      down: false,
      flags: 0,
    })
  })

  it("releases a shortcut's key let go after its ⌘ in Translated", () => {
    expect(keyAction(up("KeyC", "c"), "translated", new Set(["KeyC"]))).toEqual({
      kind: "key",
      code: "KeyC",
      down: false,
      flags: 0,
    })
  })

  it("sends nothing for a dead key in Translated", () => {
    expect(keyAction(down("KeyE", "Dead", {altKey: true}), "translated", nothingDown)).toBeNull()
    expect(keyAction(up("KeyE", "Dead", {altKey: true}), "translated", nothingDown)).toBeNull()
  })

  it("sends every key by position in Raw", () => {
    expect(keyAction(down("KeyA", "A", {shiftKey: true}), "raw", nothingDown)).toEqual({
      kind: "key",
      code: "KeyA",
      down: true,
      flags: 0x20000,
    })
    expect(keyAction(up("KeyA", "a"), "raw", nothingDown)).toEqual({kind: "key", code: "KeyA", down: false, flags: 0})
    expect(keyAction(down("KeyE", "Dead", {altKey: true}), "raw", nothingDown)).toEqual({
      kind: "key",
      code: "KeyE",
      down: true,
      flags: 0x80000,
    })
    expect(keyAction(down("KeyC", "c", {metaKey: true}), "raw", nothingDown)).toEqual({
      kind: "key",
      code: "KeyC",
      down: true,
      flags: 0x100000,
    })
  })
})
