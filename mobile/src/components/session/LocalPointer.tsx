import Animated, {useAnimatedStyle, type SharedValue} from "react-native-reanimated"
import Svg, {Path} from "react-native-svg"

const WIDTH = 17
const HEIGHT = 25
const TIP = 1.5

/**
 * The phone's own pointer, a macOS arrow painted over the Mac's screen at
 * `pointer` (0..1 across `frame`). It sits inside the zoomed view and scales
 * back by the zoom, so it follows pans and zooms at a constant size.
 */
export function LocalPointer({
  pointer,
  zoom,
  frame,
}: {
  pointer: SharedValue<{x: number; y: number}>
  zoom: SharedValue<number>
  frame: {width: number; height: number}
}) {
  const style = useAnimatedStyle(() => ({
    transform: [
      {translateX: pointer.value.x * frame.width - TIP / zoom.value},
      {translateY: pointer.value.y * frame.height - TIP / zoom.value},
      {scale: 1 / zoom.value},
    ],
  }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[{position: "absolute", left: 0, top: 0, width: WIDTH, height: HEIGHT, transformOrigin: "0 0"}, style]}>
      <Svg width={WIDTH} height={HEIGHT} viewBox="0 0 17 25">
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
