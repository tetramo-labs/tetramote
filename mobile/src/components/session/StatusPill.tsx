import {View} from "react-native"

import {Text} from "@/components/ignite/Text"
import GlassView from "@/components/ui/GlassView"
import {useAppTheme} from "@/contexts/ThemeContext"
import {translate} from "@/i18n"
import {useSessionStore} from "@/stores/session"

export function StatusPill() {
  const {theme} = useAppTheme()
  const path = useSessionStore((s) => s.path)
  const rttMs = useSessionStore((s) => s.rttMs)
  const fps = useSessionStore((s) => s.stats?.fps)
  if (!path) return null
  const parts = [
    translate(path === "direct" ? "session:direct" : "session:relay"),
    rttMs !== null ? translate("session:ms", {ms: rttMs}) : null,
    fps !== undefined ? translate("session:fps", {fps: Math.round(fps)}) : null,
  ].filter(Boolean)
  return (
    <GlassView className="rounded-full" style={{backgroundColor: theme.colors.primary_foreground + "CC"}}>
      <View className="flex-row items-center gap-2 px-3 py-1.5">
        <View
          className="w-2 h-2 rounded-full"
          style={{backgroundColor: path === "direct" ? theme.colors.success : theme.colors.warning}}
        />
        <Text text={parts.join(" · ")} size="xs" weight="medium" className="text-foreground" />
      </View>
    </GlassView>
  )
}
