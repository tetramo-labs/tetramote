import {ChevronLeft, type LucideIcon} from "lucide-react-native"
import type {ReactNode} from "react"
import {View} from "react-native"

import {PressableIcon} from "@/components/ignite/Icon"
import {Text} from "@/components/ignite/Text"
import {translate, type TxKeyPath} from "@/i18n"
import {useNavigationStore} from "@/stores/navigation"

interface HeaderProps {
  titleTx?: TxKeyPath
  title?: string
  back?: boolean
  rightIcon?: LucideIcon
  onRightPress?: () => void
  right?: ReactNode
}

export function Header({titleTx, title, back, rightIcon, onRightPress, right}: HeaderProps) {
  const goBack = useNavigationStore((s) => s.goBack)
  return (
    <View className="flex-row items-center gap-3 px-6 py-2" style={{minHeight: 56}}>
      {back && (
        <PressableIcon icon={ChevronLeft} glass onPress={goBack} accessibilityLabel={translate("common:back")} />
      )}
      <Text tx={titleTx} text={title} preset="subheading" className="flex-1 text-foreground" numberOfLines={1} />
      {right}
      {rightIcon && <PressableIcon icon={rightIcon} glass onPress={onRightPress} />}
    </View>
  )
}
