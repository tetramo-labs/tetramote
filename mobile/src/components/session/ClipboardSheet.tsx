import type {BottomSheetModal} from "@gorhom/bottom-sheet"
import * as Clipboard from "expo-clipboard"
import {forwardRef} from "react"
import {View} from "react-native"
import Toast from "react-native-toast-message"

import {Button} from "@/components/ignite/Button"
import {Text} from "@/components/ignite/Text"
import {Sheet} from "@/components/session/Sheet"
import {useAppTheme} from "@/contexts/ThemeContext"
import {translate} from "@/i18n"
import {send} from "@/services/remote"
import {useSessionStore} from "@/stores/session"

export const ClipboardSheet = forwardRef<BottomSheetModal>(function ClipboardSheet(_props, ref) {
  const {theme} = useAppTheme()
  const macClipboard = useSessionStore((s) => s.macClipboard)

  const sendToMac = async () => {
    const text = await Clipboard.getStringAsync()
    if (!text) return
    send({t: "clipboard", text})
    Toast.show({type: "success", text1: translate("session:sentClipboard"), visibilityTime: 1500})
  }

  const copyFromMac = async () => {
    if (macClipboard === null) {
      send({t: "getClipboard"})
      return
    }
    await Clipboard.setStringAsync(macClipboard)
    Toast.show({type: "success", text1: translate("session:copiedClipboard"), visibilityTime: 1500})
  }

  return (
    <Sheet ref={ref}>
      <Text tx="session:clipboardTitle" preset="subheading" className="text-foreground" />
      <View className="rounded-2xl px-4 py-3 gap-1" style={{backgroundColor: theme.colors.primary_foreground}}>
        <Text tx="session:macClipboard" size="xs" className="text-muted-foreground" />
        <Text
          tx={macClipboard === null ? "session:clipboardEmpty" : undefined}
          text={macClipboard ?? undefined}
          size="sm"
          numberOfLines={4}
          className="text-foreground"
        />
      </View>
      <Button tx="session:fetchClipboard" preset="secondary" onPress={copyFromMac} />
      <Button tx="session:sendClipboard" onPress={sendToMac} />
    </Sheet>
  )
})
