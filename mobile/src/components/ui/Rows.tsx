import type {TOptions} from "i18next"
import type {ReactNode} from "react"
import {Pressable, View, type ViewStyle} from "react-native"

import {Text} from "@/components/ignite/Text"
import {Switch} from "@/components/ui/Switch"
import {useAppTheme} from "@/contexts/ThemeContext"
import type {TxKeyPath} from "@/i18n"

interface RowProps {
  labelTx?: TxKeyPath
  label?: string
  labelOptions?: TOptions
  subtitleTx?: TxKeyPath
  subtitle?: string
  onPress?: () => void
  destructive?: boolean
  trailing?: ReactNode
  below?: ReactNode
  style?: ViewStyle
}

export function Row({
  labelTx,
  label,
  labelOptions,
  subtitleTx,
  subtitle,
  onPress,
  destructive,
  trailing,
  below,
  style,
}: RowProps) {
  const {theme} = useAppTheme()
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({pressed}) => [
        {backgroundColor: theme.colors.primary_foreground, opacity: pressed ? 0.75 : 1, minHeight: 56},
        style,
      ]}
      className={below ? "px-4 py-3 gap-3" : "flex-row items-center px-4 py-3 gap-3"}>
      <View className={below ? "gap-0.5" : "flex-1 gap-0.5"}>
        <Text
          tx={labelTx}
          text={label}
          txOptions={labelOptions}
          size="sm"
          style={destructive ? {color: theme.colors.destructive} : undefined}
        />
        {(subtitleTx || subtitle) && (
          <Text tx={subtitleTx} text={subtitle} size="xs" className="text-muted-foreground" />
        )}
      </View>
      {trailing}
      {below}
    </Pressable>
  )
}

interface ToggleRowProps extends Omit<RowProps, "trailing" | "onPress"> {
  value: boolean
  onValueChange: (value: boolean) => void
}

export function ToggleRow({value, onValueChange, ...row}: ToggleRowProps) {
  return (
    <Row
      {...row}
      onPress={() => onValueChange(!value)}
      trailing={<Switch value={value} onValueChange={onValueChange} />}
    />
  )
}
