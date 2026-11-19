import {Host, Spacer} from "@expo/ui/swift-ui"
import {onHingeChange} from "@expo/ui/swift-ui/modifiers"
import {useMemo} from "react"

export function HingeObserver({onHalfOpenChange}: {onHalfOpenChange: (halfOpen: boolean) => void}) {
  const modifiers = useMemo(
    () => [onHingeChange((_, next) => onHalfOpenChange(next.hinge?.status === "partiallyOpen"))],
    [onHalfOpenChange],
  )
  return (
    <Host pointerEvents="none" style={{position: "absolute", width: 1, height: 1}}>
      <Spacer modifiers={modifiers} />
    </Host>
  )
}
