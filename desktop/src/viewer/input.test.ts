import {describe, expect, it} from "vitest"

import {contentRect, modifierFlags, normalized, protocolButton, scrollFromWheel} from "@/viewer/input"

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
})
