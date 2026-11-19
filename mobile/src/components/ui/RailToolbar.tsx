import {BottomSheetModal} from "@gorhom/bottom-sheet"
import {Ellipsis, MoreVertical} from "lucide-react-native"
import {useRef, type RefObject} from "react"
import {Pressable, View} from "react-native"
import {ReservedRegionsProvider, useReservedRegions} from "react-native-reserved-regions"
import Animated, {FadeIn, FadeOut} from "react-native-reanimated"

import {Icon, PressableIcon} from "@/components/ignite/Icon"
import {Text} from "@/components/ignite/Text"
import {Sheet} from "@/components/session/Sheet"
import {useSaferAreaInsets} from "@/contexts/SaferAreaContext"
import {translate} from "@/i18n"
import {useLayout, type Layout} from "@/hooks/useLayout"
import {railCapacity, splitRailActions, RAIL_BUTTON, RAIL_CENTER, RAIL_GAP} from "@/services/railLayout"
import {useRailToolbarStore, type RailAction} from "@/stores/railToolbar"

/** What the system reserves at the top of the rail when regions can't be read: folded 174, open 124. */
const RESERVED_FOLDED = 174
const RESERVED_OPEN = 124
const OPEN_WIDTH = 800

function firstSlotTop(layout: Layout, regions: ReturnType<typeof useReservedRegions>): number {
  const fallback = layout.width >= OPEN_WIDTH ? RESERVED_OPEN : RESERVED_FOLDED
  const inRail = (x: number, w: number) =>
    layout.rail === "right" ? x >= layout.width - layout.insetRight - 1 : x + w <= layout.insetLeft + 1
  const occluded = regions
    .filter((r) => r.kind === "occlusion" && inRail(r.frame.x, r.frame.width))
    .reduce((bottom, r) => Math.max(bottom, r.frame.y + r.frame.height + RAIL_GAP), 0)
  return Math.max(fallback, occluded)
}

function OverflowSheet({sheet, actions}: {sheet: RefObject<BottomSheetModal | null>; actions: RailAction[]}) {
  return (
    <Sheet ref={sheet}>
      {actions.map((a) => (
        <Pressable
          key={a.key}
          accessibilityRole="button"
          onPress={() => {
            sheet.current?.dismiss()
            a.onPress()
          }}
          className="flex-row items-center gap-3 rounded-2xl px-4 py-3 bg-primary-foreground">
          <Icon icon={a.icon} size={20} />
          <Text text={a.label} size="sm" className="text-foreground" />
        </Pressable>
      ))}
    </Sheet>
  )
}

function RailButtons({layout, bottomInset}: {layout: Layout; bottomInset: number}) {
  const regions = useReservedRegions()
  const sheet = useRef<BottomSheetModal>(null)
  const entry = useRailToolbarStore((s) => s.entries[s.entries.length - 1] ?? null)
  if (!layout.rail || !entry || entry.actions.length === 0) return null
  const side = {[layout.rail]: RAIL_CENTER - RAIL_BUTTON / 2}
  const top = firstSlotTop(layout, regions)
  const {shown, overflow} = splitRailActions(entry.actions, railCapacity(layout.height, top, bottomInset))
  const more: RailAction = {
    key: "more",
    icon: MoreVertical,
    label: translate("common:more"),
    onPress: () => sheet.current?.present(),
  }
  const buttons: RailAction[] = entry.hidden
    ? [{key: "reveal", icon: Ellipsis, label: translate("session:showControls"), onPress: () => entry.reveal?.()}]
    : overflow.length > 0
      ? [...shown, more]
      : shown
  return (
    <Animated.View
      key={entry.hidden ? "hidden" : "shown"}
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      pointerEvents="box-none"
      className="absolute"
      style={{top, gap: RAIL_GAP, opacity: entry.hidden ? 0.6 : 1, ...side}}>
      {buttons.map((a) => (
        <PressableIcon
          key={a.key}
          icon={a.icon}
          glass
          active={a.active}
          diameter={RAIL_BUTTON}
          onPress={a.onPress}
          accessibilityLabel={a.label}
        />
      ))}
      <OverflowSheet sheet={sheet} actions={overflow} />
    </Animated.View>
  )
}

/**
 * Draws the current screen's rail buttons down the iPhone Duo's status rail,
 * under what the system reserves there (status bar, Dynamic Island, a Live
 * Activity). Rendered once, above the navigation stack.
 */
export function RailToolbarHost() {
  const layout = useLayout()
  const {bottom} = useSaferAreaInsets()
  if (!layout.rail) return null
  return (
    <View pointerEvents="box-none" className="absolute inset-0">
      <ReservedRegionsProvider pointerEvents="box-none" style={{flex: 1}}>
        <RailButtons layout={layout} bottomInset={bottom} />
      </ReservedRegionsProvider>
    </View>
  )
}
