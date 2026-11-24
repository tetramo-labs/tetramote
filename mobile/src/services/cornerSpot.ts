import type {Insets, Rect} from "@/services/sessionLayout"
import type {ControlsCorner} from "@/stores/settings"

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * Where a `size` square sits in a full-screen corner. With the system's
 * occlusions known (the iPhone Duo, whose hidden rail still claims a safe-area
 * inset) it hugs the screen's edges and steps clear of them; otherwise it keeps
 * to the safe area.
 */
export function cornerSpot(
  corner: ControlsCorner,
  {
    width,
    height,
    insets,
    occlusions,
    size,
    margin,
  }: {
    width: number
    height: number
    insets: Insets
    occlusions: Rect[] | null
    size: number
    margin: number
  },
): {x: number; y: number} {
  const edges = occlusions ? {...insets, top: 0, left: 0, right: 0} : insets
  const left = corner.endsWith("left")
  const top = corner.startsWith("top")
  const x = left ? edges.left + margin : width - edges.right - margin - size
  let y = top ? edges.top + margin : height - edges.bottom - margin - size
  for (const r of occlusions ?? []) {
    const around: Rect = {x: x - margin, y: y - margin, width: size + 2 * margin, height: size + 2 * margin}
    if (!overlaps(around, r)) continue
    y = top ? Math.max(y, r.y + r.height + margin) : Math.min(y, r.y - margin - size)
  }
  return {x, y}
}
