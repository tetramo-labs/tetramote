import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet"
import {forwardRef, type ReactNode} from "react"

import {useAppTheme} from "@/contexts/ThemeContext"
import {useSaferAreaInsets} from "@/contexts/SaferAreaContext"
import {useLayout, usePageGutters} from "@/hooks/useLayout"

function Backdrop(props: BottomSheetBackdropProps) {
  return <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
}

/** `fullWidth` runs the sheet under the Duo's rail, with the rail's inset as its content padding on that side. */
export const Sheet = forwardRef<BottomSheetModal, {children: ReactNode; onDismiss?: () => void; fullWidth?: boolean}>(
  function Sheet({children, onDismiss, fullWidth = false}, ref) {
    const {theme} = useAppTheme()
    const insets = useSaferAreaInsets()
    const {insetLeft, insetRight} = useLayout()
    const gutters = usePageGutters()
    return (
      <BottomSheetModal
        ref={ref}
        onDismiss={onDismiss}
        enableDynamicSizing
        style={fullWidth ? undefined : {marginLeft: insetLeft, marginRight: insetRight}}
        backdropComponent={Backdrop}
        backgroundStyle={{backgroundColor: theme.colors.background, borderRadius: 24}}
        handleIndicatorStyle={{backgroundColor: theme.colors.muted_foreground + "40", width: 64, height: 6}}>
        <BottomSheetView
          style={{
            paddingLeft: fullWidth ? gutters.left : 24,
            paddingRight: fullWidth ? gutters.right : 24,
            paddingTop: 8,
            paddingBottom: insets.bottom + 16,
            gap: 12,
          }}>
          {children}
        </BottomSheetView>
      </BottomSheetModal>
    )
  },
)
