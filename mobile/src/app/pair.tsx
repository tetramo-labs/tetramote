import {CameraView, useCameraPermissions, type BarcodeScanningResult} from "expo-camera"
import {useLocalSearchParams} from "expo-router"
import {X} from "lucide-react-native"
import {useEffect, useRef} from "react"
import {Linking, View} from "react-native"
import Toast from "react-native-toast-message"

import {Button} from "@/components/ignite/Button"
import {PressableIcon} from "@/components/ignite/Icon"
import {Text} from "@/components/ignite/Text"
import {useSaferAreaInsets} from "@/contexts/SaferAreaContext"
import {useLayout} from "@/hooks/useLayout"
import {translate} from "@/i18n"
import {pairingFromParams, parsePairingUrl, type PairingCode} from "@/services/pairingUrl"
import {pair} from "@/services/remote"
import {useNavigationStore} from "@/stores/navigation"
import {useRailActions} from "@/stores/railToolbar"

const FRAME = 260

export default function PairScreen() {
  const params = useLocalSearchParams<{id?: string; secret?: string; name?: string}>()
  const [permission, requestPermission] = useCameraPermissions()
  const insets = useSaferAreaInsets()
  const {replace, goBack} = useNavigationStore.getState()
  const handled = useRef(false)
  const {rail, insetLeft} = useLayout()
  useRailActions(rail ? [{key: "close", icon: X, label: translate("common:close"), onPress: goBack}] : null)

  const start = (code: PairingCode) => {
    if (handled.current) return
    handled.current = true
    pair(code)
    replace("/session")
  }

  useEffect(() => {
    const fromLink = pairingFromParams(params)
    if (fromLink) start(fromLink)
  })

  const onScan = ({data}: BarcodeScanningResult) => {
    if (handled.current) return
    const code = parsePairingUrl(data)
    if (code) start(code)
    else Toast.show({type: "error", text1: translate("pair:notACode"), visibilityTime: 1500})
  }

  const granted = permission?.granted === true

  return (
    <View className="flex-1 bg-black">
      {granted && (
        <CameraView
          style={{flex: 1}}
          facing="back"
          barcodeScannerSettings={{barcodeTypes: ["qr"]}}
          onBarcodeScanned={onScan}
        />
      )}
      <View pointerEvents="box-none" className="absolute inset-0 items-center justify-center">
        <View
          pointerEvents="none"
          style={{width: FRAME, height: FRAME, borderRadius: 32, borderWidth: 3, borderColor: "rgba(255,255,255,0.9)"}}
        />
        <View className="absolute left-0 right-0 items-center px-8" style={{bottom: insets.bottom + 48}}>
          {granted ? (
            <Text tx="pair:hint" size="md" className="text-center" style={{color: "#ffffff"}} />
          ) : (
            <View className="items-center gap-3 w-full">
              <Text tx="pair:cameraTitle" preset="subheading" style={{color: "#ffffff"}} />
              <Text tx="pair:cameraMessage" size="sm" className="text-center" style={{color: "#d4d4d4"}} />
              <Button
                tx={permission?.canAskAgain === false ? "pair:openSettings" : "pair:allowCamera"}
                preset="secondary"
                style={{alignSelf: "stretch"}}
                onPress={() => (permission?.canAskAgain === false ? Linking.openSettings() : requestPermission())}
              />
            </View>
          )}
        </View>
      </View>
      {!rail && (
        <View className="absolute" style={{top: insets.top + 8, left: insetLeft + 24}}>
          <PressableIcon icon={X} glass onPress={goBack} accessibilityLabel={translate("common:close")} />
        </View>
      )}
    </View>
  )
}
