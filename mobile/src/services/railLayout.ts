import type {RailAction} from "@/stores/railToolbar"

/** The Duo's own rail buttons are this wide; ours match. */
export const RAIL_BUTTON = 44
/** The system centers its status bar and rail buttons this far in from the rail's outer edge. */
export const RAIL_CENTER = 48
export const RAIL_GAP = 12

/** How many buttons fit down the rail from `top`, above the bottom inset. */
export function railCapacity(height: number, top: number, bottomInset: number): number {
  return Math.max(1, Math.floor((height - top - bottomInset) / (RAIL_BUTTON + RAIL_GAP)))
}

/** All the actions when they fit; otherwise what fits with room left for More, and the rest behind it. */
export function splitRailActions(
  actions: RailAction[],
  capacity: number,
): {shown: RailAction[]; overflow: RailAction[]} {
  if (actions.length <= capacity) return {shown: actions, overflow: []}
  const keep = Math.max(0, capacity - 1)
  return {shown: actions.slice(0, keep), overflow: actions.slice(keep)}
}
