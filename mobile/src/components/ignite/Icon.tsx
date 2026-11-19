import type {LucideIcon} from "lucide-react-native"
import {Pressable, View, type PressableProps, type ViewStyle} from "react-native"

import GlassView from "@/components/ui/GlassView"
import {useAppTheme} from "@/contexts/ThemeContext"

export interface IconProps {
  icon: LucideIcon
  size?: number
  color?: string
  strokeWidth?: number
}

export function Icon({icon: Glyph, size = 22, color, strokeWidth = 2}: IconProps) {
  const {theme} = useAppTheme()
  return <Glyph size={size} color={color ?? theme.colors.foreground} strokeWidth={strokeWidth} />
}

interface PressableIconProps extends IconProps, Omit<PressableProps, "children" | "style"> {
  glass?: boolean
  active?: boolean
  diameter?: number
  style?: ViewStyle
}

/** A round icon button; `glass` puts it on a liquid-glass disc like the Glassly App's header actions. */
export function PressableIcon({
  icon,
  size = 20,
  color,
  glass,
  active,
  diameter = 40,
  style,
  ...rest
}: PressableIconProps) {
  const {theme} = useAppTheme()
  const tint = active ? theme.colors.background : (color ?? theme.colors.secondary_foreground)
  const disc: ViewStyle = {
    width: diameter,
    height: diameter,
    borderRadius: diameter / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: active
      ? theme.colors.secondary_foreground
      : glass
        ? theme.colors.primary_foreground
        : "transparent",
  }
  return (
    <Pressable hitSlop={6} {...rest} style={({pressed}) => [{opacity: pressed ? 0.75 : 1}, style]}>
      {glass && !active ? (
        <GlassView style={disc}>
          <Icon icon={icon} size={size} color={tint} />
        </GlassView>
      ) : (
        <View style={disc}>
          <Icon icon={icon} size={size} color={tint} />
        </View>
      )}
    </Pressable>
  )
}
