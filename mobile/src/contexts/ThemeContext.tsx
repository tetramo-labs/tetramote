import * as NavigationBar from "expo-navigation-bar"
import * as SystemUI from "expo-system-ui"
import {createContext, useContext, useEffect, useMemo, type ReactNode} from "react"
import {Platform, useColorScheme, type StyleProp} from "react-native"
import {Uniwind} from "uniwind"

import {useSetting} from "@/stores/settings"
import {darkTheme, lightTheme, type Theme, type ThemedStyle} from "@/theme"

interface ThemeContextValue {
  theme: Theme
  themeContext: "light" | "dark"
}

const ThemeContext = createContext<ThemeContextValue>({theme: darkTheme, themeContext: "dark"})

export function ThemeProvider({children}: {children: ReactNode}) {
  const scheme = useColorScheme()
  const [preference] = useSetting("theme_preference")
  const themeContext = preference === "system" ? (scheme === "light" ? "light" : "dark") : preference
  const theme = themeContext === "dark" ? darkTheme : lightTheme

  useEffect(() => {
    Uniwind.setTheme(preference === "system" ? "system" : preference)
  }, [preference])

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.background)
    if (Platform.OS === "android") NavigationBar.setStyle(themeContext)
  }, [theme, themeContext])

  const value = useMemo(() => ({theme, themeContext}), [theme, themeContext])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Current palette for `style` objects and non-style props such as icon colors. */
export function useAppTheme() {
  const {theme, themeContext} = useContext(ThemeContext)
  const themed = <T,>(style: ThemedStyle<T> | StyleProp<T> | (ThemedStyle<T> | StyleProp<T>)[]): T => {
    const list = Array.isArray(style) ? style : [style]
    return Object.assign(
      {},
      ...list.flat().map((s) => (typeof s === "function" ? (s as ThemedStyle<T>)(theme) : s)),
    ) as T
  }
  return {theme, themeContext, themed}
}
