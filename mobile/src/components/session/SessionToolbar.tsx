import {
  ClipboardList,
  Hand,
  Keyboard,
  Monitor,
  MousePointer2,
  Volume2,
  VolumeX,
  X,
  ZoomOut,
  type LucideIcon,
} from "lucide-react-native"
import {View} from "react-native"

import {PressableIcon} from "@/components/ignite/Icon"
import GlassView from "@/components/ui/GlassView"
import {useAppTheme} from "@/contexts/ThemeContext"
import {translate, type TxKeyPath} from "@/i18n"
import {setAudio} from "@/services/remote"
import {useSessionStore} from "@/stores/session"

interface ToolbarProps {
  vertical: boolean
  zoomed: boolean
  onDisconnect: () => void
  onKeyboard: () => void
  onDisplays: () => void
  onClipboard: () => void
  onResetZoom: () => void
}

interface Action {
  key: string
  icon: LucideIcon
  label: TxKeyPath
  onPress: () => void
  active?: boolean
}

export function SessionToolbar({
  vertical,
  zoomed,
  onDisconnect,
  onKeyboard,
  onDisplays,
  onClipboard,
  onResetZoom,
}: ToolbarProps) {
  const {theme} = useAppTheme()
  const inputMode = useSessionStore((s) => s.inputMode)
  const setInputMode = useSessionStore((s) => s.setInputMode)
  const audio = useSessionStore((s) => s.audio)
  const displays = useSessionStore((s) => s.displays.length)

  const actions: Action[] = [
    {key: "disconnect", icon: X, label: "session:disconnect", onPress: onDisconnect},
    {
      key: "mode",
      icon: inputMode === "trackpad" ? MousePointer2 : Hand,
      label: inputMode === "trackpad" ? "session:trackpad" : "session:direct_touch",
      onPress: () => setInputMode(inputMode === "trackpad" ? "direct" : "trackpad"),
    },
    {key: "keyboard", icon: Keyboard, label: "session:keyboard", onPress: onKeyboard},
    ...(displays > 1
      ? [{key: "displays", icon: Monitor, label: "session:displays" as TxKeyPath, onPress: onDisplays}]
      : []),
    {key: "clipboard", icon: ClipboardList, label: "session:clipboard", onPress: onClipboard},
    {
      key: "audio",
      icon: audio ? Volume2 : VolumeX,
      label: audio ? "session:audioOn" : "session:audioOff",
      onPress: () => setAudio(!audio),
    },
    ...(zoomed ? [{key: "zoom", icon: ZoomOut, label: "session:resetZoom" as TxKeyPath, onPress: onResetZoom}] : []),
  ]

  return (
    <GlassView className="rounded-full" style={{backgroundColor: theme.colors.primary_foreground + "CC"}}>
      <View className={vertical ? "py-2 px-1 gap-1" : "flex-row px-2 py-1 gap-1"}>
        {actions.map((a) => (
          <PressableIcon
            key={a.key}
            icon={a.icon}
            onPress={a.onPress}
            accessibilityLabel={translate(a.label)}
            diameter={42}
          />
        ))}
      </View>
    </GlassView>
  )
}
