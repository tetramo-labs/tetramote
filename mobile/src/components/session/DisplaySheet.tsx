import type {BottomSheetModal} from "@gorhom/bottom-sheet"
import {Check} from "lucide-react-native"
import {forwardRef} from "react"

import {Icon} from "@/components/ignite/Icon"
import {Text} from "@/components/ignite/Text"
import {Group} from "@/components/ui/Group"
import {Row} from "@/components/ui/Rows"
import {Sheet} from "@/components/session/Sheet"
import {translate} from "@/i18n"
import {send} from "@/services/remote"
import {useSessionStore} from "@/stores/session"

export const DisplaySheet = forwardRef<BottomSheetModal>(function DisplaySheet(_props, ref) {
  const displays = useSessionStore((s) => s.displays)
  const active = useSessionStore((s) => s.activeDisplay)
  const close = () => (ref && typeof ref === "object" ? ref.current?.dismiss() : undefined)
  return (
    <Sheet ref={ref}>
      <Text tx="session:displaysTitle" preset="subheading" className="text-foreground" />
      <Group>
        {displays.map((d) => (
          <Row
            key={d.id}
            label={d.name}
            subtitle={[`${d.width} × ${d.height}`, d.main ? translate("session:mainDisplay") : null]
              .filter(Boolean)
              .join(" · ")}
            trailing={d.id === active ? <Icon icon={Check} size={20} /> : undefined}
            onPress={() => {
              send({t: "selectDisplay", id: d.id})
              close()
            }}
          />
        ))}
      </Group>
    </Sheet>
  )
})
