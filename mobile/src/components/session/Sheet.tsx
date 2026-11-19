import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet"
import {forwardRef, type ReactNode} from "react"

import {useAppTheme} from "@/contexts/ThemeContext"
import {useSaferAreaInsets} from "@/contexts/SaferAreaContext"

function Backdrop(props: BottomSheetBackdropProps) {
  return <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
}

export const Sheet = forwardRef<BottomSheetModal, {children: ReactNode}>(function Sheet({children}, ref) {
  const {theme} = useAppTheme()
  const insets = useSaferAreaInsets()
  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backdropComponent={Backdrop}
      backgroundStyle={{backgroundColor: theme.colors.background, borderRadius: 24}}
      handleIndicatorStyle={{backgroundColor: theme.colors.muted_foreground + "40", width: 64, height: 6}}>
      <BottomSheetView style={{paddingHorizontal: 24, paddingTop: 8, paddingBottom: insets.bottom + 16, gap: 12}}>
        {children}
      </BottomSheetView>
    </BottomSheetModal>
  )
})
