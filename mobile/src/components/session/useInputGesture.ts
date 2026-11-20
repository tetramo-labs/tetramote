import {MOUSE_LEFT, MOUSE_RIGHT, SCROLL_BEGAN, SCROLL_CHANGED, SCROLL_ENDED, SCROLL_MOMENTUM} from "@tetramote/remote"
import * as Haptics from "expo-haptics"
import {useMemo, useRef} from "react"
import {Gesture} from "react-native-gesture-handler"
import type {SharedValue} from "react-native-reanimated"

import {sendInput} from "@/services/remote"
import {
  acceleration,
  ClickCounter,
  HOLD_DRAG_MS,
  HOLD_DRAG_SLOP,
  momentumSteps,
  normalize,
  pointerGain,
} from "@/services/trackpad"
import type {InputMode, TrackpadSpeed} from "@/stores/settings"

const MAX_ZOOM = 4
const ZOOM_DECIDE_SCALE = 0.08
const SCROLL_DECIDE_DISTANCE = 12

export interface ZoomControls {
  zoom: SharedValue<number>
  offsetX: SharedValue<number>
  offsetY: SharedValue<number>
}

interface Size {
  width: number
  height: number
}

interface InputGestureOptions {
  surface: "screen" | "trackpad"
  inputMode: InputMode
  speed: TrackpadSpeed
  container: Size
  frame: Size
  pointWidth: number
  zoomControls: ZoomControls
  onThreeFingerTap: () => void
}

function clampOffset(offset: number, content: number, container: number, zoom: number) {
  const max = Math.max(0, (content * zoom - container) / 2)
  return Math.min(max, Math.max(-max, offset))
}

/**
 * Touch to Mac input. On the screen, trackpad mode moves the pointer relatively
 * and touch mode puts it under the finger; two fingers scroll unless the gesture
 * starts as a pinch, which zooms the view. As a trackpad, a finger held within
 * HOLD_DRAG_SLOP of where it landed for HOLD_DRAG_MS presses the button and
 * drags until it lifts; one that moved first only moves the pointer. The
 * trackpad panel always behaves as a trackpad and never zooms. Three fingers
 * toggle the controls.
 */
export function useInputGesture({
  surface,
  inputMode,
  speed,
  container,
  frame,
  pointWidth,
  zoomControls,
  onThreeFingerTap,
}: InputGestureOptions) {
  const clicks = useRef(new ClickCounter()).current
  const dragging = useRef(false)
  const holdFrom = useRef<{x: number; y: number} | null>(null)
  const twoFinger = useRef<{mode: "undecided" | "scroll" | "zoom"; travel: number}>({mode: "undecided", travel: 0})
  const pinchStart = useRef({zoom: 1, x: 0, y: 0})
  const momentum = useRef<ReturnType<typeof setInterval> | null>(null)
  const {zoom, offsetX, offsetY} = zoomControls
  const direct = surface === "screen" && inputMode === "direct"

  return useMemo(() => {
    const toVideo = (x: number, y: number) => {
      const vx = (x - container.width / 2 - offsetX.value) / zoom.value + frame.width / 2
      const vy = (y - container.height / 2 - offsetY.value) / zoom.value + frame.height / 2
      return normalize(vx, vy, frame.width, frame.height)
    }
    const gain = () => pointerGain(frame.width, pointWidth, surface === "screen" ? zoom.value : 1, speed)
    const stopMomentum = () => {
      if (momentum.current) clearInterval(momentum.current)
      momentum.current = null
    }
    const moveBy = (e: {changeX: number; changeY: number; velocityX: number; velocityY: number}) => {
      if (e.changeX === 0 && e.changeY === 0) return
      const k = gain() * acceleration(Math.hypot(e.velocityX, e.velocityY))
      sendInput([{kind: "move", dx: e.changeX * k, dy: e.changeY * k}])
    }
    const release = () => {
      if (!dragging.current) return
      sendInput([{kind: "button", button: MOUSE_LEFT, down: false, clicks: 1}])
      dragging.current = false
    }
    const click = (button: number, count: number) =>
      sendInput([
        {kind: "button", button, down: true, clicks: count},
        {kind: "button", button, down: false, clicks: count},
      ])

    const threeFingerTap = Gesture.Tap()
      .minPointers(3)
      .maxDuration(400)
      .runOnJS(true)
      .onEnd((_e, success) => {
        if (success) onThreeFingerTap()
      })

    const twoFingerTap = Gesture.Tap()
      .minPointers(2)
      .maxDuration(300)
      .runOnJS(true)
      .onEnd((_e, success) => {
        if (!success) return
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        click(MOUSE_RIGHT, 1)
      })

    const tap = Gesture.Tap()
      .maxDuration(300)
      .runOnJS(true)
      .onEnd((e, success) => {
        if (!success) return
        stopMomentum()
        const count = clicks.register(Date.now(), e.x, e.y)
        if (direct) {
          const p = toVideo(e.x, e.y)
          sendInput([{kind: "moveTo", x: p.x, y: p.y}])
        }
        click(MOUSE_LEFT, count)
      })

    const pointerPan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(direct ? 4 : 3)
      .runOnJS(true)
      .onStart((e) => {
        stopMomentum()
        if (!direct) return
        const p = toVideo(e.x, e.y)
        sendInput([
          {kind: "moveTo", x: p.x, y: p.y},
          {kind: "button", button: MOUSE_LEFT, down: true, clicks: 1},
        ])
        dragging.current = true
      })
      .onChange((e) => {
        if (direct) {
          const p = toVideo(e.x, e.y)
          sendInput([{kind: "moveTo", x: p.x, y: p.y}])
          return
        }
        moveBy(e)
      })
      .onFinalize(release)

    const holdDrag = Gesture.Pan()
      .maxPointers(1)
      .activateAfterLongPress(HOLD_DRAG_MS)
      .runOnJS(true)
      .onTouchesDown((e) => {
        const touch = e.allTouches[0]
        holdFrom.current = touch ? {x: touch.x, y: touch.y} : null
      })
      .onTouchesMove((e, manager) => {
        const from = holdFrom.current
        const touch = e.allTouches[0]
        if (dragging.current || !from || !touch) return
        if (Math.hypot(touch.x - from.x, touch.y - from.y) > HOLD_DRAG_SLOP) manager.fail()
      })
      .onStart(() => {
        stopMomentum()
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        sendInput([{kind: "button", button: MOUSE_LEFT, down: true, clicks: 1}])
        dragging.current = true
      })
      .onChange(moveBy)
      .onFinalize(release)

    const longPress = Gesture.Pan()
      .maxPointers(1)
      .activateAfterLongPress(350)
      .runOnJS(true)
      .onStart((e) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        const p = toVideo(e.x, e.y)
        sendInput([{kind: "moveTo", x: p.x, y: p.y}])
        click(MOUSE_RIGHT, 1)
      })

    const scrollPan = Gesture.Pan()
      .minPointers(2)
      .maxPointers(2)
      .runOnJS(true)
      .onBegin(() => {
        if (surface === "trackpad") twoFinger.current = {mode: "scroll", travel: 0}
      })
      .onStart(() => {
        stopMomentum()
        if (twoFinger.current.mode === "scroll") sendInput([{kind: "scroll", dx: 0, dy: 0, phase: SCROLL_BEGAN}])
      })
      .onChange((e) => {
        const state = twoFinger.current
        state.travel += Math.hypot(e.changeX, e.changeY)
        if (state.mode === "undecided" && state.travel >= SCROLL_DECIDE_DISTANCE) {
          state.mode = "scroll"
          sendInput([{kind: "scroll", dx: 0, dy: 0, phase: SCROLL_BEGAN}])
        }
        if (state.mode === "scroll") sendInput([{kind: "scroll", dx: e.changeX, dy: e.changeY, phase: SCROLL_CHANGED}])
      })
      .onEnd((e) => {
        if (twoFinger.current.mode !== "scroll") return
        sendInput([{kind: "scroll", dx: 0, dy: 0, phase: SCROLL_ENDED}])
        const steps = momentumSteps(e.velocityX, e.velocityY)
        if (steps.length === 0) return
        let i = 0
        momentum.current = setInterval(() => {
          const step = steps[i++]
          if (!step) {
            sendInput([{kind: "scroll", dx: 0, dy: 0, phase: SCROLL_ENDED}])
            stopMomentum()
            return
          }
          sendInput([{kind: "scroll", dx: step.dx, dy: step.dy, phase: SCROLL_MOMENTUM}])
        }, 16)
      })

    const taps = Gesture.Exclusive(threeFingerTap, twoFingerTap, tap)
    const pointer = direct ? Gesture.Race(longPress, pointerPan) : Gesture.Race(holdDrag, pointerPan)
    if (surface === "trackpad") return Gesture.Race(scrollPan, pointer, taps)

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        twoFinger.current = {mode: "undecided", travel: 0}
        pinchStart.current = {zoom: zoom.value, x: offsetX.value, y: offsetY.value}
      })
      .onUpdate((e) => {
        const state = twoFinger.current
        if (state.mode === "undecided" && Math.abs(e.scale - 1) >= ZOOM_DECIDE_SCALE) state.mode = "zoom"
        if (state.mode !== "zoom") return
        const start = pinchStart.current
        const z = Math.min(MAX_ZOOM, Math.max(1, start.zoom * e.scale))
        const fx = e.focalX - container.width / 2
        const fy = e.focalY - container.height / 2
        zoom.value = z
        offsetX.value = clampOffset(fx - (fx - start.x) * (z / start.zoom), frame.width, container.width, z)
        offsetY.value = clampOffset(fy - (fy - start.y) * (z / start.zoom), frame.height, container.height, z)
      })
    return Gesture.Race(Gesture.Simultaneous(pinch, scrollPan), pointer, taps)
  }, [
    clicks,
    container.height,
    container.width,
    direct,
    frame.height,
    frame.width,
    offsetX,
    offsetY,
    onThreeFingerTap,
    pointWidth,
    speed,
    surface,
    zoom,
  ])
}
