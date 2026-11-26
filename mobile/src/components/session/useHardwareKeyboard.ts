import {remote} from "@tetramote/remote"
import {useEffect, useRef} from "react"
import {create} from "zustand"

import {HardwareKeys} from "@/services/hardwareKeys"
import {sendInput} from "@/services/remote"
import {useSetting} from "@/stores/settings"

const REPEAT_AFTER_MS = 400
const REPEAT_EVERY_MS = 40

export const useHardwareKeyboardStore = create<{connected: boolean}>()(() => ({connected: false}))

/**
 * Sends a hardware keyboard's keys to the computer for the whole session, by position (Raw) or through the
 * phone's layout (Translated). The GameController keyboard on iOS reports only presses and releases, so held
 * keys repeat here, like a local keyboard; Android repeats on its own.
 */
export function useHardwareKeyboard() {
  const [mode] = useSetting("hardware_keyboard")
  const modeRef = useRef(mode)
  modeRef.current = mode

  useEffect(() => {
    const keys = new HardwareKeys()
    let repeating: {usage: number | undefined; timer: ReturnType<typeof setTimeout>} | null = null
    const stopRepeat = () => {
      if (repeating) clearTimeout(repeating.timer)
      repeating = null
    }
    const keySub = remote.addListener("onKey", (event) => {
      const action = keys.handle(event, modeRef.current)
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
      }
    })
    remote.setHardwareKeyboard(true)
    return () => {
      remote.setHardwareKeyboard(false)
      stopRepeat()
      keySub.remove()
      boardSub.remove()
      useHardwareKeyboardStore.setState({connected: false})
    }
  }, [])
}
