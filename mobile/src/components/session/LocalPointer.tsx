import {Image} from "react-native"
import Animated, {useAnimatedStyle, type SharedValue} from "react-native-reanimated"
import Svg, {Path} from "react-native-svg"

import type {PointerShape} from "@/stores/session"

const PATH_WIDTH = 17
const PATH_HEIGHT = 25
const PATH_TIP = 1.5
/** The drawn arrow, outline included, is about 17.5 Mac points tall at 100%, like the Mac's own pointer. */
const MAC_POINTS_PER_PATH_UNIT = 0.78

/**
 * The phone's own pointer painted over the Mac's screen at `pointer` (0..1
 * across `frame`): the Mac's current pointer image when the host sent one as
 * `shape`, else a drawn macOS arrow. It sits inside the zoomed view at the size
 * the Mac's pointer would have on that screen (`frame` shows `pointWidth` Mac
 * points), times `scale`, so it grows and shrinks with zoom like the real one.
 */
export function LocalPointer({
  pointer,
  shape,
  frame,
  pointWidth,
  scale,
}: {
  pointer: SharedValue<{x: number; y: number}>
  shape: PointerShape | null
  frame: {width: number; height: number}
  pointWidth: number
  scale: number
}) {
  const unit = (frame.width / pointWidth) * scale
  const pathUnit = unit * MAC_POINTS_PER_PATH_UNIT
  const width = shape ? shape.width * unit : PATH_WIDTH * pathUnit
  const height = shape ? shape.height * unit : PATH_HEIGHT * pathUnit
  const hotX = shape ? shape.hotX * unit : PATH_TIP * pathUnit
  const hotY = shape ? shape.hotY * unit : PATH_TIP * pathUnit
  const style = useAnimatedStyle(() => ({
    transform: [
      {translateX: pointer.value.x * frame.width - hotX},
      {translateY: pointer.value.y * frame.height - hotY},
    ],
  }))
  return (
    <Animated.View pointerEvents="none" style={[{position: "absolute", left: 0, top: 0, width, height}, style]}>
      {shape ? (
        <Image source={{uri: shape.uri}} style={{width, height}} fadeDuration={0} />
      ) : (
        <Svg width="100%" height="100%" viewBox={`0 0 ${PATH_WIDTH} ${PATH_HEIGHT}`}>
          <Path
            d="M1.5 1.5V19.6L6.1 15.3L9.1 22.4L12 21.2L9.1 14.3H15.3L1.5 1.5Z"
            fill="#000000"
            stroke="#ffffff"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </Svg>
      )}
    </Animated.View>
  )
}
