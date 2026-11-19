import type {TOptions} from "i18next"
import type {ReactNode} from "react"
import {ActivityIndicator, Pressable, View, type PressableProps, type TextStyle, type ViewStyle} from "react-native"

import {Text} from "@/components/ignite/Text"
import {useAppTheme} from "@/contexts/ThemeContext"
import type {TxKeyPath} from "@/i18n"
import type {ThemedStyle} from "@/theme"

type Presets = "default" | "secondary" | "accent" | "destructive" | "outlined"

interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  tx?: TxKeyPath
  text?: string
  txOptions?: TOptions
  preset?: Presets
  compact?: boolean
  loading?: boolean
  LeftAccessory?: () => ReactNode
  style?: ViewStyle
}

const baseView: ThemedStyle<ViewStyle> = ({spacing, colors, isDark}) => ({
  minHeight: 44,
  borderRadius: 50,
  flexDirection: "row",
  gap: spacing.s2,
  justifyContent: "center",
  alignItems: "center",
  paddingVertical: spacing.s3,
  paddingHorizontal: spacing.s4,
  overflow: "hidden",
  borderWidth: isDark ? 0 : 1,
  borderColor: isDark ? undefined : colors.border,
})

const views: Record<Presets, ThemedStyle<ViewStyle>> = {
  default: ({colors}) => ({backgroundColor: colors.secondary_foreground}),
  secondary: ({colors}) => ({backgroundColor: colors.primary_foreground}),
  accent: ({colors}) => ({backgroundColor: colors.brand_secondary, borderWidth: 0}),
  destructive: ({colors}) => ({backgroundColor: colors.destructive, borderWidth: 0}),
  outlined: ({colors}) => ({backgroundColor: "transparent", borderWidth: 1.5, borderColor: colors.muted_foreground}),
}

const texts: Record<Presets, ThemedStyle<TextStyle>> = {
  default: ({colors}) => ({color: colors.primary_foreground}),
  secondary: ({colors}) => ({color: colors.secondary_foreground}),
  accent: () => ({color: "#0a0a0a"}),
  destructive: () => ({color: "#ffffff"}),
  outlined: ({colors}) => ({color: colors.foreground}),
}

/** Pill button; the default preset is inverted (text color as the fill), as in the Glassly App. */
export function Button({
  tx,
  text,
  txOptions,
  preset = "default",
  compact,
  loading,
  LeftAccessory,
  style,
  disabled,
  ...rest
}: ButtonProps) {
  const {themed} = useAppTheme()
  const textStyle = themed<TextStyle>([texts[preset], {fontSize: 14, textAlign: "center"}])
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      {...rest}
      style={({pressed}) => [
        themed<ViewStyle>([baseView, views[preset]]),
        compact ? {minHeight: 0, paddingVertical: 8, paddingHorizontal: 16} : undefined,
        {opacity: disabled ? 0.4 : pressed ? 0.75 : 1},
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={textStyle.color} />
      ) : (
        <View className="flex-row items-center gap-2">
          {LeftAccessory?.()}
          <Text tx={tx} text={text} txOptions={txOptions} weight="medium" style={textStyle} />
        </View>
      )}
    </Pressable>
  )
}
