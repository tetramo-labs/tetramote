import {Monitor} from "lucide-react-native"

import {useRailToolbarStore, type RailEntry} from "@/stores/railToolbar"

const entry = (key: string, order: number, label: string): RailEntry => ({
  key,
  order,
  actions: [{key: label, icon: Monitor, label, onPress: () => undefined}],
})

const top = () => {
  const {entries} = useRailToolbarStore.getState()
  return entries[entries.length - 1]?.key
}

describe("rail toolbar store", () => {
  beforeEach(() => useRailToolbarStore.setState({entries: []}))

  it("keeps the most recently mounted screen on top when one underneath comes back", () => {
    const {set, remove} = useRailToolbarStore.getState()
    set(entry("home", 0, "Settings"))
    set(entry("session", 1, "Disconnect"))
    remove("home")
    set(entry("home", 0, "Settings"))
    expect(top()).toBe("session")
  })

  it("lets a screen claim the rail with no buttons", () => {
    const {set} = useRailToolbarStore.getState()
    set(entry("home", 0, "Settings"))
    set({key: "session", order: 1, actions: []})
    expect(top()).toBe("session")
    expect(useRailToolbarStore.getState().entries[1].actions).toEqual([])
  })
})
