import * as Device from "expo-device"
import {useState} from "react"
import {Alert, TextInput, View, type ViewStyle} from "react-native"
import Toast from "react-native-toast-message"

import {Button} from "@/components/ignite/Button"
import {Header} from "@/components/ignite/Header"
import {Screen} from "@/components/ignite/Screen"
import {Text} from "@/components/ignite/Text"
import {useStreamRows} from "@/components/settings/useStreamRows"
import {Group} from "@/components/ui/Group"
import {Row, ToggleRow} from "@/components/ui/Rows"
import {Segmented} from "@/components/ui/Segmented"
import {useAppTheme} from "@/contexts/ThemeContext"
import {translate} from "@/i18n"
import {isRelayUrl} from "@/services/relay"
import {pickLinks, shareLinks} from "@/services/linkTransfer"
import {restart} from "@/services/remote"
import {useHostsStore} from "@/stores/hosts"
import {useSetting} from "@/stores/settings"

function FieldRow({
  label,
  value,
  onChangeText,
  placeholder,
  onSubmit,
  style,
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
  placeholder?: string
  onSubmit?: () => void
  style?: ViewStyle
}) {
  const {theme} = useAppTheme()
  return (
    <View className="px-4 py-3 gap-1" style={[{backgroundColor: theme.colors.primary_foreground}, style]}>
      <Text text={label} size="xs" className="text-muted-foreground" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.muted_foreground}
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={onSubmit}
        style={{color: theme.colors.foreground, fontSize: 16, paddingVertical: 4}}
      />
    </View>
  )
}

export default function SettingsScreen() {
  const [theme, setTheme] = useSetting("theme_preference")
  const [relay, setRelay] = useSetting("relay_url")
  const [inputMode, setInputMode] = useSetting("default_input_mode")
  const [speed, setSpeed] = useSetting("trackpad_speed")
  const streamRows = useStreamRows()
  const [playAudio, setPlayAudio] = useSetting("play_audio")
  const [autoHide, setAutoHide] = useSetting("auto_hide_controls")
  const [startFullScreen, setStartFullScreen] = useSetting("start_full_screen")
  const [connectionDetails, setConnectionDetails] = useSetting("show_connection_details")
  const [deviceName, setDeviceName] = useSetting("device_name")
  const forgetAll = useHostsStore((s) => s.forgetAll)
  const importCodes = useHostsStore((s) => s.importCodes)

  const exportLinks = async () => {
    try {
      const shared = await shareLinks(useHostsStore.getState().hosts, translate("settings:exportLinksTitle"))
      if (!shared) Toast.show({type: "info", text1: translate("settings:exportNone")})
    } catch {
      Toast.show({type: "error", text1: translate("settings:linksFailed")})
    }
  }

  const importLinks = async () => {
    try {
      const codes = await pickLinks()
      if (!codes) return
      if (codes.length === 0) {
        Toast.show({type: "error", text1: translate("settings:importNone")})
        return
      }
      importCodes(codes)
      Toast.show({
        type: "success",
        text1:
          codes.length === 1
            ? translate("settings:importedOne")
            : translate("settings:imported", {count: codes.length}),
      })
    } catch {
      Toast.show({type: "error", text1: translate("settings:linksFailed")})
    }
  }
  const [relayDraft, setRelayDraft] = useState(relay)

  const saveRelay = async () => {
    const value = relayDraft.trim()
    if (!isRelayUrl(value)) {
      Toast.show({type: "error", text1: translate("settings:relayInvalid")})
      return
    }
    setRelay(value)
    await restart().catch(() => undefined)
    Toast.show({type: "success", text1: translate("settings:relaySaved")})
  }

  const confirmForgetAll = () =>
    Alert.alert(translate("settings:forgetAll"), translate("settings:forgetAllMessage"), [
      {text: translate("common:cancel"), style: "cancel"},
      {text: translate("common:remove"), style: "destructive", onPress: forgetAll},
    ])

  return (
    <Screen preset="scroll" header={<Header titleTx="settings:title" back />}>
      <Group titleTx="settings:control">
        <Row
          labelTx="settings:defaultInput"
          trailing={
            <Segmented
              value={inputMode}
              onChange={setInputMode}
              options={[
                {value: "trackpad", tx: "session:trackpad"},
                {value: "direct", tx: "session:direct_touch"},
              ]}
            />
          }
        />
        <Row
          labelTx="settings:trackpadSpeed"
          trailing={
            <Segmented
              value={speed}
              onChange={setSpeed}
              options={[
                {value: "slow", tx: "settings:slow"},
                {value: "normal", tx: "settings:normal"},
                {value: "fast", tx: "settings:fast"},
              ]}
            />
          }
        />
        {streamRows}
        <ToggleRow labelTx="settings:startFullScreen" value={startFullScreen} onValueChange={setStartFullScreen} />
        <ToggleRow
          labelTx="settings:autoHide"
          subtitleTx="settings:autoHideHint"
          value={autoHide}
          onValueChange={setAutoHide}
        />
        <ToggleRow
          labelTx="settings:connectionDetails"
          value={connectionDetails}
          onValueChange={setConnectionDetails}
        />
        <ToggleRow labelTx="settings:playAudio" value={playAudio} onValueChange={setPlayAudio} />
      </Group>

      <Group titleTx="settings:appearance">
        <Row
          labelTx="settings:appearance"
          trailing={
            <Segmented
              value={theme}
              onChange={setTheme}
              options={[
                {value: "system", tx: "settings:system"},
                {value: "light", tx: "settings:light"},
                {value: "dark", tx: "settings:dark"},
              ]}
            />
          }
        />
      </Group>

      <Group titleTx="settings:phone">
        <FieldRow
          label={translate("settings:phoneName")}
          value={deviceName}
          onChangeText={setDeviceName}
          placeholder={Device.deviceName ?? Device.modelName ?? undefined}
        />
      </Group>

      <Group titleTx="settings:computers">
        <Row labelTx="settings:exportLinks" onPress={exportLinks} />
        <Row labelTx="settings:importLinks" onPress={importLinks} />
        <Row labelTx="settings:forgetAll" destructive onPress={confirmForgetAll} />
      </Group>

      <Group titleTx="settings:connection">
        <FieldRow
          label={translate("settings:relay")}
          value={relayDraft}
          onChangeText={setRelayDraft}
          placeholder={translate("settings:relayPlaceholder")}
          onSubmit={saveRelay}
        />
      </Group>
      {relayDraft.trim() !== relay && (
        <Button tx="common:save" compact style={{alignSelf: "flex-start", marginTop: 8}} onPress={saveRelay} />
      )}
    </Screen>
  )
}
