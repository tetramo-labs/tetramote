import type {BottomSheetModal} from "@gorhom/bottom-sheet"
import * as NavigationBar from "expo-navigation-bar"
import {useFocusEffect} from "expo-router"
import {StatusBar} from "expo-status-bar"
import {useCallback, useEffect, useRef, useState, type ReactNode} from "react"
import {BackHandler, Platform, Pressable, useWindowDimensions, View, type ViewStyle} from "react-native"
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
import {CornerHandle} from "@/components/session/CornerHandle"
import {BottomRail, ControlsHandle, SessionToolbar, useSessionActions} from "@/components/session/SessionToolbar"
import {StatusPill} from "@/components/session/StatusPill"
import {StreamSheet} from "@/components/session/StreamSheet"
import {TrackpadPanel} from "@/components/session/TrackpadPanel"
import GlassView from "@/components/ui/GlassView"
import {useSaferAreaInsets} from "@/contexts/SaferAreaContext"
import {useAppTheme} from "@/contexts/ThemeContext"
import {translate} from "@/i18n"
import {useAutoHide} from "@/hooks/useAutoHide"
import {useLayout} from "@/hooks/useLayout"
import {disconnect, send} from "@/services/remote"
import {FLOATING_TOOLBAR_SPACE, sessionLayout, type Rect} from "@/services/sessionLayout"
import {useNavigationStore} from "@/stores/navigation"
import {useRailActions} from "@/stores/railToolbar"
import {useSessionStore} from "@/stores/session"
import {useSetting} from "@/stores/settings"

const STATUS_GAP_MIN = 32

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
  const push = useNavigationStore((s) => s.push)
  const video = useSessionStore((s) => s.video)
  const phase = useSessionStore((s) => s.phase)
  const fullScreen = useSessionStore((s) => s.fullScreen)
  const [autoHide] = useSetting("auto_hide_controls")
  const zoomControls = useZoomControls()
  const keyboard = useRef<KeyboardHandle>(null)
  const displaySheet = useRef<BottomSheetModal>(null)
  const clipboardSheet = useRef<BottomSheetModal>(null)
  const streamSheet = useRef<BottomSheetModal>(null)
  const [zoomed, setZoomed] = useState(false)
  const [halfOpen, setHalfOpen] = useState(false)
  const [revealDots, setRevealDots] = useState(0)

  useDerivedValue(() => {
    scheduleOnRN(setZoomed, zoomControls.zoom.value > 1.01)
  })

  const leave = () => {
    disconnect()
    goHome()
  }

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        disconnect()
        goHome()
        return true
      })
      return () => sub.remove()
    }, [goHome]),
  )

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
  const roomBelow = height - insets.bottom - (plan.video.y + plan.video.height)
  const overScreen = plan.toolbar === "floating" && roomBelow < FLOATING_TOOLBAR_SPACE
  const controls = useAutoHide((autoHide || fullScreen) && overScreen && phase === "connected")

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
    onSettings: () => push("/settings"),
  })
  useRailActions(plan.toolbar === "rail" ? actions : [])

  const status = (centered: boolean) => (
    <Fade visible={controls.visible} style={{gap: 8, alignItems: centered ? "center" : "flex-start"}}>
      {connectionDetails && <StatusPill onPress={() => streamSheet.current?.present()} />}
      <PermissionBanner />
    </Fade>
  )
  const statusGap = plan.gap && plan.gap.height >= STATUS_GAP_MIN ? plan.gap : null
  const inlineToolbar = (vertical: boolean) =>
    controls.visible ? (
      <SessionToolbar actions={actions} vertical={vertical} />
    ) : fullScreen ? null : (
      <ControlsHandle onPress={controls.show} />
    )

  return (
    <View className="flex-1 bg-background">
      <StatusBar
        style={themeContext === "dark" ? "light" : "dark"}
        hidden={fullScreen || laptop || !layout.rail}
        verticalBarBehaviorIOS={fullScreen || laptop ? "disabled" : "automatic"}
      />
      {fullScreen && !controls.visible && (
        <Pressable
          className="absolute inset-0"
          accessibilityLabel={translate("session:showControls")}
          onPress={() => setRevealDots((n) => n + 1)}
        />
      )}
      <View style={rectStyle(plan.video)}>
        <RemoteSurface zoomControls={zoomControls} onThreeFingerTap={controls.toggle} />
      </View>

      {plan.kind === "stacked" && plan.trackpad ? (
        <>
          {!statusGap && (
            <View pointerEvents="box-none" className="px-3" style={rectStyle(plan.panel)}>
              {status(false)}
            </View>
          )}
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
            aspect={plan.trackpadAspect}
            headerSpace={connectionDetails ? STATUS_GAP_MIN : 0}
            screenWidth={plan.video.width}
            zoomControls={zoomControls}
            onThreeFingerTap={controls.toggle}
            header={statusGap ? undefined : status(plan.trackpadAspect !== undefined)}
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
          {fullScreen ? (
            <View
              pointerEvents="box-none"
              className="absolute"
              style={{
                bottom: insets.bottom + 12 + (plan.toolbar === "floating" ? FLOATING_TOOLBAR_SPACE : 0),
                left: insets.left + 12,
              }}>
              {status(false)}
            </View>
          ) : (
            !statusGap && (
              <View
                pointerEvents="box-none"
                className="absolute"
                style={{top: insets.top + 8, left: layout.insetLeft + 12}}>
                {status(false)}
              </View>
            )
          )}
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
          {fullScreen && !controls.visible && (
            <CornerHandle
              origin={plan.toolbar === "side" ? "right" : "bottom"}
              reveal={revealDots}
              onOpen={controls.show}
            />
          )}
        </>
      )}

      {statusGap && (
        <View pointerEvents="box-none" className="items-center justify-center" style={rectStyle(statusGap)}>
          {status(true)}
        </View>
      )}

      <HingeObserver onHalfOpenChange={setHalfOpen} />
      <SessionOverlay onBack={leave} />
      <KeyboardInput ref={keyboard} dockTop={laptop ? plan.panel.y : null} />
      <DisplaySheet ref={displaySheet} />
      <ClipboardSheet ref={clipboardSheet} />
      <StreamSheet ref={streamSheet} />
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
