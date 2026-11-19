import {BottomSheetModalProvider} from "@gorhom/bottom-sheet"
import type {ReactNode} from "react"
import {GestureHandlerRootView} from "react-native-gesture-handler"
import {KeyboardProvider} from "react-native-keyboard-controller"
import {SafeAreaProvider} from "react-native-safe-area-context"

import {SaferAreaProvider} from "@/contexts/SaferAreaContext"
import {ThemeProvider} from "@/contexts/ThemeContext"

export function AllProviders({children}: {children: ReactNode}) {
  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SaferAreaProvider>
            <KeyboardProvider>
              <BottomSheetModalProvider>{children}</BottomSheetModalProvider>
            </KeyboardProvider>
          </SaferAreaProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
