import {
  RedHatDisplay_400Regular as redHatDisplayRegular,
  RedHatDisplay_500Medium as redHatDisplayMedium,
  RedHatDisplay_600SemiBold as redHatDisplaySemiBold,
  RedHatDisplay_700Bold as redHatDisplayBold,
} from "@expo-google-fonts/red-hat-display"
import {Platform} from "react-native"

export const customFontsToLoad = {
  redHatDisplayRegular,
  redHatDisplayMedium,
  redHatDisplaySemiBold,
  redHatDisplayBold,
}

/** SF Pro Rounded on iOS, Red Hat Display on Android, as in the Glassly App. */
export const typography = {
  primary: {
    normal: Platform.select({ios: "SF Pro Rounded", default: "redHatDisplayRegular"}),
    medium: Platform.select({ios: "SF Pro Rounded", default: "redHatDisplayMedium"}),
    semibold: Platform.select({ios: "SF Pro Rounded", default: "redHatDisplaySemiBold"}),
    bold: Platform.select({ios: "SF Pro Rounded", default: "redHatDisplayBold"}),
  },
  code: Platform.select({ios: "Menlo", default: "monospace"}),
}

export type Weights = keyof typeof typography.primary
