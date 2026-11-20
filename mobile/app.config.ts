import {execSync} from "node:child_process"

import type {ConfigContext, ExpoConfig} from "expo/config"

const version = require("./package.json").version as string

/** The commit count, so every build from a newer commit has a higher build number. */
function buildNumber(): number {
  try {
    return Number(execSync("git rev-list --count HEAD", {cwd: __dirname}).toString().trim()) || 1
  } catch {
    return 1
  }
}

const build = buildNumber()

module.exports = ({config}: ConfigContext): Partial<ExpoConfig> => ({
  ...config,
  name: "Tetramote",
  slug: "tetramote",
  version,
  scheme: "tetramote",
  orientation: "default",
  userInterfaceStyle: "automatic",
  icon: "./assets/app-icons/icon.png",
  ios: {
    bundleIdentifier: "com.tetramo.tetramote",
    buildNumber: String(build),
    appleTeamId: process.env.EXPO_PUBLIC_APPLE_TEAM_ID || "B8446S9493",
    supportsTablet: false,
    requireFullScreen: false,
    infoPlist: {
      NSCameraUsageDescription: "Tetramote uses the camera to scan the pairing code your computer shows.",
      NSLocalNetworkUsageDescription: "Tetramote connects straight to your computer when it is on the same network.",
      UIBackgroundModes: ["audio"],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "com.tetramo.tetramote",
    versionCode: build,
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
    ["expo-camera", {cameraPermission: "Tetramote uses the camera to scan the pairing code your computer shows."}],
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
