import {layoutFor, pageGutters} from "@/hooks/useLayout"

describe("pageGutters", () => {
  it("pads 24 pt on a phone without a rail", () => {
    expect(pageGutters(layoutFor(390, 844, 0, 0, null))).toEqual({left: 24, right: 24})
  })

  it("uses the rail inset in place of the page padding on the folded Duo", () => {
    expect(pageGutters(layoutFor(420, 900, 0, 84, "right"))).toEqual({left: 24, right: 84})
    expect(pageGutters(layoutFor(420, 900, 84, 0, "left"))).toEqual({left: 84, right: 24})
  })

  it("centers a 600 pt column on a wide window", () => {
    expect(pageGutters(layoutFor(1000, 700, 0, 84, "right"))).toEqual({left: 170, right: 230})
  })
})
