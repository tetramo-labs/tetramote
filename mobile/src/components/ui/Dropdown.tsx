import {DropdownMenu, DropdownMenuItem, Host, RNHostView, Text as ComposeText} from "@expo/ui/jetpack-compose"
import {ChevronDown} from "lucide-react-native"
import {useState} from "react"
import {Pressable, View} from "react-native"

import {Text} from "@/components/ignite/Text"
import {useAppTheme} from "@/contexts/ThemeContext"
import {translate, type TxKeyPath} from "@/i18n"

export interface DropdownProps<T extends string> {
  options: {value: T; tx: TxKeyPath}[]
  value: T
  onChange: (value: T) => void
}

/** A compact select field (glassly's settings dropdown) that opens a menu of options. */
export function Dropdown<T extends string>({options, value, onChange}: DropdownProps<T>) {
  const {theme} = useAppTheme()
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <Host matchContents>
      <DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)} color={theme.colors.primary_foreground}>
        <DropdownMenu.Trigger>
          <RNHostView matchContents>
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpen(true)}
              style={({pressed}) => ({opacity: pressed ? 0.7 : 1})}>
              <View
                className="flex-row items-center gap-2 rounded-[10px] border pl-2.5 pr-[9px]"
                style={{height: 36, borderColor: theme.colors.border, backgroundColor: theme.colors.background}}>
                <Text text={translate(current.tx)} style={{fontSize: 15, color: theme.colors.foreground}} />
                <ChevronDown size={12} color="#888888" strokeWidth={2.5} />
              </View>
            </Pressable>
          </RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => {
                setOpen(false)
                onChange(option.value)
              }}>
              <DropdownMenuItem.Text>
                <ComposeText
                  color={theme.colors.foreground}
                  style={{fontWeight: option.value === value ? "bold" : "normal"}}>
                  {translate(option.tx)}
                </ComposeText>
              </DropdownMenuItem.Text>
            </DropdownMenuItem>
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  )
}
