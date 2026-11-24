import {useState} from "react"
import {View, type LayoutChangeEvent} from "react-native"
import {Gesture, GestureDetector} from "react-native-gesture-handler"

import {useAppTheme} from "@/contexts/ThemeContext"

const THUMB = 24

/** A horizontal slider that commits on release; vertical drags fall through so the page still scrolls. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onPreview,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  onPreview?: (value: number | null) => void
}) {
  const {theme} = useAppTheme()
  const [width, setWidth] = useState(0)
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  const ratio = max > min ? (Math.min(max, Math.max(min, shown)) - min) / (max - min) : 0

  const at = (x: number) => {
    const travel = Math.max(1, width - THUMB)
    const r = Math.min(1, Math.max(0, (x - THUMB / 2) / travel))
    return Math.min(max, Math.max(min, Math.round((min + r * (max - min)) / step) * step))
  }
  const preview = (next: number | null) => {
    setDraft(next)
    onPreview?.(next)
  }

  const drag = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-4, 4])
    .failOffsetY([-12, 12])
    .onStart((e) => preview(at(e.x)))
    .onUpdate((e) => preview(at(e.x)))
    .onEnd((e) => onChange(at(e.x)))
    .onFinalize(() => preview(null))
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e, success) => {
      if (success) onChange(at(e.x))
    })

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)
  const left = ratio * Math.max(0, width - THUMB)

  return (
    <GestureDetector gesture={Gesture.Race(drag, tap)}>
      <View className="self-stretch justify-center" style={{height: 36}} onLayout={onLayout} collapsable={false}>
        <View
          className="rounded-full"
          style={{height: 6, marginHorizontal: THUMB / 2, backgroundColor: theme.colors.background}}>
          <View
            className="rounded-full"
            style={{height: 6, width: left, backgroundColor: theme.colors.brand_primary}}
          />
        </View>
        <View
          className="absolute rounded-full"
          style={{left, width: THUMB, height: THUMB, backgroundColor: theme.colors.white}}
        />
      </View>
    </GestureDetector>
  )
}
