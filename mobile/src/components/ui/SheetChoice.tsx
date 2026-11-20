import type {LucideIcon} from "lucide-react-native"
import {Pressable, View} from "react-native"

import {Icon} from "@/components/ignite/Icon"
import {Text} from "@/components/ignite/Text"
import {useAppTheme} from "@/contexts/ThemeContext"
import type {TxKeyPath} from "@/i18n"

/** One option in a sheet: an icon, a label and a line that says what happens. */
export function SheetChoice({
  icon,
  labelTx,
  subtitleTx,
  destructive = false,
  onPress,
}: {
  icon: LucideIcon
  labelTx: TxKeyPath
  subtitleTx: TxKeyPath
  destructive?: boolean
  onPress: () => void
}) {
  const {theme} = useAppTheme()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl px-4 py-3 bg-primary-foreground">
      <Icon icon={icon} size={20} color={destructive ? theme.colors.destructive : theme.colors.brand_secondary} />
      <View className="flex-1 gap-0.5">
        <Text tx={labelTx} size="sm" className={destructive ? "text-destructive" : "text-foreground"} />
        <Text tx={subtitleTx} size="xs" className="text-muted-foreground" />
      </View>
    </Pressable>
  )
}
