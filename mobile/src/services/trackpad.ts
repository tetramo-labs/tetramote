import type {TrackpadSpeed} from "@/stores/settings"

const SPEED: Record<TrackpadSpeed, number> = {slow: 0.6, normal: 1, fast: 1.6}
const DOUBLE_CLICK_MS = 350
const DOUBLE_CLICK_SLOP = 24
export const FOLLOW_MARGIN = 32

interface Size {
  width: number
  height: number
}

/** Mac points per phone point for a finger moving across the visible stream. */
export function pointerGain(viewWidth: number, pointWidth: number, zoom: number, speed: TrackpadSpeed): number {
  if (viewWidth <= 0 || pointWidth <= 0) return SPEED[speed]
  return (pointWidth / viewWidth / Math.max(zoom, 1)) * SPEED[speed]
}

/** Faster swipes travel further, like a trackpad's pointer acceleration. */
export function acceleration(velocity: number): number {
  return 1 + Math.min(Math.abs(velocity) / 2000, 1.5)
}

export function clampOffset(offset: number, content: number, container: number, zoom: number): number {
  "worklet"
  const max = Math.max(0, (content * zoom - container) / 2)
  return Math.min(max, Math.max(-max, offset))
}

/**
 * The view offset that keeps `pointer` (0..1 across `frame`) at least `margin`
 * points inside `container`, moved only by how far the pointer overshoots and
 * clamped like a pan. `frame` is drawn centered, translated by `offset`, then
 * scaled by `zoom` about its center. At zoom 1 the offset is returned as is.
 */
export function followOffset(
  pointer: {x: number; y: number},
  frame: Size,
  container: Size,
  zoom: number,
  offset: {x: number; y: number},
  margin: number,
): {x: number; y: number} {
  "worklet"
  if (zoom <= 1) return offset
  const axis = (p: number, content: number, box: number, current: number) => {
    const at = current + (p - 0.5) * content * zoom
    const edge = box / 2 - Math.min(margin, box / 2)
    const shift = at > edge ? edge - at : at < -edge ? -edge - at : 0
    return clampOffset(current + shift, content, box, zoom)
  }
  return {
    x: axis(pointer.x, frame.width, container.width, offset.x),
    y: axis(pointer.y, frame.height, container.height, offset.y),
  }
}

export function normalize(x: number, y: number, width: number, height: number): {x: number; y: number} {
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  if (width <= 0 || height <= 0) return {x: 0.5, y: 0.5}
  return {x: clamp(x / width), y: clamp(y / height)}
}

/** Counts consecutive taps the way macOS counts clicks (1, 2, 3). */
export class ClickCounter {
  private last: {time: number; x: number; y: number; count: number} | null = null

  register(time: number, x: number, y: number): number {
    const prev = this.last
    const near = prev && Math.hypot(prev.x - x, prev.y - y) <= DOUBLE_CLICK_SLOP
    const count = prev && near && time - prev.time <= DOUBLE_CLICK_MS ? Math.min(prev.count + 1, 3) : 1
    this.last = {time, x, y, count}
    return count
  }
}

export const HOLD_DRAG_MS = 800
export const DIRECT_RIGHT_CLICK_MS = 350

/** Decays a scroll fling into momentum steps; returns deltas per 16 ms frame. */
export function momentumSteps(vx: number, vy: number, decay = 0.92, minStep = 0.5): {dx: number; dy: number}[] {
  const steps: {dx: number; dy: number}[] = []
  let dx = (vx / 1000) * 16
  let dy = (vy / 1000) * 16
  while (Math.abs(dx) >= minStep || Math.abs(dy) >= minStep) {
    steps.push({dx, dy})
    dx *= decay
    dy *= decay
    if (steps.length > 120) break
  }
  return steps
}
