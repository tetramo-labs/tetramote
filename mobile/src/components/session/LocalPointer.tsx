import Animated, {useAnimatedStyle, type SharedValue} from "react-native-reanimated"
import Svg, {Path} from "react-native-svg"

const PATH_WIDTH = 17
const PATH_HEIGHT = 25
const PATH_TIP = 1.5
/** The drawn arrow, outline included, is about 17.5 Mac points tall at 100%, like the Mac's own pointer. */
const MAC_POINTS_PER_PATH_UNIT = 0.78

/**
 * The phone's own pointer, a macOS arrow painted over the Mac's screen at
 * `pointer` (0..1 across `frame`). It sits inside the zoomed view at the size
 * the Mac's pointer would have on that screen (`frame` shows `pointWidth` Mac
 * points), times `scale`, so it grows and shrinks with zoom like the real one.
 */
export function LocalPointer({
  pointer,
  frame,
  pointWidth,
  scale,
}: {
  pointer: SharedValue<{x: number; y: number}>
  frame: {width: number; height: number}
  pointWidth: number
  scale: number
}) {
  const unit = (frame.width / pointWidth) * MAC_POINTS_PER_PATH_UNIT * scale
  const tip = PATH_TIP * unit
  const style = useAnimatedStyle(() => ({
    transform: [{translateX: pointer.value.x * frame.width - tip}, {translateY: pointer.value.y * frame.height - tip}],
  }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[{position: "absolute", left: 0, top: 0, width: PATH_WIDTH * unit, height: PATH_HEIGHT * unit}, style]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${PATH_WIDTH} ${PATH_HEIGHT}`}>
        <Path
          d="M1.5 1.5V19.6L6.1 15.3L9.1 22.4L12 21.2L9.1 14.3H15.3L1.5 1.5Z"
          fill="#000000"
          stroke="#ffffff"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </Svg>
    </Animated.View>
  )
}
