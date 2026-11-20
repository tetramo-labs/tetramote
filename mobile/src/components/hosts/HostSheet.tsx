import type {BottomSheetModal} from "@gorhom/bottom-sheet"
import * as Clipboard from "expo-clipboard"
import {Link, Trash2} from "lucide-react-native"
import type {RefObject} from "react"
import Toast from "react-native-toast-message"

import {Text} from "@/components/ignite/Text"
import {Sheet} from "@/components/session/Sheet"
import {SheetChoice} from "@/components/ui/SheetChoice"
import {translate} from "@/i18n"
import {makePairingUrl} from "@/services/pairingUrl"
import type {PairedMac} from "@/stores/hosts"

/** What a long press on a paired computer offers. The link needs the secret this phone paired with. */
export function HostSheet({
  sheet,
  host,
  onRemove,
}: {
  sheet: RefObject<BottomSheetModal | null>
  host: PairedMac | null
  onRemove: (host: PairedMac) => void
}) {
  const copyLink = async () => {
    if (!host?.secret) return
    await Clipboard.setStringAsync(makePairingUrl({endpointId: host.id, secret: host.secret, name: host.name}))
    sheet.current?.dismiss()
    Toast.show({type: "success", text1: translate("host:linkCopied"), visibilityTime: 1500})
  }

  const remove = () => {
    if (!host) return
    sheet.current?.dismiss()
    onRemove(host)
  }

  return (
    <Sheet ref={sheet} fullWidth>
      <Text text={host?.name ?? ""} preset="subheading" className="text-foreground" numberOfLines={1} />
      {host?.secret ? (
        <SheetChoice icon={Link} labelTx="host:copyLink" subtitleTx="host:copyLinkHint" onPress={copyLink} />
      ) : null}
      <SheetChoice icon={Trash2} labelTx="host:remove" subtitleTx="host:removeHint" destructive onPress={remove} />
    </Sheet>
  )
}
