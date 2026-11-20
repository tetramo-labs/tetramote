import type {BottomSheetModal} from "@gorhom/bottom-sheet"
import * as NavigationBar from "expo-navigation-bar"
import {StatusBar} from "expo-status-bar"
import {useEffect, useRef, useState, type ReactNode} from "react"
import {BackHandler, Platform, useWindowDimensions, View, type ViewStyle} from "react-native"
import Animated, {useAnimatedStyle, useDerivedValue, withTiming} from "react-native-reanimated"
import {ReservedRegionsProvider, useReservedRegions} from "react-native-reserved-regions"
import {scheduleOnRN} from "react-native-worklets"

import {Text} from "@/components/ignite/Text"
import {ClipboardSheet} from "@/components/session/ClipboardSheet"
import {DisplaySheet} from "@/components/session/DisplaySheet"
import {KeyboardInput, type KeyboardHandle} from "@/components/session/KeyboardInput"
import {DEFAULT_ASPECT, RemoteSurface, useZoomControls} from "@/components/session/RemoteSurface"
import {SessionOverlay} from "@/components/session/SessionOverlay"
import {HingeObserver} from "@/components/session/HingeObserver"
import {BottomRail, ControlsHandle, SessionToolbar, useSessionActions} from "@/components/session/SessionToolbar"
import {StatusPill} from "@/components/session/StatusPill"
import {TrackpadPanel} from "@/components/session/TrackpadPanel"
import GlassView from "@/components/ui/GlassView"
import {useSaferAreaInsets} from "@/contexts/SaferAreaContext"
import {useAppTheme} from "@/contexts/ThemeContext"
import {useAutoHide} from "@/hooks/useAutoHide"
import {useLayout} from "@/hooks/useLayout"
import {disconnect, send} from "@/services/remote"
import {sessionLayout, type Rect} from "@/services/sessionLayout"
import {useNavigationStore} from "@/stores/navigation"
import {useRailActions} from "@/stores/railToolbar"
import {useSessionStore} from "@/stores/session"
import {useSetting} from "@/stores/settings"

const rectStyle = (r: Rect): ViewStyle => ({
  position: "absolute",
  left: r.x,
  top: r.y,
  width: r.width,
  height: r.height,
})

function PermissionBanner() {
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
    <GlassView className="rounded-2xl" style={{backgroundColor: "rgba(46,46,46,0.9)", maxWidth: 420}}>
      <Text tx={tx} size="xs" className="px-3 py-2" style={{color: "#fafafa"}} />
    </GlassView>
  )
}

function Fade({visible, children, style}: {visible: boolean; children: ReactNode; style?: ViewStyle}) {
  const animated = useAnimatedStyle(() => ({opacity: withTiming(visible ? 1 : 0, {duration: visible ? 200 : 300})}))
  return (
    <Animated.View pointerEvents={visible ? "box-none" : "none"} style={[style, animated]}>
      {children}
    </Animated.View>
  )
}

/**
 * The remote session. Built for the iPhone Duo first: a laptop layout (Mac
 * screen over a trackpad, split at the fold when open) whenever the window has
 * room, controls down the status rail when there is one, and the same design
 * widened rather than swapped when the Duo folds or opens. Full screen turns
 * the rail and status bar off, like a video player, and floats the controls.
 */
function SessionBody() {
  const {themeContext} = useAppTheme()
  const [connectionDetails] = useSetting("show_connection_details")
  const {width, height} = useWindowDimensions()
  const insets = useSaferAreaInsets()
  const layout = useLayout()
  const regions = useReservedRegions()
  const goHome = useNavigationStore((s) => s.goHome)
  const video = useSessionStore((s) => s.video)
  const phase = useSessionStore((s) => s.phase)
  const fullScreen = useSessionStore((s) => s.fullScreen)
  const [autoHide] = useSetting("auto_hide_controls")
  const controls = useAutoHide((autoHide || fullScreen) && phase === "connected")
  const zoomControls = useZoomControls()
  const keyboard = useRef<KeyboardHandle>(null)
  const displaySheet = useRef<BottomSheetModal>(null)
  const clipboardSheet = useRef<BottomSheetModal>(null)
  const [zoomed, setZoomed] = useState(false)
  const [halfOpen, setHalfOpen] = useState(false)

  useDerivedValue(() => {
    scheduleOnRN(setZoomed, zoomControls.zoom.value > 1.01)
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

  useEffect(() => {
    if (Platform.OS !== "android") return
    NavigationBar.setVisibilityAsync(fullScreen ? "hidden" : "visible")
    return () => {
      NavigationBar.setVisibilityAsync("visible")
    }
  }, [fullScreen])

  const resetZoom = () => {
    zoomControls.zoom.value = withTiming(1)
    zoomControls.offsetX.value = withTiming(0)
    zoomControls.offsetY.value = withTiming(0)
  }

  const fold = regions.find((r) => r.kind === "division")?.frame ?? null
  const plan = sessionLayout({
    width,
    height,
    insets: {top: insets.top, bottom: insets.bottom, left: layout.insetLeft, right: layout.insetRight},
    rail: layout.rail,
    aspect: video ? video.width / video.height : DEFAULT_ASPECT,
    fold,
    halfOpen,
    fullScreen,
  })
  const laptop = plan.toolbar === "bottomRail"

  const actions = useSessionActions({
    zoomed,
    onUse: controls.show,
    onDisconnect: leave,
    onKeyboard: () => keyboard.current?.toggle(),
    onDisplays: () => displaySheet.current?.present(),
    onClipboard: () => {
      send({t: "getClipboard"})
      clipboardSheet.current?.present()
    },
    onResetZoom: resetZoom,
  })
  useRailActions(plan.toolbar === "rail" ? actions : [], {hidden: !controls.visible, reveal: controls.show})

  const status = (
    <Fade visible={controls.visible} style={{gap: 8, alignItems: "flex-start"}}>
      {connectionDetails && <StatusPill />}
      <PermissionBanner />
    </Fade>
  )
  const inlineToolbar = (vertical: boolean) =>
    controls.visible ? (
      <SessionToolbar actions={actions} vertical={vertical} />
    ) : (
      <ControlsHandle onPress={controls.show} />
    )

  return (
    <View className="flex-1 bg-background">
      <StatusBar
        style={themeContext === "dark" ? "light" : "dark"}
        hidden={fullScreen || laptop || !layout.rail}
        verticalBarBehaviorIOS={fullScreen || laptop ? "disabled" : "automatic"}
      />
      <View style={rectStyle(plan.video)}>
        <RemoteSurface zoomControls={zoomControls} onThreeFingerTap={controls.toggle} />
      </View>

      {plan.kind === "stacked" && plan.trackpad ? (
        <>
          <View pointerEvents="box-none" className="px-3" style={rectStyle(plan.panel)}>
            {status}
          </View>
          <View style={rectStyle(plan.trackpad)}>
            <TrackpadPanel
              bare
              screenWidth={plan.video.width}
              zoomControls={zoomControls}
              onThreeFingerTap={controls.toggle}
            />
          </View>
        </>
      ) : plan.kind === "stacked" ? (
        <View style={rectStyle(plan.panel)}>
          <TrackpadPanel
            screenWidth={plan.video.width}
            zoomControls={zoomControls}
            onThreeFingerTap={controls.toggle}
            header={status}
            footer={
              laptop && controls.visible ? (
                <BottomRail actions={actions} />
              ) : plan.toolbar !== "rail" ? (
                <View className="items-center">{inlineToolbar(false)}</View>
              ) : null
            }
          />
        </View>
      ) : (
        <>
          <View
            pointerEvents="box-none"
            className="absolute"
            style={{top: insets.top + 8, left: layout.insetLeft + 12}}>
            {status}
          </View>
          {plan.toolbar === "side" && (
            <View
              pointerEvents="box-none"
              className="absolute justify-center"
              style={{top: 0, bottom: 0, right: insets.right + 8}}>
              {inlineToolbar(true)}
            </View>
          )}
          {plan.toolbar === "floating" && (
            <View
              pointerEvents="box-none"
              className="absolute items-center"
              style={{left: 0, right: 0, bottom: insets.bottom + 8}}>
              {inlineToolbar(false)}
            </View>
          )}
        </>
      )}

      <HingeObserver onHalfOpenChange={setHalfOpen} />
      <SessionOverlay onBack={leave} />
      <KeyboardInput ref={keyboard} dockTop={laptop ? plan.panel.y : null} />
      <DisplaySheet ref={displaySheet} />
      <ClipboardSheet ref={clipboardSheet} />
    </View>
  )
}

export default function SessionScreen() {
  const {theme} = useAppTheme()
  return (
    <ReservedRegionsProvider style={{flex: 1, backgroundColor: theme.colors.background}}>
      <SessionBody />
    </ReservedRegionsProvider>
  )
}
