import {View} from "react-native"
import Toast from "react-native-toast-message"

import {useSaferAreaInsets} from "@/contexts/SaferAreaContext"
import {useLayout} from "@/hooks/useLayout"

export function SafeToast() {
  const {top, bottom} = useSaferAreaInsets()
  const {insetLeft, insetRight} = useLayout()
  return (
    <View pointerEvents="box-none" className="absolute inset-y-0" style={{left: insetLeft, right: insetRight}}>
      <Toast topOffset={top + 8} bottomOffset={bottom + 8} />
    </View>
  )
}
