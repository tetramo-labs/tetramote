import {
  ClipboardList,
  Ellipsis,
  Hand,
  Keyboard,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointer2,
  Volume2,
  VolumeX,
  X,
  ZoomOut,
} from "lucide-react-native"
import {View} from "react-native"

import {PressableIcon} from "@/components/ignite/Icon"
import GlassView from "@/components/ui/GlassView"
import {translate} from "@/i18n"
import {RAIL_BUTTON, RAIL_GAP} from "@/services/railLayout"
import {setAudio} from "@/services/remote"
import type {RailAction} from "@/stores/railToolbar"
import {useSessionStore} from "@/stores/session"

const BAR = "rgba(46,46,46,0.85)"
const ICON = "#fafafa"

interface SessionActionHandlers {
  zoomed: boolean
  onUse: () => void
  onDisconnect: () => void
  onKeyboard: () => void
  onDisplays: () => void
  onClipboard: () => void
  onResetZoom: () => void
}

/** The session's controls in the order a Duo rail lists them: Close, then the main actions, then the rest. */
export function useSessionActions({
  zoomed,
  onUse,
  onDisconnect,
  onKeyboard,
  onDisplays,
  onClipboard,
  onResetZoom,
}: SessionActionHandlers): RailAction[] {
  const inputMode = useSessionStore((s) => s.inputMode)
  const setInputMode = useSessionStore((s) => s.setInputMode)
  const fullScreen = useSessionStore((s) => s.fullScreen)
  const setFullScreen = useSessionStore((s) => s.setFullScreen)
  const audio = useSessionStore((s) => s.audio)
  const displays = useSessionStore((s) => s.displays.length)
  const used = (fn: () => void) => () => {
    onUse()
    fn()
  }

  return [
    {key: "disconnect", icon: X, label: translate("session:disconnect"), onPress: onDisconnect},
    {
      key: "mode",
      icon: inputMode === "trackpad" ? MousePointer2 : Hand,
      label: translate(inputMode === "trackpad" ? "session:trackpad" : "session:direct_touch"),
      onPress: used(() => setInputMode(inputMode === "trackpad" ? "direct" : "trackpad")),
    },
    {key: "keyboard", icon: Keyboard, label: translate("session:keyboard"), onPress: used(onKeyboard)},
    {
      key: "fullScreen",
      icon: fullScreen ? Minimize2 : Maximize2,
      label: translate(fullScreen ? "session:exitFullScreen" : "session:fullScreen"),
      onPress: used(() => setFullScreen(!fullScreen)),
    },
    ...(displays > 1
      ? [{key: "displays", icon: Monitor, label: translate("session:displays"), onPress: used(onDisplays)}]
      : []),
    {key: "clipboard", icon: ClipboardList, label: translate("session:clipboard"), onPress: used(onClipboard)},
    {
      key: "audio",
      icon: audio ? Volume2 : VolumeX,
      label: translate(audio ? "session:audioOn" : "session:audioOff"),
      onPress: used(() => setAudio(!audio)),
    },
    ...(zoomed
      ? [{key: "zoom", icon: ZoomOut, label: translate("session:resetZoom"), onPress: used(onResetZoom)}]
      : []),
  ]
}

export function SessionToolbar({actions, vertical}: {actions: RailAction[]; vertical: boolean}) {
  return (
    <GlassView className="rounded-full" style={{backgroundColor: BAR}}>
      <View className={vertical ? "py-2 px-1 gap-1" : "flex-row px-2 py-1 gap-1"}>
        {actions.map((a) => (
          <PressableIcon
            key={a.key}
            icon={a.icon}
            color={ICON}
            onPress={a.onPress}
            accessibilityLabel={a.label}
            diameter={42}
          />
        ))}
      </View>
    </GlassView>
  )
}

export function BottomRail({actions}: {actions: RailAction[]}) {
  return (
    <View className="flex-row justify-center" style={{gap: RAIL_GAP}}>
      {actions.map((a) => (
        <PressableIcon
          key={a.key}
          icon={a.icon}
          glass
          active={a.active}
          diameter={RAIL_BUTTON}
          onPress={a.onPress}
          accessibilityLabel={a.label}
        />
      ))}
    </View>
  )
}

/** What stays on screen while auto-hide has hidden the controls. */
export function ControlsHandle({onPress}: {onPress: () => void}) {
  return (
    <GlassView className="rounded-full" style={{backgroundColor: BAR, opacity: 0.6}}>
      <PressableIcon
        icon={Ellipsis}
        color={ICON}
        onPress={onPress}
        accessibilityLabel={translate("session:showControls")}
        diameter={42}
        size={22}
      />
    </GlassView>
  )
}
