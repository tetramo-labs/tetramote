import {ArrowRight, Monitor} from "lucide-react-native"
import {Pressable, View} from "react-native"

import {Icon} from "@/components/ignite/Icon"
import {Text} from "@/components/ignite/Text"
import GlassView from "@/components/ui/GlassView"
import {useAppTheme} from "@/contexts/ThemeContext"
import type {PairedMac} from "@/stores/hosts"

interface HostCardProps {
  host: PairedMac
  onPress: () => void
  onLongPress: () => void
}

function formatWhen(time: number): string {
  return new Date(time).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"})
}

export function HostCard({host, onPress, onLongPress}: HostCardProps) {
  const {theme} = useAppTheme()
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button">
      {({pressed}) => (
        <GlassView
          className="rounded-2xl"
          style={{backgroundColor: theme.colors.primary_foreground, opacity: pressed ? 0.75 : 1}}>
          <View className="flex-row items-center gap-3 px-4 py-4">
            <View className="w-12 h-12 rounded-full items-center justify-center bg-background">
              <Icon icon={Monitor} size={22} color={theme.colors.brand_secondary} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text text={host.name} size="md" weight="semibold" className="text-foreground" numberOfLines={1} />
              <Text
                tx={host.lastConnectedAt ? "home:lastConnected" : "home:neverConnected"}
                txOptions={host.lastConnectedAt ? {when: formatWhen(host.lastConnectedAt)} : undefined}
                size="xs"
                className="text-muted-foreground"
                numberOfLines={1}
              />
            </View>
            <View className="w-10 h-10 rounded-full items-center justify-center bg-background">
              <Icon icon={ArrowRight} size={18} color={theme.colors.muted_foreground} />
            </View>
          </View>
        </GlassView>
      )}
    </Pressable>
  )
}
