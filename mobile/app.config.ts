import type {ConfigContext, ExpoConfig} from "expo/config"

const version = require("./package.json").version as string

module.exports = ({config}: ConfigContext): Partial<ExpoConfig> => ({
  ...config,
  name: "Tetratop",
  slug: "tetratop",
  version,
  scheme: "tetratop",
  orientation: "default",
  userInterfaceStyle: "automatic",
  icon: "./assets/app-icons/icon.png",
  ios: {
    bundleIdentifier: "com.tetramo.tetratop",
    appleTeamId: process.env.EXPO_PUBLIC_APPLE_TEAM_ID || "B8446S9493",
    supportsTablet: true,
    requireFullScreen: false,
    infoPlist: {
      NSCameraUsageDescription: "Tetratop uses the camera to scan the pairing code your Mac shows.",
      NSLocalNetworkUsageDescription: "Tetratop connects straight to your Mac when it is on the same network.",
      UIBackgroundModes: ["audio"],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "com.tetramo.tetratop",
    adaptiveIcon: {
      foregroundImage: "./assets/app-icons/icon-foreground.png",
      backgroundColor: "#004dfc",
    },
    permissions: ["CAMERA", "INTERNET", "ACCESS_NETWORK_STATE", "ACCESS_WIFI_STATE", "CHANGE_WIFI_MULTICAST_STATE"],
    allowBackup: false,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-camera", {cameraPermission: "Tetratop uses the camera to scan the pairing code your Mac shows."}],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#ffffff",
        dark: {backgroundColor: "#171717"},
        image: "./assets/app-icons/splash.png",
        imageWidth: 120,
      },
    ],
    [
      "expo-build-properties",
      {
        ios: {deploymentTarget: "17.0"},
        android: {minSdkVersion: 28, targetSdkVersion: 36, compileSdkVersion: 37},
      },
    ],
  ],
  experiments: {
    tsconfigPaths: true,
    typedRoutes: true,
  },
})
