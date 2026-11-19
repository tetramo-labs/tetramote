import "@/global.css"
import "@/i18n"

import {useFonts} from "expo-font"
import {Stack} from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import {useEffect} from "react"

import {RailToolbarHost} from "@/components/ui/RailToolbar"
import {SafeToast} from "@/components/ui/SafeToast"
import {AllProviders} from "@/contexts/AllProviders"
import {useAppTheme} from "@/contexts/ThemeContext"
import {ensureStarted} from "@/services/remote"
import {customFontsToLoad} from "@/theme/typography"

SplashScreen.preventAutoHideAsync()

function AppStack() {
  const {theme} = useAppTheme()
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "simple_push",
        contentStyle: {backgroundColor: theme.colors.background},
      }}>
      <Stack.Screen name="session" options={{animation: "fade", gestureEnabled: false}} />
      <Stack.Screen name="pair" options={{animation: "slide_from_bottom"}} />
    </Stack>
  )
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(customFontsToLoad)

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync()
  }, [fontsLoaded, fontError])

  useEffect(() => {
    ensureStarted().catch(() => undefined)
  }, [])

  if (!fontsLoaded && !fontError) return null

  return (
    <AllProviders>
      <AppStack />
      <RailToolbarHost />
      <SafeToast />
    </AllProviders>
  )
}
