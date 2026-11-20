import {Children, cloneElement, isValidElement, type ReactElement, type ReactNode} from "react"
import {View, type ViewStyle} from "react-native"

import {Text} from "@/components/ignite/Text"
import type {TxKeyPath} from "@/i18n"

const OUTER = 16
const INNER = 4

export function groupRadius(index: number, count: number): ViewStyle {
  const first = index === 0
  const last = index === count - 1
  return {
    borderTopLeftRadius: first ? OUTER : INNER,
    borderTopRightRadius: first ? OUTER : INNER,
    borderBottomLeftRadius: last ? OUTER : INNER,
    borderBottomRightRadius: last ? OUTER : INNER,
  }
}

/** An iOS-style grouped stack: 16 pt outer corners, 4 pt between rows. */
export function Group({titleTx, children}: {titleTx?: TxKeyPath; children: ReactNode}) {
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<{style?: ViewStyle}>[]
  return (
    <View className="gap-2">
      {titleTx && <Text tx={titleTx} size="md" className="text-muted-foreground mt-4 px-1" />}
      <View className="gap-1">
        {items.map((child, i) => cloneElement(child, {style: {...child.props.style, ...groupRadius(i, items.length)}}))}
      </View>
    </View>
  )
}
