import {MOUSE_LEFT, MOUSE_RIGHT, SCROLL_BEGAN, SCROLL_CHANGED, SCROLL_ENDED, type InputEvent} from "@/input"

export type TouchMode = "trackpad" | "direct"

export const TAP_DRAG_MS = 350
const TAP_MS = 250
const TWO_FINGER_TAP_MS = 300
const LONG_PRESS_MS = 500
const SLOP_PX = 6

interface Finger {
  x: number
  y: number
  startX: number
  startY: number
}

/** Where the picture is and how many of the computer's points one CSS pixel of it spans. */
export interface Geometry {
  toScreen: (x: number, y: number) => {x: number; y: number}
  pointsPerPixel: number
}

/**
 * Touches on the picture as the phone app reads them. Trackpad: drag moves the pointer, tap clicks, tap then drag
 * drags, two fingers tap to right-click or drag to scroll. Direct: the finger is the pointer, and a long press
 * right-clicks.
 */
export class TouchGestures {
  mode: TouchMode = "trackpad"
  private fingers = new Map<number, Finger>()
  private startedAt = 0
  private most = 0
  private moved = false
  private pressed = false
  private tapDrag = false
  private scrolling = false
  private lastTapAt: number | null = null
  private centroid: {x: number; y: number} | null = null
  private scrollFrom: {x: number; y: number} | null = null

  constructor(
    private readonly send: (events: InputEvent[]) => void,
    private readonly geometry: () => Geometry,
  ) {}

  down(id: number, x: number, y: number, at: number) {
    this.fingers.set(id, {x, y, startX: x, startY: y})
    if (this.fingers.size === 1) {
      this.startedAt = at
      this.most = 1
      this.moved = false
      this.pressed = false
      this.scrolling = false
      this.tapDrag = this.mode === "trackpad" && this.lastTapAt !== null && at - this.lastTapAt <= TAP_DRAG_MS
      return
    }
    this.most = Math.max(this.most, this.fingers.size)
    if (this.pressed) {
      this.send([{kind: "button", button: MOUSE_LEFT, down: false, clicks: 1}])
      this.pressed = false
    }
    this.centroid = this.center()
    this.scrollFrom = this.centroid
  }

  move(id: number, x: number, y: number) {
    const finger = this.fingers.get(id)
    if (!finger) return
    const dx = x - finger.x
    const dy = y - finger.y
    finger.x = x
    finger.y = y
    if (this.most >= 2) {
      this.scroll()
      return
    }
    if (!this.moved && Math.hypot(x - finger.startX, y - finger.startY) < SLOP_PX) return
    const first = !this.moved
    this.moved = true
    const geometry = this.geometry()
    if (this.mode === "direct") {
      const events: InputEvent[] = [{kind: "moveTo", ...geometry.toScreen(x, y)}]
      if (first) events.push({kind: "button", button: MOUSE_LEFT, down: true, clicks: 1})
      this.pressed = true
      this.send(events)
      return
    }
    const events: InputEvent[] = []
    if (first && this.tapDrag) {
      events.push({kind: "button", button: MOUSE_LEFT, down: true, clicks: 1})
      this.pressed = true
    }
    events.push({kind: "move", dx: dx * geometry.pointsPerPixel, dy: dy * geometry.pointsPerPixel})
    this.send(events)
  }

  up(id: number, at: number) {
    const finger = this.fingers.get(id)
    if (!finger) return
    this.fingers.delete(id)
    if (this.fingers.size > 0) {
      this.centroid = this.center()
      return
    }
    const held = at - this.startedAt
    if (this.scrolling) {
      this.send([{kind: "scroll", dx: 0, dy: 0, phase: SCROLL_ENDED}])
    } else if (this.pressed) {
      this.send([{kind: "button", button: MOUSE_LEFT, down: false, clicks: 1}])
    } else if (this.most === 2 && held <= TWO_FINGER_TAP_MS) {
      this.click(MOUSE_RIGHT, null)
    } else if (this.most === 1 && !this.moved && this.mode === "direct") {
      const point = this.geometry().toScreen(finger.x, finger.y)
      this.click(held >= LONG_PRESS_MS ? MOUSE_RIGHT : MOUSE_LEFT, point)
    } else if (this.most === 1 && !this.moved && held <= TAP_MS) {
      this.click(MOUSE_LEFT, null)
      this.lastTapAt = at
      return
    }
    this.pressed = false
    this.lastTapAt = null
  }

  cancel() {
    if (this.pressed) this.send([{kind: "button", button: MOUSE_LEFT, down: false, clicks: 1}])
    if (this.scrolling) this.send([{kind: "scroll", dx: 0, dy: 0, phase: SCROLL_ENDED}])
    this.fingers.clear()
    this.pressed = false
    this.scrolling = false
  }

  private click(button: number, at: {x: number; y: number} | null) {
    const events: InputEvent[] = at ? [{kind: "moveTo", ...at}] : []
    events.push({kind: "button", button, down: true, clicks: 1}, {kind: "button", button, down: false, clicks: 1})
    this.send(events)
  }

  private center(): {x: number; y: number} {
    let x = 0
    let y = 0
    for (const f of this.fingers.values()) {
      x += f.x
      y += f.y
    }
    return {x: x / this.fingers.size, y: y / this.fingers.size}
  }

  private scroll() {
    const now = this.center()
    const from = this.scrollFrom ?? now
    if (!this.scrolling && Math.hypot(now.x - from.x, now.y - from.y) < SLOP_PX) return
    const last = this.centroid ?? now
    this.centroid = now
    const step: InputEvent = {kind: "scroll", dx: now.x - last.x, dy: now.y - last.y, phase: SCROLL_CHANGED}
    if (this.scrolling) {
      this.send([step])
      return
    }
    this.scrolling = true
    this.moved = true
    this.send([{kind: "scroll", dx: 0, dy: 0, phase: SCROLL_BEGAN}, step])
  }
}
