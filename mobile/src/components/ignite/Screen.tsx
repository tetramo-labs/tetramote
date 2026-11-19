import {StatusBar} from "expo-status-bar"
import type {ReactNode} from "react"
import {ScrollView, View, type ViewStyle} from "react-native"

import {useAppTheme} from "@/contexts/ThemeContext"
import {useSaferAreaInsets} from "@/contexts/SaferAreaContext"
import {usePageGutters} from "@/hooks/useLayout"

type Edge = "top" | "bottom"

interface ScreenProps {
  children: ReactNode
  preset?: "fixed" | "scroll"
  safeAreaEdges?: Edge[]
  header?: ReactNode
  className?: string
}

/**
 * Page container: 24 pt side padding, content kept off the Duo's rail (backgrounds
 * run under it), and a centered column on wide windows.
 */
export function Screen({
  children,
  preset = "fixed",
  safeAreaEdges = ["top", "bottom"],
  header,
  className,
}: ScreenProps) {
  const {theme, themeContext} = useAppTheme()
  const insets = useSaferAreaInsets()
  const gutters = usePageGutters()
  const outer: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingTop: safeAreaEdges.includes("top") ? insets.top : 0,
  }
  const bottom = safeAreaEdges.includes("bottom") ? insets.bottom : 0

  return (
    <View style={outer}>
      <StatusBar style={themeContext === "dark" ? "light" : "dark"} />
      {header}
      {preset === "scroll" ? (
        <ScrollView
          className="flex-1"
          automaticallyAdjustsScrollIndicatorInsets={false}
          contentContainerClassName={className}
          contentContainerStyle={{paddingLeft: gutters.left, paddingRight: gutters.right, paddingBottom: bottom + 24}}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View
          className={`flex-1 ${className ?? ""}`}
          style={{paddingLeft: gutters.left, paddingRight: gutters.right, paddingBottom: bottom}}>
          {children}
        </View>
      )}
    </View>
  )
}
