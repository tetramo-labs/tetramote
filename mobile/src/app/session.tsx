import type {BottomSheetModal} from "@gorhom/bottom-sheet"
import {StatusBar} from "expo-status-bar"
import {useEffect, useRef, useState} from "react"
import {BackHandler, View} from "react-native"
import {useDerivedValue, withTiming} from "react-native-reanimated"
import {scheduleOnRN} from "react-native-worklets"

import {Text} from "@/components/ignite/Text"
import {ClipboardSheet} from "@/components/session/ClipboardSheet"
import {DisplaySheet} from "@/components/session/DisplaySheet"
import {KeyboardInput, type KeyboardHandle} from "@/components/session/KeyboardInput"
import {RemoteSurface, useZoomControls} from "@/components/session/RemoteSurface"
import {SessionOverlay} from "@/components/session/SessionOverlay"
import {SessionToolbar} from "@/components/session/SessionToolbar"
import {StatusPill} from "@/components/session/StatusPill"
import GlassView from "@/components/ui/GlassView"
import {useAppTheme} from "@/contexts/ThemeContext"
import {useSaferAreaInsets} from "@/contexts/SaferAreaContext"
import {useLayout} from "@/hooks/useLayout"
import {disconnect, send} from "@/services/remote"
import {useNavigationStore} from "@/stores/navigation"
import {useSessionStore} from "@/stores/session"

function PermissionBanner() {
  const {theme} = useAppTheme()
  const screenRecording = useSessionStore((s) => s.screenRecording)
  const accessibility = useSessionStore((s) => s.accessibility)
  const tx =
    screenRecording === false
      ? "session:needsScreenRecording"
      : accessibility === false
        ? "session:needsAccessibility"
        : null
  if (!tx) return null
  return (
    <GlassView className="rounded-2xl" style={{backgroundColor: theme.colors.primary_foreground + "E6", maxWidth: 420}}>
      <Text tx={tx} size="xs" className="text-foreground px-3 py-2" />
    </GlassView>
  )
}

export default function SessionScreen() {
  const insets = useSaferAreaInsets()
  const layout = useLayout()
  const goHome = useNavigationStore((s) => s.goHome)
  const zoomControls = useZoomControls()
  const keyboard = useRef<KeyboardHandle>(null)
  const displaySheet = useRef<BottomSheetModal>(null)
  const clipboardSheet = useRef<BottomSheetModal>(null)
  const [zoomed, setZoomed] = useState(false)

  useDerivedValue(() => {
    const isZoomed = zoomControls.zoom.value > 1.01
    scheduleOnRN(setZoomed, isZoomed)
  })

  const leave = () => {
    disconnect()
    goHome()
  }

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      leave()
      return true
    })
    return () => sub.remove()
  })

  useEffect(() => () => disconnect(), [])

  const resetZoom = () => {
    zoomControls.zoom.value = withTiming(1)
    zoomControls.offsetX.value = withTiming(0)
    zoomControls.offsetY.value = withTiming(0)
  }

  const vertical = layout.landscape && layout.width / layout.height > 1.75
  const railRight = layout.rail === "right"
  const toolbarPosition = vertical
    ? {
        top: 0,
        bottom: 0,
        justifyContent: "center" as const,
        ...(railRight ? {left: insets.left + 8} : {right: insets.right + 8}),
      }
    : {left: 0, right: 0, bottom: insets.bottom + 8, alignItems: "center" as const}

  return (
    <View className="flex-1 bg-black">
      <StatusBar hidden />
      <View className="flex-1" style={{marginLeft: layout.insetLeft, marginRight: layout.insetRight}}>
        <RemoteSurface zoomControls={zoomControls} />
      </View>
      <View
        pointerEvents="box-none"
        className="absolute gap-2"
        style={{top: insets.top + 8, left: layout.insetLeft + 12}}>
        <StatusPill />
        <PermissionBanner />
      </View>
      <View pointerEvents="box-none" className="absolute" style={toolbarPosition}>
        <SessionToolbar
          vertical={vertical}
          zoomed={zoomed}
          onDisconnect={leave}
          onKeyboard={() => keyboard.current?.open()}
          onDisplays={() => displaySheet.current?.present()}
          onClipboard={() => {
            send({t: "getClipboard"})
            clipboardSheet.current?.present()
          }}
          onResetZoom={resetZoom}
        />
      </View>
      <SessionOverlay onBack={leave} />
      <KeyboardInput ref={keyboard} />
      <DisplaySheet ref={displaySheet} />
      <ClipboardSheet ref={clipboardSheet} />
    </View>
  )
}
