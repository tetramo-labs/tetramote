import {ChevronLeft, type LucideIcon} from "lucide-react-native"
import type {ReactNode} from "react"
import {View} from "react-native"

import {PressableIcon} from "@/components/ignite/Icon"
import {Text} from "@/components/ignite/Text"
import {useLayout} from "@/hooks/useLayout"
import {translate, type TxKeyPath} from "@/i18n"
import {useNavigationStore} from "@/stores/navigation"
import {useRailActions, type RailAction} from "@/stores/railToolbar"

interface HeaderProps {
  titleTx?: TxKeyPath
  title?: string
  back?: boolean
  rightIcon?: LucideIcon
  rightLabel?: string
  onRightPress?: () => void
  right?: ReactNode
}

/** Title row; on an iPhone Duo its back and action buttons move into the rail, back first. */
export function Header({titleTx, title, back, rightIcon, rightLabel, onRightPress, right}: HeaderProps) {
  const goBack = useNavigationStore((s) => s.goBack)
  const {rail} = useLayout()
  const actions: RailAction[] = [
    ...(back ? [{key: "back", icon: ChevronLeft, label: translate("common:back"), onPress: goBack}] : []),
    ...(rightIcon && onRightPress
      ? [{key: "right", icon: rightIcon, label: rightLabel ?? "", onPress: onRightPress}]
      : []),
  ]
  useRailActions(rail ? actions : null)

  return (
    <View className="flex-row items-center gap-3 px-6 py-2" style={{minHeight: 56}}>
      {back && !rail && (
        <PressableIcon icon={ChevronLeft} glass onPress={goBack} accessibilityLabel={translate("common:back")} />
      )}
      <Text tx={titleTx} text={title} preset="subheading" className="flex-1 text-foreground" numberOfLines={1} />
      {right}
      {rightIcon && !rail && (
        <PressableIcon icon={rightIcon} glass onPress={onRightPress} accessibilityLabel={rightLabel} />
      )}
    </View>
  )
}
