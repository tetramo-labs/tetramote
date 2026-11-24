import {create} from "zustand"

import {load, save} from "@/utils/storage"

export type ThemePreference = "system" | "light" | "dark"
export type InputMode = "trackpad" | "direct"
export type TrackpadSpeed = "slow" | "normal" | "fast"
export type StreamResolution = "auto" | "640" | "854" | "1280" | "1920" | "2560"
export type ControlsCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right"

export interface Settings {
  theme_preference: ThemePreference
  relay_url: string
  default_input_mode: InputMode
  trackpad_speed: TrackpadSpeed
  stream_bitrate_auto: boolean
  stream_bitrate_mbps: number
  stream_resolution: StreamResolution
  controls_corner: ControlsCorner
  play_audio: boolean
  auto_hide_controls: boolean
  start_full_screen: boolean
  show_connection_details: boolean
  share_analytics: boolean
  device_name: string
}

export const DEFAULT_SETTINGS: Settings = {
  theme_preference: "system",
  relay_url: "",
  default_input_mode: "trackpad",
  trackpad_speed: "normal",
  stream_bitrate_auto: true,
  stream_bitrate_mbps: 8,
  stream_resolution: "auto",
  controls_corner: "bottom-right",
  play_audio: true,
  auto_hide_controls: false,
  start_full_screen: false,
  show_connection_details: false,
  share_analytics: true,
  device_name: "",
}

const STORAGE_KEY = "settings"

interface SettingsState {
  settings: Settings
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  reset: () => void
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: {...DEFAULT_SETTINGS, ...load<Partial<Settings>>(STORAGE_KEY).value_or({})},
  setSetting: (key, value) => {
    const settings = {...get().settings, [key]: value}
    set({settings})
    save(STORAGE_KEY, settings)
  },
  reset: () => {
    set({settings: DEFAULT_SETTINGS})
    save(STORAGE_KEY, DEFAULT_SETTINGS)
  },
}))

export function useSetting<K extends keyof Settings>(key: K): [Settings[K], (value: Settings[K]) => void] {
  const value = useSettingsStore((s) => s.settings[key])
  const setSetting = useSettingsStore((s) => s.setSetting)
  return [value, (v) => setSetting(key, v)]
}

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSettingsStore.getState().settings[key]
}
