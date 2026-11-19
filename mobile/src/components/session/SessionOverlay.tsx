import {ActivityIndicator, View} from "react-native"

import {Button} from "@/components/ignite/Button"
import {Text} from "@/components/ignite/Text"
import GlassView from "@/components/ui/GlassView"
import {useAppTheme} from "@/contexts/ThemeContext"
import {useLayout} from "@/hooks/useLayout"
import {retry} from "@/services/remote"
import {useSessionStore} from "@/stores/session"

export function SessionOverlay({onBack}: {onBack: () => void}) {
  const {theme} = useAppTheme()
  const {insetLeft, insetRight} = useLayout()
  const phase = useSessionStore((s) => s.phase)
  const error = useSessionStore((s) => s.error)
  const name = useSessionStore((s) => s.target?.name ?? "")
  const hasVideo = useSessionStore((s) => s.stats !== null && s.stats.fps > 0)

  if (phase === "connected" && hasVideo) return null

  const failed = phase === "failed"
  const tx =
    phase === "reconnecting"
      ? "session:reconnecting"
      : phase === "connected"
        ? "session:waitingForVideo"
        : "session:connecting"

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-0 items-center justify-center"
      style={{paddingLeft: insetLeft + 32, paddingRight: insetRight + 32}}>
      <GlassView
        className="rounded-3xl w-full"
        style={{maxWidth: 380, backgroundColor: theme.colors.primary_foreground}}>
        <View className="px-6 py-6 gap-4 items-center">
          {failed ? (
            <Text text={error ?? ""} size="md" className="text-foreground text-center" />
          ) : (
            <>
              <ActivityIndicator color={theme.colors.foreground} />
              <Text tx={tx} txOptions={{name}} size="md" className="text-foreground text-center" />
            </>
          )}
          <View className="flex-row gap-3 self-stretch">
            <Button tx="common:close" preset="secondary" style={{flex: 1}} onPress={onBack} />
            {failed && <Button tx="common:retry" style={{flex: 1}} onPress={retry} />}
          </View>
        </View>
      </GlassView>
    </View>
  )
}
