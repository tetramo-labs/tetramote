import {beforeEach, describe, expect, it} from "vitest"

import {TouchGestures} from "@/gestures"
import type {InputEvent} from "@/input"

let sent: InputEvent[]
let touch: TouchGestures

beforeEach(() => {
  sent = []
  touch = new TouchGestures(
    (events) => sent.push(...events),
    () => ({toScreen: (x, y) => ({x: x / 100, y: y / 100}), pointsPerPixel: 2}),
  )
})

const left = (down: boolean) => ({kind: "button", button: 0, down, clicks: 1})

describe("trackpad touches", () => {
  it("clicks on a tap and only moves on a drag", () => {
    touch.down(1, 10, 10, 0)
    touch.up(1, 100)
    expect(sent).toEqual([left(true), left(false)])
    sent = []
    touch.down(1, 10, 10, 1000)
    touch.move(1, 20, 15)
    touch.up(1, 1200)
    expect(sent).toEqual([{kind: "move", dx: 20, dy: 10}])
  })

  it("drags after a quick tap, then releases", () => {
    touch.down(1, 10, 10, 0)
    touch.up(1, 80)
    sent = []
    touch.down(1, 10, 10, 300)
    touch.move(1, 30, 10)
    touch.up(1, 600)
    expect(sent).toEqual([left(true), {kind: "move", dx: 40, dy: 0}, left(false)])
  })

  it("right-clicks on a two-finger tap and scrolls on a two-finger drag", () => {
    touch.down(1, 10, 10, 0)
    touch.down(2, 50, 10, 10)
    touch.up(1, 100)
    touch.up(2, 120)
    expect(sent).toEqual([
      {kind: "button", button: 1, down: true, clicks: 1},
      {kind: "button", button: 1, down: false, clicks: 1},
    ])
    sent = []
    touch.down(1, 10, 10, 1000)
    touch.down(2, 50, 10, 1010)
    touch.move(1, 10, 30)
    touch.move(2, 50, 30)
    touch.up(1, 1400)
    touch.up(2, 1410)
    expect(sent).toEqual([
      {kind: "scroll", dx: 0, dy: 0, phase: 1},
      {kind: "scroll", dx: 0, dy: 10, phase: 2},
      {kind: "scroll", dx: 0, dy: 10, phase: 2},
      {kind: "scroll", dx: 0, dy: 0, phase: 3},
    ])
  })
})

describe("direct touches", () => {
  it("clicks where tapped, drags with the button held, and right-clicks on a long press", () => {
    touch.mode = "direct"
    touch.down(1, 50, 20, 0)
    touch.up(1, 100)
    expect(sent).toEqual([{kind: "moveTo", x: 0.5, y: 0.2}, left(true), left(false)])
    sent = []
    touch.down(1, 10, 10, 1000)
    touch.move(1, 40, 10)
    touch.up(1, 1300)
    expect(sent).toEqual([{kind: "moveTo", x: 0.4, y: 0.1}, left(true), left(false)])
    sent = []
    touch.down(1, 20, 20, 2000)
    touch.up(1, 2700)
    expect(sent[1]).toEqual({kind: "button", button: 1, down: true, clicks: 1})
  })
})
