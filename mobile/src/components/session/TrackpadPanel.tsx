import {MousePointer2} from "lucide-react-native"
import {useEffect, useRef, useState, type ReactNode} from "react"
import {View, type LayoutChangeEvent} from "react-native"
import {Gesture, GestureDetector} from "react-native-gesture-handler"
import Animated, {useAnimatedStyle, useSharedValue, withTiming} from "react-native-reanimated"

import {Icon} from "@/components/ignite/Icon"
import {useInputGesture, type ZoomControls} from "@/components/session/useInputGesture"
import {useAppTheme} from "@/contexts/ThemeContext"
import {useSessionStore} from "@/stores/session"
import {useSetting} from "@/stores/settings"

interface TrackpadPanelProps {
  screenWidth: number
  zoomControls: ZoomControls
  onThreeFingerTap: () => void
  header?: ReactNode
  footer?: ReactNode
  bare?: boolean
  aspect?: number
  headerSpace?: number
}

const ICON_RETURNS_AFTER_MS = 15_000

/**
 * The laptop half of the session: a trackpad under the Mac's screen. A swipe
 * across it moves the pointer about as far as a swipe across the screen would.
 * A bare panel is only the trackpad, filling its parent edge to edge. With an
 * aspect, the trackpad is the largest such box centred above the footer that
 * leaves headerSpace above it, where the header is centred. The pointer icon
 * fades while the trackpad is in use and returns after ICON_RETURNS_AFTER_MS.
 */
export function TrackpadPanel({
  screenWidth,
  zoomControls,
  onThreeFingerTap,
  header,
  footer,
  bare,
  aspect,
  headerSpace = 0,
}: TrackpadPanelProps) {
  const {theme} = useAppTheme()
  const video = useSessionStore((s) => s.video)
  const [speed] = useSetting("trackpad_speed")
  const [size, setSize] = useState({width: 0, height: 0})
  const [room, setRoom] = useState({width: 0, height: 0})
  const iconOpacity = useSharedValue(1)
  const iconTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (iconTimer.current) clearTimeout(iconTimer.current)
    },
    [],
  )

  const touched = () => {
    iconOpacity.value = withTiming(0, {duration: 200})
    if (iconTimer.current) clearTimeout(iconTimer.current)
    iconTimer.current = setTimeout(() => {
      iconOpacity.value = withTiming(1, {duration: 400})
    }, ICON_RETURNS_AFTER_MS)
  }
  const watcher = Gesture.Manual().runOnJS(true).onTouchesDown(touched)
  const iconStyle = useAnimatedStyle(() => ({opacity: iconOpacity.value}))

  const gesture = useInputGesture({
    surface: "trackpad",
    inputMode: "trackpad",
    speed,
    container: size,
    frame: {width: screenWidth, height: size.height},
    pointWidth: video?.pointWidth ?? 0,
    zoomControls,
    onThreeFingerTap,
  })

  const onLayout = (e: LayoutChangeEvent) => {
    const {width, height} = e.nativeEvent.layout
    setSize({width, height})
  }

  const usable = Math.max(0, room.height - 2 * headerSpace)
  const fitted = aspect && {
    width: Math.min(room.width, usable * aspect),
    height: Math.min(room.width, usable * aspect) / aspect,
  }

  const pad = (
    <GestureDetector gesture={Gesture.Simultaneous(gesture, watcher)}>
      <View
        onLayout={onLayout}
        collapsable={false}
        style={fitted || undefined}
        className={`${fitted ? "" : "flex-1 "}rounded-3xl items-center justify-center bg-primary-foreground`}>
        <Animated.View style={iconStyle}>
          <Icon icon={MousePointer2} size={22} color={theme.colors.muted_foreground} />
        </Animated.View>
      </View>
    </GestureDetector>
  )

  return (
    <View className={bare ? "flex-1" : "flex-1 gap-3 px-3 pb-3"}>
      {!aspect && header}
      {aspect ? (
        <View
          className="flex-1 items-center justify-center"
          onLayout={(e) => setRoom({width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height})}>
          {pad}
          {header && fitted && (
            <View
              pointerEvents="box-none"
              className="absolute left-0 right-0 top-0 items-center justify-center"
              style={{height: (room.height - fitted.height) / 2}}>
              {header}
            </View>
          )}
        </View>
      ) : (
        pad
      )}
      {footer}
    </View>
  )
}
