import type {TOptions} from "i18next"
import type {ReactNode} from "react"
// eslint-disable-next-line no-restricted-imports
import {Text as RNText, type TextProps as RNTextProps, type TextStyle} from "react-native"
import {withUniwind} from "uniwind"

import {useAppTheme} from "@/contexts/ThemeContext"
import {translate, type TxKeyPath} from "@/i18n"
import type {ThemedStyle} from "@/theme"
import {typography, type Weights} from "@/theme/typography"

type Sizes = keyof typeof sizeStyles
type Presets = "default" | "bold" | "heading" | "subheading" | "caption"

export interface TextProps extends RNTextProps {
  tx?: TxKeyPath
  text?: string
  txOptions?: TOptions
  preset?: Presets
  weight?: Weights
  size?: Sizes
  children?: ReactNode
}

const sizeStyles = {
  xxl: {fontSize: 36, lineHeight: 44},
  xl: {fontSize: 24, lineHeight: 34},
  lg: {fontSize: 20, lineHeight: 28},
  md: {fontSize: 16, lineHeight: 24},
  sm: {fontSize: 14, lineHeight: 21},
  xs: {fontSize: 12, lineHeight: 18},
} satisfies Record<string, TextStyle>

const weightStyles = Object.fromEntries(
  Object.entries(typography.primary).map(([weight, fontFamily]) => [
    weight,
    {fontFamily, fontWeight: weightValue(weight)},
  ]),
) as Record<Weights, TextStyle>

function weightValue(weight: string): TextStyle["fontWeight"] {
  return ({normal: "400", medium: "500", semibold: "600", bold: "700"} as const)[weight as Weights] ?? "400"
}

const base: ThemedStyle<TextStyle> = (theme) => ({
  ...weightStyles.normal,
  ...sizeStyles.md,
  color: theme.colors.secondary_foreground,
})

const presets: Record<Presets, ThemedStyle<TextStyle>[]> = {
  default: [base],
  bold: [base, () => weightStyles.bold],
  heading: [base, () => ({...weightStyles.bold, ...sizeStyles.xl})],
  subheading: [base, () => ({...weightStyles.medium, ...sizeStyles.lg})],
  caption: [base, (t) => ({...sizeStyles.xs, color: t.colors.muted_foreground})],
}

function TextBase({tx, text, txOptions, preset = "default", weight, size, style, children, ...rest}: TextProps) {
  const {themed} = useAppTheme()
  const content = tx ? translate(tx, txOptions) : text
  const styles = [
    themed<TextStyle>(presets[preset]),
    weight ? weightStyles[weight] : undefined,
    size ? sizeStyles[size] : undefined,
    style,
  ]
  return (
    <RNText {...rest} style={styles}>
      {content ?? children}
    </RNText>
  )
}

export const Text = withUniwind(TextBase)
