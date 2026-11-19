import type {Colors} from "./colors"
import {colorsDark, colorsLight} from "./colors"
import {spacing, type Spacing} from "./spacing"

export interface Theme {
  colors: Colors
  spacing: Spacing
  isDark: boolean
}

export type ThemedStyle<T> = (theme: Theme) => T

export const lightTheme: Theme = {colors: colorsLight, spacing, isDark: false}
export const darkTheme: Theme = {colors: colorsDark, spacing, isDark: true}

export const timing = {quick: 300}
