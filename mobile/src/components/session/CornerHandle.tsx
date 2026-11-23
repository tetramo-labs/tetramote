import {Ellipsis} from "lucide-react-native"
import {useCallback, useEffect} from "react"
import {useWindowDimensions} from "react-native"
import {Gesture, GestureDetector} from "react-native-gesture-handler"
import Animated, {Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming} from "react-native-reanimated"

import {Icon} from "@/components/ignite/Icon"
import GlassView from "@/components/ui/GlassView"
import {useSaferAreaInsets} from "@/contexts/SaferAreaContext"
import {translate} from "@/i18n"
import {useSetting, type ControlsCorner} from "@/stores/settings"

const SIZE = 34
const MARGIN = 12
const FADE_AFTER_MS = 2000
const FADE_MS = 600
const SLIDE_MS = 320
const SNAP = {duration: 220, easing: Easing.out(Easing.cubic)}

/**
 * Full screen's way back to the controls: the dots slide to their corner and
 * fade out; a tap there shows them again and a second tap opens the toolbar.
 * Dragged anywhere, they snap to the nearest corner, which is remembered.
 */
export function CornerHandle({origin, onOpen}: {origin: "bottom" | "right"; onOpen: () => void}) {
  const {width, height} = useWindowDimensions()
  const insets = useSaferAreaInsets()
  const [corner, setCorner] = useSetting("controls_corner")
  const x = useSharedValue(origin === "bottom" ? (width - SIZE) / 2 : width - insets.right - MARGIN - SIZE)
  const y = useSharedValue(origin === "bottom" ? height - insets.bottom - MARGIN - SIZE : (height - SIZE) / 2)
  const opacity = useSharedValue(1)

  const spot = useCallback(
    (c: ControlsCorner) => ({
      x: c.endsWith("left") ? insets.left + MARGIN : width - insets.right - MARGIN - SIZE,
      y: c.startsWith("top") ? insets.top + MARGIN : height - insets.bottom - MARGIN - SIZE,
    }),
    [insets.left, insets.right, insets.top, insets.bottom, width, height],
  )

  const fadeLater = useCallback(() => {
    opacity.value = 1
    opacity.value = withDelay(FADE_AFTER_MS, withTiming(0, {duration: FADE_MS}))
  }, [opacity])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const to = spot(corner)
      x.value = withTiming(to.x, {duration: SLIDE_MS})
      y.value = withTiming(to.y, {duration: SLIDE_MS})
      fadeLater()
    })
    return () => cancelAnimationFrame(frame)
  }, [corner, spot, fadeLater, x, y])

  const tap = Gesture.Tap()
    .runOnJS(true)
    .hitSlop(24)
    .onEnd((_e, success) => {
      if (!success) return
      if (opacity.value > 0.5) onOpen()
      else fadeLater()
    })

  const drag = Gesture.Pan()
    .runOnJS(true)
    .hitSlop(24)
    .onStart(() => {
      opacity.value = 1
    })
    .onChange((e) => {
      x.value += e.changeX
      y.value += e.changeY
    })
    .onEnd(() => {
      const left = x.value + SIZE / 2 < width / 2
      const top = y.value + SIZE / 2 < height / 2
      const next: ControlsCorner = `${top ? "top" : "bottom"}-${left ? "left" : "right"}`
      const to = spot(next)
      x.value = withTiming(to.x, SNAP)
      y.value = withTiming(to.y, SNAP)
      setCorner(next)
      fadeLater()
    })

  const place = useAnimatedStyle(() => ({
    position: "absolute",
    left: 0,
    top: 0,
    transform: [{translateX: x.value}, {translateY: y.value}],
  }))
  const fade = useAnimatedStyle(() => ({opacity: opacity.value}))

  return (
    <GestureDetector gesture={Gesture.Race(drag, tap)}>
      <Animated.View style={place} accessibilityRole="button" accessibilityLabel={translate("session:showControls")}>
        <Animated.View style={fade}>
          <GlassView
            className="rounded-full items-center justify-center"
            style={{width: SIZE, height: SIZE, backgroundColor: "rgba(46,46,46,0.85)"}}>
            <Icon icon={Ellipsis} size={18} color="#fafafa" />
          </GlassView>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  )
}
