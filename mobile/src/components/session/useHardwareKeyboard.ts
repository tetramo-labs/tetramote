import {remote} from "@tetramote/remote"
import {useEffect, useRef} from "react"
import {create} from "zustand"

import {HardwareKeys} from "@/services/hardwareKeys"
import {flagsFor, type Modifier} from "@/services/keys"
import {sendInput} from "@/services/remote"
import {useSetting} from "@/stores/settings"

const REPEAT_AFTER_MS = 400
const REPEAT_EVERY_MS = 40

export const useHardwareKeyboardStore = create<{connected: boolean}>()(() => ({connected: false}))

/** The key row's one-shot modifiers, shared so a hardware key that goes by position takes them too. */
export const useStickyModifiers = create<{
  modifiers: Modifier[]
  toggle: (modifier: Modifier) => void
  consume: () => number
}>()((set, get) => ({
  modifiers: [],
  toggle: (modifier) =>
    set(({modifiers}) => ({
      modifiers: modifiers.includes(modifier) ? modifiers.filter((m) => m !== modifier) : [...modifiers, modifier],
    })),
  consume: () => {
    const flags = flagsFor(get().modifiers)
    set({modifiers: []})
    return flags
  },
}))

/**
 * Sends a hardware keyboard's keys to the computer for the whole session, by position (Raw) or through the
 * phone's layout (Translated). The GameController keyboard on iOS reports only presses and releases, so held
 * keys repeat here, like a local keyboard; Android repeats on its own. A key that goes by position consumes the
 * key row's modifiers on its press and keeps them through its repeats and release.
 */
export function useHardwareKeyboard() {
  const [mode] = useSetting("hardware_keyboard")
  const modeRef = useRef(mode)
  modeRef.current = mode

  useEffect(() => {
    const keys = new HardwareKeys()
    const pressedSticky = new Map<number, number>()
    let repeating: {usage: number | undefined; timer: ReturnType<typeof setTimeout>} | null = null
    const stopRepeat = () => {
      if (repeating) clearTimeout(repeating.timer)
      repeating = null
    }
    const keySub = remote.addListener("onKey", (event) => {
      const id = event.usage ?? event.code
      const pressed = id === undefined ? undefined : pressedSticky.get(id)
      const armed = event.down ? flagsFor(useStickyModifiers.getState().modifiers) : 0
      const action = keys.handle(event, modeRef.current, pressed ?? armed)
      if (id !== undefined && !event.down) pressedSticky.delete(id)
      if (id !== undefined && pressed === undefined && "send" in action && action.repeat) {
        pressedSticky.set(id, useStickyModifiers.getState().consume())
      }
      if ("type" in action) {
        sendInput([{kind: "text", text: action.type}])
        return
      }
      if ("ignore" in action) return
      if (event.usage !== undefined && (!event.down || repeating?.usage === event.usage)) stopRepeat()
      sendInput(action.send)
      if (event.usage === undefined || !action.repeat) return
      stopRepeat()
      const again = () => {
        sendInput(action.send)
        if (repeating) repeating.timer = setTimeout(again, REPEAT_EVERY_MS)
      }
      repeating = {usage: event.usage, timer: setTimeout(again, REPEAT_AFTER_MS)}
    })
    const boardSub = remote.addListener("onKeyboard", ({connected}) => {
      useHardwareKeyboardStore.setState({connected})
      if (!connected) {
        stopRepeat()
        keys.release()
        pressedSticky.clear()
      }
    })
    remote.setHardwareKeyboard(true)
    return () => {
      remote.setHardwareKeyboard(false)
      stopRepeat()
      keySub.remove()
      boardSub.remove()
      useHardwareKeyboardStore.setState({connected: false})
      useStickyModifiers.setState({modifiers: []})
    }
  }, [])
}
