import {execSync} from "node:child_process"

import {withAndroidManifest, withAppBuildGradle, withMainActivity, type ConfigPlugin} from "@expo/config-plugins"
import type {ConfigContext, ExpoConfig} from "expo/config"

const SIGNING = `
        release {
            def keystorePath = project.findProperty("TETRAMOTE_UPLOAD_STORE_FILE")
            def keystore = keystorePath ? new File(keystorePath) : new File(System.getProperty("user.home"), ".tetramote/credentials/upload-keystore.jks")
            def password = project.findProperty("TETRAMOTE_UPLOAD_STORE_PASSWORD") ?: ""
            if (keystore.exists() && password) {
                storeFile keystore
                storePassword password
                keyAlias "upload"
                keyPassword password
            } else {
                storeFile file("debug.keystore")
                storePassword "android"
                keyAlias "androiddebugkey"
                keyPassword "android"
            }
        }`

/**
 * Signs release builds with the Play upload key (~/.tetramote/credentials, or TETRAMOTE_UPLOAD_STORE_FILE in CI)
 * when TETRAMOTE_UPLOAD_STORE_PASSWORD is set (bun android-release does), else with the debug key.
 */
const withReleaseSigning: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents
    if (!gradle.includes(".tetramote/credentials/upload-keystore.jks")) {
      gradle = gradle.replace(/(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/, `$1${SIGNING}`)
      gradle = gradle.replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
        "$1signingConfig signingConfigs.release",
      )
    }
    mod.modResults.contents = gradle
    return mod
  })

const OPTIONAL_FEATURES = [
  "android.hardware.camera",
  "android.hardware.camera.autofocus",
  "android.hardware.screen.portrait",
  "android.hardware.wifi",
]

/** Play limits an app to devices with every feature its manifest implies; pairing by link needs none of these. */
const withOptionalFeatures: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest
    const declared = (manifest["uses-feature"] ?? []).filter(
      (f) => !OPTIONAL_FEATURES.includes(f.$["android:name"] ?? ""),
    )
    manifest["uses-feature"] = [
      ...declared,
      ...OPTIONAL_FEATURES.map((name) => ({$: {"android:name": name, "android:required": "false" as const}})),
    ]
    return mod
  })

const KEY_DISPATCH = `
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean =
    com.tetramote.remote.HardwareKeyboard.handle(event) || super.dispatchKeyEvent(event)
`

/** Hands hardware keyboard keys to the remote module first, so a session can send them to the computer. */
const withHardwareKeyboard: ConfigPlugin = (config) =>
  withMainActivity(config, (mod) => {
    const source = mod.modResults.contents
    if (!source.includes("HardwareKeyboard.handle")) {
      mod.modResults.contents = source.replace(/\n}\s*$/, `\n${KEY_DISPATCH}}\n`)
    }
    return mod
  })

const version = require("./package.json").version as string

/**
 * The commit count, so every build from a newer commit has a higher build number.
 * TETRAMOTE_BUILD_NUMBER overrides it and must still exceed every build already uploaded.
 */
function buildNumber(): number {
  const pinned = Number(process.env.TETRAMOTE_BUILD_NUMBER)
  if (Number.isInteger(pinned) && pinned > 0) return pinned
  try {
    return Number(execSync("git rev-list --count HEAD", {cwd: __dirname}).toString().trim()) || 1
  } catch {
    return 1
  }
}

const build = buildNumber()

module.exports = ({config}: ConfigContext): ExpoConfig =>
  withHardwareKeyboard(
    withOptionalFeatures(
      withReleaseSigning({
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
          associatedDomains: ["applinks:remote.tetramote.com"],
          buildNumber: String(build),
          appleTeamId: process.env.EXPO_PUBLIC_APPLE_TEAM_ID || "B8446S9493",
          supportsTablet: false,
          requireFullScreen: false,
          infoPlist: {
            NSCameraUsageDescription: "Tetramote uses the camera to scan the pairing code your computer shows.",
            NSLocalNetworkUsageDescription:
              "Tetramote connects straight to your computer when it is on the same network.",
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
          permissions: [
            "CAMERA",
            "INTERNET",
            "ACCESS_NETWORK_STATE",
            "ACCESS_WIFI_STATE",
            "CHANGE_WIFI_MULTICAST_STATE",
          ],
          blockedPermissions: [
            "android.permission.RECORD_AUDIO",
            "android.permission.SYSTEM_ALERT_WINDOW",
            "android.permission.USE_BIOMETRIC",
            "android.permission.USE_FINGERPRINT",
          ],
          allowBackup: false,
        },
        plugins: [
          "expo-router",
          "expo-secure-store",
          [
            "expo-camera",
            {cameraPermission: "Tetramote uses the camera to scan the pairing code your computer shows."},
          ],
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
      } as ExpoConfig),
    ),
  )
