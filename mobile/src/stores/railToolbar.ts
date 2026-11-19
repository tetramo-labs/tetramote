import type {LucideIcon} from "lucide-react-native"
import {useEffect, useId} from "react"
import {create} from "zustand"

export interface RailAction {
  key: string
  icon: LucideIcon
  label: string
  onPress: () => void
  active?: boolean
}

export interface RailEntry {
  key: string
  actions: RailAction[]
  hidden: boolean
  reveal?: () => void
}

interface RailToolbarState {
  entries: RailEntry[]
  set: (entry: RailEntry) => void
  remove: (key: string) => void
}

/**
 * Screens register the buttons they want in the iPhone Duo's rail; the rail
 * shows the most recently mounted screen's. An update keeps its place, so a
 * screen under the top one re-rendering never takes the rail back.
 */
export const useRailToolbarStore = create<RailToolbarState>()((set) => ({
  entries: [],
  set: (entry) =>
    set((s) => {
      const index = s.entries.findIndex((e) => e.key === entry.key)
      if (index === -1) return {entries: [...s.entries, entry]}
      const entries = s.entries.slice()
      entries[index] = entry
      return {entries}
    }),
  remove: (key) => set((s) => ({entries: s.entries.filter((e) => e.key !== key)})),
}))

/** Shows `actions` in the rail while mounted; null takes nothing. `hidden` leaves only a handle that calls `reveal`. */
export function useRailActions(actions: RailAction[] | null, options: {hidden?: boolean; reveal?: () => void} = {}) {
  const key = useId()
  const setEntry = useRailToolbarStore((s) => s.set)
  const remove = useRailToolbarStore((s) => s.remove)
  useEffect(() => {
    if (actions) setEntry({key, actions, hidden: options.hidden ?? false, reveal: options.reveal})
    else remove(key)
  })
  useEffect(() => () => remove(key), [key, remove])
}
