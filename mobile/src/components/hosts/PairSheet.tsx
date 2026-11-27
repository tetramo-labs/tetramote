import type {BottomSheetModal} from "@gorhom/bottom-sheet"
import * as Clipboard from "expo-clipboard"
import {ClipboardPaste, QrCode} from "lucide-react-native"
import {useState, type RefObject} from "react"

import {Text} from "@/components/ignite/Text"
import {Sheet} from "@/components/session/Sheet"
import {SheetChoice} from "@/components/ui/SheetChoice"
import {parsePairingUrl} from "@/services/pairingUrl"
import {pair} from "@/services/remote"
import {useNavigationStore} from "@/stores/navigation"

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
    <Sheet ref={sheet} onDismiss={() => setNoLink(false)}>
      <Text tx="pair:title" preset="subheading" className="text-foreground" />
      <SheetChoice icon={QrCode} labelTx="pair:scan" subtitleTx="pair:scanHint" onPress={scan} />
      <SheetChoice icon={ClipboardPaste} labelTx="pair:paste" subtitleTx="pair:pasteHint" onPress={paste} />
      {noLink && <Text tx="pair:noLink" size="xs" className="text-destructive px-4" />}
    </Sheet>
  )
}
