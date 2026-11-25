import {
  MOUSE_LEFT,
  MOUSE_RIGHT,
  SCROLL_BEGAN,
  SCROLL_CHANGED,
  SCROLL_ENDED,
  SCROLL_MOMENTUM,
  type InputEvent,
} from "@tetramote/remote"
import * as Haptics from "expo-haptics"
import {useMemo, useRef} from "react"
import {Gesture} from "react-native-gesture-handler"
import type {SharedValue} from "react-native-reanimated"

import {sendInput} from "@/services/remote"
import {
  acceleration,
  ClickCounter,
  DIRECT_RIGHT_CLICK_MS,
  HOLD_DRAG_MS,
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
  view: SharedValue<{frame: Size; container: Size}>
  pointer: SharedValue<{x: number; y: number}>
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
  absolute: boolean
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
 * starts as a pinch or the view is already zoomed in; then two fingers zoom and
 * pan the view. A finger held still (within the distance that starts moving the
 * pointer) right-clicks: in touch mode after 350 ms, as a trackpad after
 * HOLD_DRAG_MS when it lifts, or it drags if it moves after the hold. The
 * trackpad panel always behaves as a trackpad, and its pinches zoom the screen
 * view about its center. Three fingers toggle the controls. With `absolute`,
 * the trackpad moves the phone's own pointer (zoomControls.pointer) and sends
 * where it is, and every click, drag and scroll starts by putting the Mac's
 * pointer there, so they land where the painted pointer is.
 */
export function useInputGesture({
  surface,
  inputMode,
  speed,
  container,
  frame,
  pointWidth,
  absolute,
  zoomControls,
  onThreeFingerTap,
}: InputGestureOptions) {
  const clicks = useRef(new ClickCounter()).current
  const dragging = useRef(false)
  const held = useRef(false)
  const dragged = useRef(false)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const twoFinger = useRef<{mode: "undecided" | "scroll" | "zoom"; travel: number}>({mode: "undecided", travel: 0})
  const pinchStart = useRef(1)
  const momentum = useRef<ReturnType<typeof setInterval> | null>(null)
  const {zoom, offsetX, offsetY, view, pointer} = zoomControls
  const direct = surface === "screen" && inputMode === "direct"
  const slop = direct ? 4 : 3

  return useMemo(() => {
    const toVideo = (x: number, y: number) => {
      const vx = (x - container.width / 2 - offsetX.value) / zoom.value + frame.width / 2
      const vy = (y - container.height / 2 - offsetY.value) / zoom.value + frame.height / 2
      return normalize(vx, vy, frame.width, frame.height)
    }
    const gain = () => pointerGain(frame.width, pointWidth, zoom.value, speed)
    const clampTo = (x: number, y: number, z: number) => {
      const {frame: shown, container: box} = view.value
      offsetX.value = clampOffset(x, shown.width, box.width, z)
      offsetY.value = clampOffset(y, shown.height, box.height, z)
    }
    const stopMomentum = () => {
      if (momentum.current) clearInterval(momentum.current)
      momentum.current = null
    }
    const owned = absolute && !direct
    const place = (): InputEvent[] => (owned ? [{kind: "moveTo", x: pointer.value.x, y: pointer.value.y}] : [])
    const moveBy = (e: {changeX: number; changeY: number; velocityX: number; velocityY: number}) => {
      if (e.changeX === 0 && e.changeY === 0) return
      const k = gain() * acceleration(Math.hypot(e.velocityX, e.velocityY))
      if (!owned) {
        sendInput([{kind: "move", dx: e.changeX * k, dy: e.changeY * k}])
        return
      }
      const shown = view.value.frame
      if (pointWidth <= 0 || shown.width <= 0) return
      const pointHeight = (pointWidth * shown.height) / shown.width
      const x = Math.min(1, Math.max(0, pointer.value.x + (e.changeX * k) / pointWidth))
      const y = Math.min(1, Math.max(0, pointer.value.y + (e.changeY * k) / pointHeight))
      pointer.value = {x, y}
      sendInput([{kind: "moveTo", x, y}])
    }
    const putPointer = (p: {x: number; y: number}) => {
      pointer.value = p
      sendInput([{kind: "moveTo", x: p.x, y: p.y}])
    }
    const release = () => {
      if (!dragging.current) return
      sendInput([{kind: "button", button: MOUSE_LEFT, down: false, clicks: 1}])
      dragging.current = false
    }
    const click = (button: number, count: number) =>
      sendInput([
        ...place(),
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
        if (direct) putPointer(toVideo(e.x, e.y))
        click(MOUSE_LEFT, count)
      })

    const stopHold = () => {
      if (holdTimer.current) clearTimeout(holdTimer.current)
      holdTimer.current = null
    }

    const pointerPan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(slop)
      .runOnJS(true)
      .onBegin((e) => {
        stopHold()
        held.current = false
        dragged.current = false
        const at = {x: e.x, y: e.y}
        holdTimer.current = setTimeout(
          () => {
            holdTimer.current = null
            held.current = true
            stopMomentum()
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            if (!direct) return
            putPointer(toVideo(at.x, at.y))
            click(MOUSE_RIGHT, 1)
          },
          direct ? DIRECT_RIGHT_CLICK_MS : HOLD_DRAG_MS,
        )
      })
      .onStart((e) => {
        stopHold()
        stopMomentum()
        if (!direct || held.current) return
        putPointer(toVideo(e.x, e.y))
        sendInput([{kind: "button", button: MOUSE_LEFT, down: true, clicks: 1}])
        dragging.current = true
      })
      .onChange((e) => {
        if (direct) {
          if (!dragging.current) return
          putPointer(toVideo(e.x, e.y))
          return
        }
        if (held.current && !dragging.current && (e.changeX !== 0 || e.changeY !== 0)) {
          sendInput([...place(), {kind: "button", button: MOUSE_LEFT, down: true, clicks: 1}])
          dragging.current = true
          dragged.current = true
        }
        moveBy(e)
      })
      .onFinalize(() => {
        stopHold()
        if (!direct && held.current && !dragged.current) click(MOUSE_RIGHT, 1)
        held.current = false
        release()
      })

    const scrollPan = Gesture.Pan()
      .minPointers(2)
      .maxPointers(2)
      .runOnJS(true)
      .onStart(() => {
        stopMomentum()
        if (twoFinger.current.mode === "scroll")
          sendInput([...place(), {kind: "scroll", dx: 0, dy: 0, phase: SCROLL_BEGAN}])
      })
      .onChange((e) => {
        const state = twoFinger.current
        state.travel += Math.hypot(e.changeX, e.changeY)
        if (state.mode === "undecided" && state.travel >= SCROLL_DECIDE_DISTANCE) {
          state.mode = "scroll"
          sendInput([...place(), {kind: "scroll", dx: 0, dy: 0, phase: SCROLL_BEGAN}])
        }
        if (state.mode === "scroll") sendInput([{kind: "scroll", dx: e.changeX, dy: e.changeY, phase: SCROLL_CHANGED}])
        if (state.mode === "zoom") clampTo(offsetX.value + e.changeX, offsetY.value + e.changeY, zoom.value)
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

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        twoFinger.current = {mode: zoom.value > 1.01 ? "zoom" : "undecided", travel: 0}
        pinchStart.current = zoom.value
      })
      .onUpdate((e) => {
        const state = twoFinger.current
        if (state.mode === "undecided" && Math.abs(e.scale - 1) >= ZOOM_DECIDE_SCALE) state.mode = "zoom"
        if (state.mode !== "zoom") return
        const before = zoom.value
        const z = Math.min(MAX_ZOOM, Math.max(1, pinchStart.current * e.scale))
        const fx = surface === "screen" ? e.focalX - container.width / 2 : 0
        const fy = surface === "screen" ? e.focalY - container.height / 2 : 0
        zoom.value = z
        clampTo(fx - (fx - offsetX.value) * (z / before), fy - (fy - offsetY.value) * (z / before), z)
      })
    return Gesture.Race(Gesture.Simultaneous(pinch, scrollPan), pointerPan, taps)
  }, [
    absolute,
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
    pointer,
    slop,
    speed,
    surface,
    view,
    zoom,
  ])
}
