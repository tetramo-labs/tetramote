import {Button, HStack, Host, Image, Menu, Text} from "@expo/ui/swift-ui"
import {background, font, foregroundStyle, padding, shapes, strokeBorder} from "@expo/ui/swift-ui/modifiers"

import {useAppTheme} from "@/contexts/ThemeContext"
import {translate} from "@/i18n"

import type {DropdownProps} from "./Dropdown"

const RADIUS = 10

/** A compact select field (glassly's settings dropdown) that opens the system menu of options. */
export function Dropdown<T extends string>({options, value, onChange}: DropdownProps<T>) {
  const {theme} = useAppTheme()
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <Host matchContents>
      <Menu
        label={
          <HStack
            spacing={8}
            modifiers={[
              padding({leading: 10, trailing: 9, top: 8, bottom: 8}),
              background(theme.colors.background, shapes.roundedRectangle({cornerRadius: RADIUS})),
              strokeBorder({content: theme.colors.border, shape: "roundedRectangle", cornerRadius: RADIUS}),
            ]}>
            <Text modifiers={[font({size: 15, design: "rounded"}), foregroundStyle(theme.colors.foreground)]}>
              {translate(current.tx)}
            </Text>
            <Image systemName="chevron.down" size={12} color="#888888" />
          </HStack>
        }>
        {options.map((option) => (
          <Button
            key={option.value}
            label={translate(option.tx)}
            systemImage={option.value === value ? "checkmark" : undefined}
            onPress={() => onChange(option.value)}
          />
        ))}
      </Menu>
    </Host>
  )
}
