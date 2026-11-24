import {sessionLayout, type Rect} from "@/services/sessionLayout"

const none = {top: 0, bottom: 0, left: 0, right: 0}

const near = (r: Rect) => ({
  x: expect.closeTo(r.x, 3),
  y: expect.closeTo(r.y, 3),
  width: expect.closeTo(r.width, 3),
  height: expect.closeTo(r.height, 3),
})

describe("sessionLayout", () => {
  it("stacks screen over trackpad on the folded Duo, controls in the right rail", () => {
    const layout = sessionLayout({
      width: 466,
      height: 678,
      insets: {top: 0, bottom: 20, left: 0, right: 84},
      rail: "right",
      aspect: 1.6,
      fold: null,
    })
    expect(layout).toEqual({
      kind: "stacked",
      video: {x: 0, y: 0, width: 382, height: 238.75},
      panel: {x: 0, y: 250.75, width: 382, height: 407.25},
      toolbar: "rail",
      trackpad: {x: 12, y: 357.6875, width: 358, height: 201.375},
      gap: {x: 0, y: 238.75, width: 382, height: 118.9375},
    })
  })

  it("keeps the folded Duo's 16:9 trackpad inside a short panel, sized by its height", () => {
    const layout = sessionLayout({
      width: 466,
      height: 470,
      insets: {top: 0, bottom: 20, left: 0, right: 84},
      rail: "right",
      aspect: 1.6,
      fold: null,
    })
    expect(layout.kind).toBe("stacked")
    if (layout.kind !== "stacked") return
    expect(layout.trackpad).toEqual(near({x: 24.5556, y: 250.75, width: 332.8889, height: 187.25}))
  })

  it("asks a phone without a rail for a 16:9 trackpad laid out in the panel", () => {
    const layout = sessionLayout({width: 393, height: 852, insets: none, rail: null, aspect: 1.6, fold: null})
    expect(layout.kind).toBe("stacked")
    if (layout.kind !== "stacked") return
    expect(layout.trackpad).toBeUndefined()
    expect(layout.trackpadAspect).toBeCloseTo(1.7778, 4)
  })

  it("splits at the fold on the open Duo in portrait", () => {
    const layout = sessionLayout({
      width: 669,
      height: 951,
      insets: {top: 40, bottom: 20, left: 0, right: 0},
      rail: null,
      aspect: 1.6,
      fold: {x: 0, y: 470, width: 669, height: 12},
    })
    expect(layout.kind).toBe("stacked")
    if (layout.kind !== "stacked") return
    expect(layout.video).toEqual(near({x: 0, y: 45.9375, width: 669, height: 418.125}))
    expect(layout.panel).toEqual({x: 0, y: 482, width: 669, height: 449})
    expect(layout.toolbar).toBe("panel")
  })

  it("ignores a fold that runs down the middle (book pose)", () => {
    const layout = sessionLayout({
      width: 951,
      height: 669,
      insets: {top: 0, bottom: 0, left: 84, right: 0},
      rail: "left",
      aspect: 1.6,
      fold: {x: 470, y: 0, width: 12, height: 669},
    })
    expect(layout).toEqual({
      kind: "overlay",
      video: near({x: 84, y: 63.5625, width: 867, height: 541.875}),
      toolbar: "rail",
    })
  })

  it("fills a landscape phone and puts the toolbar in the spare strip", () => {
    const layout = sessionLayout({width: 852, height: 393, insets: none, rail: null, aspect: 1.6, fold: null})
    expect(layout).toEqual({kind: "overlay", video: near({x: 111.6, y: 0, width: 628.8, height: 393}), toolbar: "side"})
  })

  it("floats the toolbar when the screen fills the width", () => {
    const layout = sessionLayout({width: 800, height: 500, insets: none, rail: null, aspect: 1.6, fold: null})
    expect(layout).toEqual({kind: "overlay", video: {x: 0, y: 0, width: 800, height: 500}, toolbar: "floating"})
  })

  it("fills the whole window in full screen, ignoring insets and the rail", () => {
    const folded = sessionLayout({
      width: 466,
      height: 678,
      insets: {top: 0, bottom: 20, left: 0, right: 84},
      rail: "right",
      aspect: 1.6,
      fold: null,
      fullScreen: true,
    })
    expect(folded).toEqual({
      kind: "overlay",
      video: near({x: 0, y: 193.375, width: 466, height: 291.25}),
      toolbar: "floating",
    })
    const sideways = sessionLayout({
      width: 951,
      height: 669,
      insets: none,
      rail: null,
      aspect: 1.6,
      fold: null,
      fullScreen: true,
    })
    expect(sideways).toEqual({
      kind: "overlay",
      video: near({x: 0, y: 37.3125, width: 951, height: 594.375}),
      toolbar: "floating",
    })
    const phone = sessionLayout({
      width: 852,
      height: 393,
      insets: none,
      rail: null,
      aspect: 1.6,
      fold: null,
      fullScreen: true,
    })
    expect(phone.toolbar).toBe("side")
  })

  it("splits a half-open Duo in portrait at the middle with a bottom rail when no fold is reported", () => {
    const layout = sessionLayout({
      width: 669,
      height: 951,
      insets: {top: 0, bottom: 34, left: 0, right: 0},
      rail: null,
      aspect: 1.6,
      fold: null,
      halfOpen: true,
    })
    expect(layout).toEqual({
      kind: "stacked",
      video: near({x: 0, y: 28.6875, width: 669, height: 418.125}),
      panel: {x: 0, y: 475.5, width: 669, height: 441.5},
      toolbar: "bottomRail",
      gap: near({x: 0, y: 446.8125, width: 669, height: 28.6875}),
    })
  })

  it("splits a half-open Duo in portrait at the reported fold", () => {
    const layout = sessionLayout({
      width: 669,
      height: 951,
      insets: {top: 0, bottom: 34, left: 0, right: 0},
      rail: null,
      aspect: 1.6,
      fold: {x: 0, y: 470, width: 669, height: 12},
      halfOpen: true,
    })
    expect(layout).toEqual({
      kind: "stacked",
      video: near({x: 0, y: 25.9375, width: 669, height: 418.125}),
      panel: {x: 0, y: 482, width: 669, height: 435},
      toolbar: "bottomRail",
      gap: near({x: 0, y: 444.0625, width: 669, height: 25.9375}),
    })
  })

  it("leaves a half-open Duo in landscape as it is fully open", () => {
    const input = {
      width: 951,
      height: 669,
      insets: {top: 0, bottom: 34, left: 0, right: 84},
      rail: "right" as const,
      aspect: 1.6,
      fold: null,
    }
    const expected = {kind: "overlay", video: near({x: 0, y: 46.5625, width: 867, height: 541.875}), toolbar: "rail"}
    expect(sessionLayout({...input, halfOpen: true})).toEqual(expected)
    expect(sessionLayout(input)).toEqual(expected)
  })
})
