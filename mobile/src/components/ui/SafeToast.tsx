import {CircleAlert, CircleCheck, Info, type LucideIcon} from "lucide-react-native"
import {View} from "react-native"
import Toast, {type ToastConfig, type ToastConfigParams} from "react-native-toast-message"

import {Icon} from "@/components/ignite/Icon"
import {Text} from "@/components/ignite/Text"
import {useSaferAreaInsets} from "@/contexts/SaferAreaContext"
import {useAppTheme} from "@/contexts/ThemeContext"
import {useLayout} from "@/hooks/useLayout"
import type {Colors} from "@/theme/colors"

function ThemedToast({text1, text2, icon, tint}: ToastConfigParams<unknown> & {icon: LucideIcon; tint: keyof Colors}) {
  const {theme, themeContext} = useAppTheme()
  return (
    <View
      className="mx-4 rounded-full"
      style={{
        backgroundColor: theme.colors.primary_foreground,
        borderWidth: themeContext === "dark" ? 0 : 1,
        borderColor: theme.colors.border,
        boxShadow: "0px 6px 20px 0px rgba(0, 0, 0, 0.25)",
        maxWidth: 480,
      }}>
      <View className="flex-row items-center gap-2.5 py-2.5 pl-3.5 pr-5">
        <Icon icon={icon} size={20} color={theme.colors[tint]} />
        <View className="shrink">
          {text1 ? <Text text={text1} size="sm" weight="medium" className="text-foreground" /> : null}
          {text2 ? <Text text={text2} size="xs" className="text-muted-foreground" /> : null}
        </View>
      </View>
    </View>
  )
}

const config: ToastConfig = {
  success: (props) => <ThemedToast {...props} icon={CircleCheck} tint="success" />,
  error: (props) => <ThemedToast {...props} icon={CircleAlert} tint="destructive" />,
  info: (props) => <ThemedToast {...props} icon={Info} tint="primary" />,
}

/** Toasts as pills in the app's colors, kept clear of the safe area and the Duo's rail. */
export function SafeToast() {
  const {top, bottom} = useSaferAreaInsets()
  const {insetLeft, insetRight} = useLayout()
  return (
    <View pointerEvents="box-none" className="absolute inset-y-0" style={{left: insetLeft, right: insetRight}}>
      <Toast config={config} topOffset={top + 8} bottomOffset={bottom + 8} />
    </View>
  )
}
