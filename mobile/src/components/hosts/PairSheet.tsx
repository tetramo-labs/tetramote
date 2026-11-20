import type {BottomSheetModal} from "@gorhom/bottom-sheet"
import * as Clipboard from "expo-clipboard"
import {ClipboardPaste, QrCode, type LucideIcon} from "lucide-react-native"
import {useState, type RefObject} from "react"
import {Pressable, View} from "react-native"

import {Icon} from "@/components/ignite/Icon"
import {Text} from "@/components/ignite/Text"
import {Sheet} from "@/components/session/Sheet"
import {useAppTheme} from "@/contexts/ThemeContext"
import type {TxKeyPath} from "@/i18n"
import {parsePairingUrl} from "@/services/pairingUrl"
import {pair} from "@/services/remote"
import {useNavigationStore} from "@/stores/navigation"

function Choice({
  icon,
  labelTx,
  subtitleTx,
  onPress,
}: {
  icon: LucideIcon
  labelTx: TxKeyPath
  subtitleTx: TxKeyPath
  onPress: () => void
}) {
  const {theme} = useAppTheme()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl px-4 py-3 bg-primary-foreground">
      <Icon icon={icon} size={20} color={theme.colors.brand_secondary} />
      <View className="flex-1 gap-0.5">
        <Text tx={labelTx} size="sm" className="text-foreground" />
        <Text tx={subtitleTx} size="xs" className="text-muted-foreground" />
      </View>
    </Pressable>
  )
}

export function PairSheet({sheet}: {sheet: RefObject<BottomSheetModal | null>}) {
  const push = useNavigationStore((s) => s.push)
  const [noLink, setNoLink] = useState(false)

  const scan = () => {
    sheet.current?.dismiss()
    push("/pair")
  }

  const paste = async () => {
    const code = parsePairingUrl(await Clipboard.getStringAsync())
    setNoLink(!code)
    if (!code) return
    sheet.current?.dismiss()
    pair(code)
    push("/session")
  }

  return (
    <Sheet ref={sheet} fullWidth onDismiss={() => setNoLink(false)}>
      <Text tx="pair:title" preset="subheading" className="text-foreground" />
      <Choice icon={QrCode} labelTx="pair:scan" subtitleTx="pair:scanHint" onPress={scan} />
      <Choice icon={ClipboardPaste} labelTx="pair:paste" subtitleTx="pair:pasteHint" onPress={paste} />
      {noLink && <Text tx="pair:noLink" size="xs" className="text-destructive px-4" />}
    </Sheet>
  )
}
