import {useEffect, useRef, type ComponentRef} from "react"
import {Platform, TextInput} from "react-native"

import {useHardwareKeyboardStore} from "@/components/session/useHardwareKeyboard"
import {sendInput} from "@/services/remote"
import {useSetting} from "@/stores/settings"

const REFOCUS_MS = 300

/**
 * On iOS with a hardware keyboard set to Translated, a hidden field that stays
 * focused so the phone's keyboard layout types the characters, which go to the
 * computer as text. Other fields (the on-screen keyboard's) take over while focused.
 */
export function HardwareTextInput() {
  const connected = useHardwareKeyboardStore((s) => s.connected)
  const [mode] = useSetting("hardware_keyboard")
  const active = Platform.OS === "ios" && connected && mode === "translated"
  const input = useRef<ComponentRef<typeof TextInput>>(null)

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      if (!TextInput.State.currentlyFocusedInput()) input.current?.focus()
    }, REFOCUS_MS)
    input.current?.focus()
    return () => clearInterval(timer)
  }, [active])

  if (!active) return null
  return (
    <TextInput
      ref={input}
      value=""
      onChangeText={(text) => {
        if (text) sendInput([{kind: "text", text}])
      }}
      autoCorrect={false}
      autoCapitalize="none"
      autoComplete="off"
      spellCheck={false}
      showSoftInputOnFocus={false}
      style={{position: "absolute", width: 1, height: 1, opacity: 0, left: -10}}
    />
  )
}
