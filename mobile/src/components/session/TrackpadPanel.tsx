import {MousePointer2} from "lucide-react-native"
import {useState, type ReactNode} from "react"
import {View, type LayoutChangeEvent} from "react-native"
import {GestureDetector} from "react-native-gesture-handler"

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
}

/**
 * The laptop half of the session: a trackpad under the Mac's screen. A swipe
 * across it moves the pointer about as far as a swipe across the screen would.
 */
export function TrackpadPanel({screenWidth, zoomControls, onThreeFingerTap, header, footer}: TrackpadPanelProps) {
  const {theme} = useAppTheme()
  const video = useSessionStore((s) => s.video)
  const [speed] = useSetting("trackpad_speed")
  const [size, setSize] = useState({width: 0, height: 0})

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

  return (
    <View className="flex-1 gap-3 px-3 pb-3">
      {header}
      <GestureDetector gesture={gesture}>
        <View
          onLayout={onLayout}
          collapsable={false}
          className="flex-1 rounded-3xl items-center justify-center bg-primary-foreground">
          <Icon icon={MousePointer2} size={22} color={theme.colors.muted_foreground} />
        </View>
      </GestureDetector>
      {footer}
    </View>
  )
}
