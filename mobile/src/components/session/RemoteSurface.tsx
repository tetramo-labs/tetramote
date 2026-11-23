import {RemoteScreen} from "@tetramote/remote"
import {useEffect, useState} from "react"
import {View, type LayoutChangeEvent} from "react-native"
import {GestureDetector} from "react-native-gesture-handler"
import Animated, {useAnimatedStyle, useSharedValue} from "react-native-reanimated"

import {useInputGesture, type ZoomControls} from "@/components/session/useInputGesture"
import {useSessionStore} from "@/stores/session"
import {useSetting} from "@/stores/settings"

export type {ZoomControls}

export const DEFAULT_ASPECT = 16 / 10

function fit(containerW: number, containerH: number, aspect: number) {
  if (containerW <= 0 || containerH <= 0) return {width: 0, height: 0}
  return containerW / containerH > aspect
    ? {width: containerH * aspect, height: containerH}
    : {width: containerW, height: containerW / aspect}
}

interface RemoteSurfaceProps {
  zoomControls: ZoomControls
  onThreeFingerTap: () => void
}

/** The Mac's screen, aspect-fit in its box, taking touches as Mac input and pinches as zoom. */
export function RemoteSurface({zoomControls, onThreeFingerTap}: RemoteSurfaceProps) {
  const video = useSessionStore((s) => s.video)
  const inputMode = useSessionStore((s) => s.inputMode)
  const [speed] = useSetting("trackpad_speed")
  const [container, setContainer] = useState({width: 0, height: 0})
  const {zoom, offsetX, offsetY} = zoomControls
  const frame = fit(container.width, container.height, video ? video.width / video.height : DEFAULT_ASPECT)

  useEffect(() => {
    zoomControls.view.value = {frame: {width: frame.width, height: frame.height}, container}
  }, [zoomControls.view, frame.width, frame.height, container])

  const gesture = useInputGesture({
    surface: "screen",
    inputMode,
    speed,
    container,
    frame,
    pointWidth: video?.pointWidth ?? 0,
    zoomControls,
    onThreeFingerTap,
  })

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
        className="flex-1 items-center justify-center overflow-hidden bg-background"
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
  return {
    zoom: useSharedValue(1),
    offsetX: useSharedValue(0),
    offsetY: useSharedValue(0),
    view: useSharedValue({frame: {width: 0, height: 0}, container: {width: 0, height: 0}}),
  }
}
