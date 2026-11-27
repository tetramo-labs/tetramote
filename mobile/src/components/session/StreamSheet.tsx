import type {BottomSheetModal} from "@gorhom/bottom-sheet"
import {forwardRef} from "react"

import {Text} from "@/components/ignite/Text"
import {useStreamRows} from "@/components/settings/useStreamRows"
import {Group} from "@/components/ui/Group"
import {Sheet} from "@/components/session/Sheet"

export const StreamSheet = forwardRef<BottomSheetModal>(function StreamSheet(_props, ref) {
  const rows = useStreamRows()
  return (
    <Sheet ref={ref}>
      <Text tx="session:streamTitle" preset="subheading" className="text-foreground" />
      <Group>{rows}</Group>
    </Sheet>
  )
})
