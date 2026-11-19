import {remote} from "@tetratop/remote"
import * as Clipboard from "expo-clipboard"
import * as Device from "expo-device"
import {useEffect, useState} from "react"
import {Alert, TextInput, View, type ViewStyle} from "react-native"
import Toast from "react-native-toast-message"

import {Button} from "@/components/ignite/Button"
import {Header} from "@/components/ignite/Header"
import {Screen} from "@/components/ignite/Screen"
import {Text} from "@/components/ignite/Text"
import {Group} from "@/components/ui/Group"
import {Row, ToggleRow} from "@/components/ui/Rows"
import {Segmented} from "@/components/ui/Segmented"
import {useAppTheme} from "@/contexts/ThemeContext"
import {translate} from "@/i18n"
import {loadSecretKey} from "@/services/identity"
import {isRelayUrl} from "@/services/relay"
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
  const [playAudio, setPlayAudio] = useSetting("play_audio")
  const [autoHide, setAutoHide] = useSetting("auto_hide_controls")
  const [startFullScreen, setStartFullScreen] = useSetting("start_full_screen")
  const [deviceName, setDeviceName] = useSetting("device_name")
  const forgetAll = useHostsStore((s) => s.forgetAll)
  const [relayDraft, setRelayDraft] = useState(relay)
  const [endpointId, setEndpointId] = useState<string | null>(null)

  useEffect(() => {
    loadSecretKey()
      .then((key) => setEndpointId(remote.endpointId(key)))
      .catch(() => setEndpointId(null))
  }, [])

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
        <ToggleRow
          labelTx="settings:startFullScreen"
          subtitleTx="settings:startFullScreenHint"
          value={startFullScreen}
          onValueChange={setStartFullScreen}
        />
        <ToggleRow
          labelTx="settings:autoHide"
          subtitleTx="settings:autoHideHint"
          value={autoHide}
          onValueChange={setAutoHide}
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
        <Row
          labelTx="settings:phoneId"
          subtitle={endpointId ?? undefined}
          onPress={() => {
            if (!endpointId) return
            Clipboard.setStringAsync(endpointId)
            Toast.show({type: "success", text1: translate("common:copied"), visibilityTime: 1200})
          }}
        />
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
      <Text tx="settings:relayHint" size="xs" className="text-muted-foreground px-4 mt-2" />
      {relayDraft.trim() !== relay && (
        <Button tx="common:save" compact style={{alignSelf: "flex-start", marginTop: 8}} onPress={saveRelay} />
      )}
    </Screen>
  )
}
