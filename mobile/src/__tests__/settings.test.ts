type SettingsModule = typeof import("@/stores/settings")

const mockDisk = new Map<string, string>()

jest.mock("react-native-mmkv", () => ({
  createMMKV: () => ({
    set: (key: string, value: string) => mockDisk.set(key, value),
    getString: (key: string) => mockDisk.get(key),
    remove: (key: string) => mockDisk.delete(key),
  }),
}))

/** Starts the app over, reading whatever an earlier run saved. */
function launch(): SettingsModule {
  let settings: SettingsModule | undefined
  jest.isolateModules(() => {
    settings = jest.requireActual<SettingsModule>("@/stores/settings")
  })
  return settings!
}

function saved(): Record<string, unknown> {
  return JSON.parse(mockDisk.get("settings") ?? "{}")
}

describe("settings", () => {
  beforeEach(() => mockDisk.clear())

  it("types a hardware keyboard through the phone's layout on a fresh install", () => {
    expect(launch().getSetting("hardware_keyboard")).toBe("translated")
  })

  it("turns a Raw saved before the default changed into Translated, keeping the other settings", () => {
    mockDisk.set("settings", JSON.stringify({hardware_keyboard: "raw", trackpad_speed: "fast"}))
    const settings = launch()
    expect(settings.getSetting("hardware_keyboard")).toBe("translated")
    expect(settings.getSetting("trackpad_speed")).toBe("fast")
  })

  it("saves the migrated value with the next change", () => {
    mockDisk.set("settings", JSON.stringify({hardware_keyboard: "raw"}))
    launch().useSettingsStore.getState().setSetting("trackpad_speed", "slow")
    expect(saved()).toMatchObject({hardware_keyboard: "translated", trackpad_speed: "slow", version: 1})
  })

  it("keeps Raw once someone picks it", () => {
    launch().useSettingsStore.getState().setSetting("hardware_keyboard", "raw")
    expect(saved()).toMatchObject({hardware_keyboard: "raw", version: 1})
    expect(launch().getSetting("hardware_keyboard")).toBe("raw")
  })

  it("keeps the saved version out of the settings", () => {
    mockDisk.set("settings", JSON.stringify({version: 1, play_audio: false}))
    expect(launch().useSettingsStore.getState().settings).not.toHaveProperty("version")
  })
})
