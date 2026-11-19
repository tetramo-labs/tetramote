import {useCallback, useEffect, useRef, useState} from "react"

export const AUTO_HIDE_MS = 3500

/**
 * Controls that fade out `delayMs` after they were last shown or used. While
 * `enabled` is false they stay visible.
 */
export function useAutoHide(enabled: boolean, delayMs = AUTO_HIDE_MS) {
  const [visible, setVisible] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const show = useCallback(() => {
    clear()
    setVisible(true)
    if (enabled) timer.current = setTimeout(() => setVisible(false), delayMs)
  }, [clear, delayMs, enabled])

  const toggle = useCallback(() => {
    if (visible) {
      clear()
      setVisible(!enabled)
    } else {
      show()
    }
  }, [clear, enabled, show, visible])

  useEffect(() => {
    show()
    return clear
  }, [show, clear])

  return {visible, show, toggle}
}
