import {cornerSpot} from "@/services/cornerSpot"

const duoOpenLandscape = {
  width: 951,
  height: 669,
  insets: {top: 82, bottom: 21, left: 0, right: 84},
  size: 42,
  margin: 12,
}

describe("cornerSpot", () => {
  it("keeps to the safe area when occlusions are unknown", () => {
    expect(cornerSpot("top-left", {...duoOpenLandscape, occlusions: null})).toEqual({x: 12, y: 94})
    expect(cornerSpot("bottom-right", {...duoOpenLandscape, occlusions: null})).toEqual({x: 813, y: 594})
  })

  it("hugs the edges past a hidden rail, above the home indicator", () => {
    expect(cornerSpot("top-left", {...duoOpenLandscape, occlusions: []})).toEqual({x: 12, y: 12})
    expect(cornerSpot("top-right", {...duoOpenLandscape, occlusions: []})).toEqual({x: 897, y: 12})
    expect(cornerSpot("bottom-right", {...duoOpenLandscape, occlusions: []})).toEqual({x: 897, y: 594})
  })

  it("steps below an occlusion in its corner", () => {
    const occlusions = [{x: 820, y: 20, width: 110, height: 50}]
    expect(cornerSpot("top-right", {...duoOpenLandscape, occlusions})).toEqual({x: 897, y: 82})
    expect(cornerSpot("top-left", {...duoOpenLandscape, occlusions})).toEqual({x: 12, y: 12})
  })

  it("steps above an occlusion at the bottom", () => {
    const occlusions = [{x: 880, y: 600, width: 60, height: 60}]
    expect(cornerSpot("bottom-right", {...duoOpenLandscape, occlusions})).toEqual({x: 897, y: 546})
  })
})
