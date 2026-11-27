import {ChevronDown} from "lucide-react-native"
import {forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentRef, type ReactNode} from "react"
import {Keyboard, Platform, Pressable, ScrollView, TextInput, View} from "react-native"
import {KeyboardStickyView} from "react-native-keyboard-controller"
import {FullWindowOverlay} from "react-native-screens"

import {PressableIcon} from "@/components/ignite/Icon"
import {Text} from "@/components/ignite/Text"
import {useHardwareKeyboardStore, useStickyModifiers} from "@/components/session/useHardwareKeyboard"
import GlassView from "@/components/ui/GlassView"
import {useAppTheme} from "@/contexts/ThemeContext"
import {KEY, keyPress, shortcutFor, type Modifier} from "@/services/keys"
import {sendInput} from "@/services/remote"
import {useSetting} from "@/stores/settings"

export interface KeyboardHandle {
  toggle: () => void
}

type BarKey = {label: string; modifier: Modifier} | {label: string; keyCode: number}

const BAR_KEYS: BarKey[] = [
  {label: "esc", keyCode: KEY.escape},
  {label: "tab", keyCode: KEY.tab},
  {label: "⌘", modifier: "command"},
  {label: "⌥", modifier: "option"},
  {label: "⌃", modifier: "control"},
  {label: "⇧", modifier: "shift"},
  {label: "←", keyCode: KEY.left},
  {label: "↑", keyCode: KEY.up},
  {label: "↓", keyCode: KEY.down},
  {label: "→", keyCode: KEY.right},
  {label: "⌦", keyCode: KEY.forwardDelete},
]

/** On iOS, lifts its children into a window over the app, above the Duo's rail buttons. */
function AboveRail({children}: {children: ReactNode}) {
  return Platform.OS === "ios" ? <FullWindowOverlay>{children}</FullWindowOverlay> : children
}

/**
 * A hidden text field drives the system keyboard: typed text goes to the Mac
 * as text records, and with a modifier held a character becomes a shortcut.
 * Modifiers are one-shot, like sticky keys, and also apply to the next hardware
 * key that goes by position; hiding the row drops them. With a hardware keyboard on iOS,
 * useHardwareKeyboard sends its delete and return keys (and, Raw, every key),
 * so the field leaves those alone. Only Android blurs the field when its keyboard
 * hides: iOS hides it the moment the field focuses with a hardware keyboard attached.
 */
export const KeyboardInput = forwardRef<KeyboardHandle, {dockTop?: number | null}>(function KeyboardInput(
  {dockTop},
  ref,
) {
  const {theme, themeContext} = useAppTheme()
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  const [visible, setVisible] = useState(false)
  const modifiers = useStickyModifiers((st) => st.modifiers)
  const hardware = useHardwareKeyboardStore((st) => st.connected) && Platform.OS === "ios"
  const [hardwareMode] = useSetting("hardware_keyboard")

  useEffect(() => {
    if (Platform.OS !== "android") return
    const hidden = Keyboard.addListener("keyboardDidHide", () => input.current?.blur())
    return () => hidden.remove()
  }, [])

  useImperativeHandle(ref, () => ({
    toggle: () => (input.current?.isFocused() ? input.current.blur() : input.current?.focus()),
  }))

  const consumeModifiers = () => useStickyModifiers.getState().consume()

  const onChangeText = (text: string) => {
    if (!text || (hardware && hardwareMode === "raw")) return
    const {modifiers} = useStickyModifiers.getState()
    if (modifiers.length === 0) {
      sendInput([{kind: "text", text}])
      return
    }
    const events = [...text].flatMap((c) => shortcutFor(c, modifiers) ?? [])
    consumeModifiers()
    sendInput(events.length > 0 ? events : [{kind: "text", text}])
  }

  const pressBarKey = (key: BarKey) => {
    if ("modifier" in key) {
      useStickyModifiers.getState().toggle(key.modifier)
      return
    }
    sendInput(keyPress(key.keyCode, consumeModifiers()))
  }

  const bar = (
    <GlassView className="mx-2 mb-2 rounded-2xl" style={{backgroundColor: theme.colors.primary_foreground + "E6"}}>
      <View className="flex-row items-center">
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-1 px-2 py-2">
          {BAR_KEYS.map((key) => {
            const active = "modifier" in key && modifiers.includes(key.modifier)
            return (
              <Pressable
                key={key.label}
                onPress={() => pressBarKey(key)}
                className="rounded-xl px-3 py-2 min-w-11 items-center"
                style={({pressed}) => ({
                  backgroundColor: active ? theme.colors.secondary_foreground : theme.colors.background,
                  opacity: pressed ? 0.75 : 1,
                })}>
                <Text
                  text={key.label}
                  size="sm"
                  weight="medium"
                  style={{color: active ? theme.colors.background : theme.colors.foreground}}
                />
              </Pressable>
            )
          })}
        </ScrollView>
        <PressableIcon icon={ChevronDown} onPress={() => input.current?.blur()} diameter={40} />
      </View>
    </GlassView>
  )

  return (
    <>
      <TextInput
        ref={input}
        value=""
        onChangeText={onChangeText}
        onKeyPress={({nativeEvent}) => {
          if (nativeEvent.key === "Backspace" && !hardware) sendInput(keyPress(KEY.delete, consumeModifiers()))
        }}
        onSubmitEditing={() => {
          if (!hardware) sendInput(keyPress(KEY.return, consumeModifiers()))
        }}
        submitBehavior="submit"
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        keyboardAppearance={themeContext}
        onFocus={() => setVisible(true)}
        onBlur={() => {
          setVisible(false)
          consumeModifiers()
        }}
        style={{position: "absolute", width: 1, height: 1, opacity: 0, left: -10}}
      />
      {visible && (
        <AboveRail>
          {dockTop != null ? (
            <View className="absolute left-0 right-0" style={{top: dockTop}}>
              {bar}
            </View>
          ) : (
            <KeyboardStickyView style={{position: "absolute", left: 0, right: 0, bottom: 0}}>{bar}</KeyboardStickyView>
          )}
        </AboveRail>
      )}
    </>
  )
})
