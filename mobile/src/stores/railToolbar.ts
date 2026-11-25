import type {LucideIcon} from "lucide-react-native"
import {useEffect, useId, useState} from "react"
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
  order: number
  actions: RailAction[]
}

interface RailToolbarState {
  entries: RailEntry[]
  set: (entry: RailEntry) => void
  remove: (key: string) => void
}

/**
 * Screens register the buttons they want in the iPhone Duo's rail; the rail
 * shows the most recently mounted screen's. Entries are ordered by when their
 * screen mounted, so a screen underneath that drops out of the rail and comes
 * back (a fold, a rotation) never lands on top.
 */
export const useRailToolbarStore = create<RailToolbarState>()((set) => ({
  entries: [],
  set: (entry) =>
    set((s) => ({
      entries: [...s.entries.filter((e) => e.key !== entry.key), entry].sort((a, b) => a.order - b.order),
    })),
  remove: (key) => set((s) => ({entries: s.entries.filter((e) => e.key !== key)})),
}))

/**
 * Shows `actions` in the rail while mounted. An empty list still claims the
 * rail, keeping screens underneath out of it; null takes no part.
 */
let nextOrder = 0

export function useRailActions(actions: RailAction[] | null) {
  const key = useId()
  const [order] = useState(() => nextOrder++)
  const setEntry = useRailToolbarStore((s) => s.set)
  const remove = useRailToolbarStore((s) => s.remove)
  useEffect(() => {
    if (actions) setEntry({key, order, actions})
    else remove(key)
  })
  useEffect(() => () => remove(key), [key, remove])
}
