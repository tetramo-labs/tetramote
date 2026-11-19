import {useEffect, useRef} from "react"
import {Animated, Pressable} from "react-native"

import {useAppTheme} from "@/contexts/ThemeContext"

const TRACK_W = 46
const TRACK_H = 28
const KNOB = 24

export function Switch({value, onValueChange}: {value: boolean; onValueChange: (value: boolean) => void}) {
  const {theme} = useAppTheme()
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current

  useEffect(() => {
    Animated.timing(progress, {toValue: value ? 1 : 0, duration: 200, useNativeDriver: false}).start()
  }, [progress, value])

  const background = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.sidebar_border, theme.colors.brand_secondary],
  })
  const left = progress.interpolate({inputRange: [0, 1], outputRange: [2, TRACK_W - KNOB - 2]})

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked: value}}
      onPress={() => onValueChange(!value)}
      hitSlop={8}>
      <Animated.View style={{width: TRACK_W, height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: background}}>
        <Animated.View
          style={{
            position: "absolute",
            top: 2,
            left,
            width: KNOB,
            height: KNOB,
            borderRadius: KNOB / 2,
            backgroundColor: theme.colors.background,
          }}
        />
      </Animated.View>
    </Pressable>
  )
}
