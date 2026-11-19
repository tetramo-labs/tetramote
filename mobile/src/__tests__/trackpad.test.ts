import {acceleration, ClickCounter, momentumSteps, normalize, pointerGain} from "@/services/trackpad"

describe("pointerGain", () => {
  it("maps the visible stream width to the Mac's width in points", () => {
    expect(pointerGain(400, 1600, 1, "normal")).toBe(4)
    expect(pointerGain(400, 1600, 2, "normal")).toBe(2)
    expect(pointerGain(400, 1600, 1, "fast")).toBeCloseTo(6.4)
  })

  it("falls back to the speed factor before the stream size is known", () => {
    expect(pointerGain(0, 0, 1, "slow")).toBe(0.6)
  })
})

describe("acceleration", () => {
  it("is 1 at rest and capped at 2.5", () => {
    expect(acceleration(0)).toBe(1)
    expect(acceleration(1000)).toBe(1.5)
    expect(acceleration(-100000)).toBe(2.5)
  })
})

describe("normalize", () => {
  it("clamps to the unit square", () => {
    expect(normalize(50, 25, 100, 100)).toEqual({x: 0.5, y: 0.25})
    expect(normalize(-5, 200, 100, 100)).toEqual({x: 0, y: 1})
  })
})

describe("ClickCounter", () => {
  it("counts up to triple clicks that are close in time and space", () => {
    const c = new ClickCounter()
    expect(c.register(0, 10, 10)).toBe(1)
    expect(c.register(200, 12, 11)).toBe(2)
    expect(c.register(400, 12, 11)).toBe(3)
    expect(c.register(600, 12, 11)).toBe(3)
    expect(c.register(2000, 12, 11)).toBe(1)
    expect(c.register(2100, 100, 100)).toBe(1)
  })
})

describe("momentumSteps", () => {
  it("decays a fling and stops below half a point", () => {
    const steps = momentumSteps(0, 1000)
    expect(steps[0]).toEqual({dx: 0, dy: 16})
    expect(steps[1].dy).toBeCloseTo(14.72)
    expect(Math.abs(steps[steps.length - 1].dy)).toBeGreaterThanOrEqual(0.5)
    expect(momentumSteps(0, 10)).toEqual([])
  })
})
