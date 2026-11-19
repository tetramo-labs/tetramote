import {Monitor} from "lucide-react-native"

import {railCapacity, splitRailActions} from "@/services/railLayout"
import type {RailAction} from "@/stores/railToolbar"

const action = (key: string): RailAction => ({key, icon: Monitor, label: key, onPress: () => undefined})
const six = ["close", "mode", "keyboard", "displays", "clipboard", "audio"].map(action)

describe("rail capacity", () => {
  it("fits every session control down the folded Duo's rail", () => {
    expect(railCapacity(678, 174, 0)).toBe(9)
    expect(splitRailActions(six, 9)).toEqual({shown: six, overflow: []})
  })

  it("moves what doesn't fit behind More when the folded Duo is held sideways", () => {
    expect(railCapacity(466, 174, 0)).toBe(5)
    const {shown, overflow} = splitRailActions(six, 5)
    expect(shown.map((a) => a.key)).toEqual(["close", "mode", "keyboard", "displays"])
    expect(overflow.map((a) => a.key)).toEqual(["clipboard", "audio"])
  })

  it("always keeps room for one button", () => {
    expect(railCapacity(100, 174, 0)).toBe(1)
    expect(splitRailActions(six, 1).shown).toEqual([])
  })
})
