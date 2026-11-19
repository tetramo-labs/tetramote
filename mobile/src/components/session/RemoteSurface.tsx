import {
  MOUSE_LEFT,
  MOUSE_RIGHT,
  RemoteScreen,
  SCROLL_BEGAN,
  SCROLL_CHANGED,
  SCROLL_ENDED,
  SCROLL_MOMENTUM,
} from "@tetratop/remote"
import * as Haptics from "expo-haptics"
import {useMemo, useRef, useState} from "react"
import {View, type LayoutChangeEvent} from "react-native"
import {Gesture, GestureDetector} from "react-native-gesture-handler"
import Animated, {useAnimatedStyle, useSharedValue, type SharedValue} from "react-native-reanimated"

import {sendInput} from "@/services/remote"
import {acceleration, ClickCounter, momentumSteps, normalize, pointerGain} from "@/services/trackpad"
import {useSessionStore} from "@/stores/session"
import {useSetting} from "@/stores/settings"

const MAX_ZOOM = 4
const ZOOM_DECIDE_SCALE = 0.08
const SCROLL_DECIDE_DISTANCE = 12
const DEFAULT_ASPECT = 16 / 10

export interface ZoomControls {
  zoom: SharedValue<number>
  offsetX: SharedValue<number>
  offsetY: SharedValue<number>
}

function fit(containerW: number, containerH: number, aspect: number) {
  if (containerW <= 0 || containerH <= 0) return {width: 0, height: 0}
  return containerW / containerH > aspect
    ? {width: containerH * aspect, height: containerH}
    : {width: containerW, height: containerW / aspect}
}

function clampOffset(offset: number, content: number, container: number, zoom: number) {
  const max = Math.max(0, (content * zoom - container) / 2)
  return Math.min(max, Math.max(-max, offset))
}

/**
 * The Mac's screen plus every touch gesture. Trackpad mode moves the pointer
 * relatively; touch mode puts it under the finger. Two fingers scroll the Mac
 * unless the gesture starts as a pinch, which zooms and pans the view instead.
 */
export function RemoteSurface({zoomControls}: {zoomControls: ZoomControls}) {
  const video = useSessionStore((s) => s.video)
  const inputMode = useSessionStore((s) => s.inputMode)
  const [speed] = useSetting("trackpad_speed")
  const [container, setContainer] = useState({width: 0, height: 0})
  const {zoom, offsetX, offsetY} = zoomControls

  const aspect = video ? video.width / video.height : DEFAULT_ASPECT
  const frame = fit(container.width, container.height, aspect)

  const clicks = useRef(new ClickCounter()).current
  const dragging = useRef(false)
  const twoFinger = useRef<{mode: "undecided" | "scroll" | "zoom"; travel: number}>({mode: "undecided", travel: 0})
  const pinchStart = useRef({zoom: 1, x: 0, y: 0})
  const momentum = useRef<ReturnType<typeof setInterval> | null>(null)

  const gesture = useMemo(() => {
    const toVideo = (x: number, y: number) => {
      const cx = container.width / 2
      const cy = container.height / 2
      const vx = (x - cx - offsetX.value) / zoom.value + frame.width / 2
      const vy = (y - cy - offsetY.value) / zoom.value + frame.height / 2
      return normalize(vx, vy, frame.width, frame.height)
    }
    const gain = () => pointerGain(frame.width, video?.pointWidth ?? 0, zoom.value, speed)
    const stopMomentum = () => {
      if (momentum.current) clearInterval(momentum.current)
      momentum.current = null
    }
    const click = (button: number, count: number) =>
      sendInput([
        {kind: "button", button, down: true, clicks: count},
        {kind: "button", button, down: false, clicks: count},
      ])
    const setZoom = (next: number, focalX: number, focalY: number) => {
      const start = pinchStart.current
      const z = Math.min(MAX_ZOOM, Math.max(1, next))
      const fx = focalX - container.width / 2
      const fy = focalY - container.height / 2
      zoom.value = z
      offsetX.value = clampOffset(fx - (fx - start.x) * (z / start.zoom), frame.width, container.width, z)
      offsetY.value = clampOffset(fy - (fy - start.y) * (z / start.zoom), frame.height, container.height, z)
    }

    const tap = Gesture.Tap()
      .maxDuration(300)
      .runOnJS(true)
      .onEnd((e, success) => {
        if (!success) return
        stopMomentum()
        const count = clicks.register(Date.now(), e.x, e.y)
        if (inputMode === "direct") {
          const p = toVideo(e.x, e.y)
          sendInput([{kind: "moveTo", x: p.x, y: p.y}])
        }
        click(MOUSE_LEFT, count)
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

    const pointerPan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(inputMode === "direct" ? 4 : 3)
      .runOnJS(true)
      .onStart((e) => {
        stopMomentum()
        if (inputMode !== "direct") return
        const p = toVideo(e.x, e.y)
        sendInput([
          {kind: "moveTo", x: p.x, y: p.y},
          {kind: "button", button: MOUSE_LEFT, down: true, clicks: 1},
        ])
        dragging.current = true
      })
      .onChange((e) => {
        if (inputMode === "direct") {
          const p = toVideo(e.x, e.y)
          sendInput([{kind: "moveTo", x: p.x, y: p.y}])
          return
        }
        const k = gain() * acceleration(Math.hypot(e.velocityX, e.velocityY))
        sendInput([{kind: "move", dx: e.changeX * k, dy: e.changeY * k}])
      })
      .onFinalize(() => {
        if (inputMode === "direct" && dragging.current) {
          sendInput([{kind: "button", button: MOUSE_LEFT, down: false, clicks: 1}])
          dragging.current = false
        }
      })

    const dragPan = Gesture.Pan()
      .maxPointers(1)
      .activateAfterLongPress(350)
      .runOnJS(true)
      .onStart((e) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        if (inputMode === "direct") {
          const p = toVideo(e.x, e.y)
          sendInput([{kind: "moveTo", x: p.x, y: p.y}])
          click(MOUSE_RIGHT, 1)
          return
        }
        sendInput([{kind: "button", button: MOUSE_LEFT, down: true, clicks: 1}])
        dragging.current = true
      })
      .onChange((e) => {
        if (inputMode === "direct") return
        const k = gain()
        sendInput([{kind: "move", dx: e.changeX * k, dy: e.changeY * k}])
      })
      .onFinalize(() => {
        if (inputMode !== "direct" && dragging.current) {
          sendInput([{kind: "button", button: MOUSE_LEFT, down: false, clicks: 1}])
          dragging.current = false
        }
      })

    const scrollPan = Gesture.Pan()
      .minPointers(2)
      .maxPointers(2)
      .runOnJS(true)
      .onStart(stopMomentum)
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

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        twoFinger.current = {mode: "undecided", travel: 0}
        pinchStart.current = {zoom: zoom.value, x: offsetX.value, y: offsetY.value}
      })
      .onUpdate((e) => {
        const state = twoFinger.current
        if (state.mode === "undecided" && Math.abs(e.scale - 1) >= ZOOM_DECIDE_SCALE) state.mode = "zoom"
        if (state.mode === "zoom") setZoom(pinchStart.current.zoom * e.scale, e.focalX, e.focalY)
      })

    return Gesture.Race(
      Gesture.Simultaneous(pinch, scrollPan),
      Gesture.Race(dragPan, pointerPan),
      Gesture.Exclusive(twoFingerTap, tap),
    )
  }, [clicks, container, frame.height, frame.width, inputMode, offsetX, offsetY, speed, video?.pointWidth, zoom])

  const animated = useAnimatedStyle(() => ({
    transform: [{translateX: offsetX.value}, {translateY: offsetY.value}, {scale: zoom.value}],
  }))

  const onLayout = (e: LayoutChangeEvent) => {
    const {width, height} = e.nativeEvent.layout
    setContainer({width, height})
  }

  return (
    <GestureDetector gesture={gesture}>
      <View
        className="flex-1 items-center justify-center overflow-hidden bg-black"
        onLayout={onLayout}
        collapsable={false}>
        <Animated.View style={[{width: frame.width, height: frame.height}, animated]}>
          <RemoteScreen style={{flex: 1}} />
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

export function useZoomControls(): ZoomControls {
  return {zoom: useSharedValue(1), offsetX: useSharedValue(0), offsetY: useSharedValue(0)}
}
