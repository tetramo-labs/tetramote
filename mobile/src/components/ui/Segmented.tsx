import {Pressable, View} from "react-native"

import {Text} from "@/components/ignite/Text"
import {useAppTheme} from "@/contexts/ThemeContext"
import type {TxKeyPath} from "@/i18n"

interface Option<T extends string> {
  value: T
  tx: TxKeyPath
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
}) {
  const {theme} = useAppTheme()
  return (
    <View className="flex-row rounded-full p-1 gap-1" style={{backgroundColor: theme.colors.background}}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{selected}}
            onPress={() => onChange(option.value)}
            className="rounded-full px-3 py-1.5"
            style={{backgroundColor: selected ? theme.colors.secondary_foreground : "transparent"}}>
            <Text
              tx={option.tx}
              size="xs"
              weight="medium"
              style={{color: selected ? theme.colors.primary_foreground : theme.colors.muted_foreground}}
            />
          </Pressable>
        )
      })}
    </View>
  )
}
