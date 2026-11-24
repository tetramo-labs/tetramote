import {Pressable, View} from "react-native"

import {Text} from "@/components/ignite/Text"
import GlassView from "@/components/ui/GlassView"
import {translate} from "@/i18n"
import {useSessionStore} from "@/stores/session"

/** The connection at a glance; a tap opens the stream settings. */
export function StatusPill({onPress}: {onPress: () => void}) {
  const path = useSessionStore((s) => s.path)
  const rttMs = useSessionStore((s) => s.rttMs)
  const fps = useSessionStore((s) => s.stats?.fps)
  const kbps = useSessionStore((s) => s.stats?.kbps)
  if (!path) return null
  const parts = [
    translate(path === "direct" ? "session:direct" : "session:relay"),
    rttMs !== null ? translate("session:ms", {ms: rttMs}) : null,
    fps !== undefined ? translate("session:fps", {fps: Math.round(fps)}) : null,
    kbps !== undefined ? translate("session:mbps", {mbps: (kbps / 1000).toFixed(1)}) : null,
  ].filter(Boolean)
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityHint={translate("session:streamTitle")}
      style={({pressed}) => ({opacity: pressed ? 0.7 : 1})}>
      <GlassView className="rounded-full" style={{backgroundColor: "rgba(46,46,46,0.85)"}}>
        <View className="flex-row items-center gap-2 px-3 py-1.5">
          <View className="w-2 h-2 rounded-full" style={{backgroundColor: path === "direct" ? "#4ade80" : "#fbbf24"}} />
          <Text text={parts.join(" · ")} size="xs" weight="medium" style={{color: "#fafafa"}} />
        </View>
      </GlassView>
    </Pressable>
  )
}
