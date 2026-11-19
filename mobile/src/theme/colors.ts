const shared = {
  brand_primary: "#004dfc",
  brand_secondary: "#86acff",
  black: "#000000",
  white: "#ffffff",
}

export const colorsLight = {
  ...shared,
  primary: "#0043e0",
  primary_foreground: "#f5f5f5",
  secondary: "#cfdeff",
  secondary_foreground: "#0a0a0a",
  background: "#ffffff",
  foreground: "#0a0a0a",
  muted: "#dee9ff",
  muted_foreground: "#737373",
  accent: "#bdd1ff",
  card: "#ffffff",
  border: "#e5e5e5",
  destructive: "#dc2626",
  success: "#16a34a",
  warning: "#d97706",
  sidebar_border: "#d4d4d4",
  gradient: "#ededed",
}

export type Colors = typeof colorsLight

export const colorsDark: Colors = {
  ...shared,
  primary: "#004dfc",
  primary_foreground: "#2e2e2e",
  secondary: "#213678",
  secondary_foreground: "#fafafa",
  background: "#171717",
  foreground: "#fafafa",
  muted: "#1a2c66",
  muted_foreground: "#a3a3a3",
  accent: "#2a418b",
  card: "#171717",
  border: "#525252",
  destructive: "#f87171",
  success: "#4ade80",
  warning: "#fbbf24",
  sidebar_border: "#ffffffcc",
  gradient: "#262626",
}
