import {useVerticalBarEdgeIOS, type VerticalBarEdgeIOS} from "expo-status-bar"
import {createContext, useContext, useMemo, type ReactNode} from "react"
import {I18nManager, Platform} from "react-native"
import {useSafeAreaInsets, type EdgeInsets} from "react-native-safe-area-context"

/**
 * A side inset this wide is the iPhone Duo's vertical status rail (84 pt: the
 * camera strip on the folded display, the status bar on the open display
 * sideways), not a notch. The system lays its toolbars out vertically under it.
 */
export const RAIL_MIN_WIDTH = 60
export const RAIL_WIDTH = 84

export type RailSide = "left" | "right"

const SaferAreaContext = createContext<EdgeInsets>({top: 0, bottom: 0, left: 0, right: 0})
const RailSideContext = createContext<RailSide | null>(null)

export const useSaferAreaInsets = () => useContext(SaferAreaContext)
export const useRailSide = () => useContext(RailSideContext)

export function barSide(edge: VerticalBarEdgeIOS | null, rtl: boolean): RailSide | null {
  if (edge === null) return null
  return (edge === "leading") !== rtl ? "left" : "right"
}

export function resolveRail(insets: EdgeInsets, bar: RailSide | null): {insets: EdgeInsets; rail: RailSide | null} {
  const rail: RailSide | null =
    bar ?? (insets.right >= RAIL_MIN_WIDTH ? "right" : insets.left >= RAIL_MIN_WIDTH ? "left" : null)
  const resolved = bar ? {...insets, [bar]: Math.max(insets[bar], RAIL_WIDTH)} : insets
  return {insets: resolved, rail}
}

export function SaferAreaProvider({children}: {children: ReactNode}) {
  const insets = useSafeAreaInsets()
  const edge = useVerticalBarEdgeIOS()

  const resolved = useMemo(() => {
    if (Platform.OS !== "android") return resolveRail(insets, barSide(edge, I18nManager.isRTL))
    return {
      insets: {...insets, top: insets.top || 16, bottom: insets.bottom || 24},
      rail: null,
    }
  }, [insets, edge])

  return (
    <SaferAreaContext.Provider value={resolved.insets}>
      <RailSideContext.Provider value={resolved.rail}>{children}</RailSideContext.Provider>
    </SaferAreaContext.Provider>
  )
}
