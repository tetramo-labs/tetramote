import {GlassView as NativeGlass, isLiquidGlassAvailable, type GlassViewProps} from "expo-glass-effect"
import {Platform, View, type ViewProps} from "react-native"
import {withUniwind} from "uniwind"

import {useAppTheme} from "@/contexts/ThemeContext"

const StyledGlass = withUniwind(NativeGlass)
const SHADOW = "8px 8px 16px 0px rgba(0, 0, 0, 0.06)"

interface Props extends ViewProps {
  transparent?: boolean
  tintColor?: string
}

/**
 * Liquid glass on iOS, a translucent surface with a soft shadow elsewhere.
 * Never clip a GlassView itself (it smears the rim and drops the shadow); clip an inner view.
 */
function GlassView({children, style, transparent, tintColor, ...props}: Props & Omit<GlassViewProps, "tintColor">) {
  const {theme} = useAppTheme()
  if (Platform.OS === "ios" && isLiquidGlassAvailable()) {
    return (
      <StyledGlass
        {...props}
        colorScheme={theme.isDark ? "dark" : "light"}
        tintColor={tintColor}
        style={[style, {boxShadow: SHADOW}, transparent ? {backgroundColor: "transparent"} : undefined]}>
        {children}
      </StyledGlass>
    )
  }
  const backgroundColor = tintColor ?? (transparent ? undefined : theme.colors.primary_foreground + "E6")
  return (
    <View {...props} style={[{backgroundColor}, style, {boxShadow: SHADOW}]}>
      {children}
    </View>
  )
}

export default withUniwind(GlassView)
