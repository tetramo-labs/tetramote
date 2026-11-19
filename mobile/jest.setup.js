jest.mock("react-native-mmkv", () => {
  const stores = new Map()
  return {
    createMMKV: ({id = "default"} = {}) => {
      if (!stores.has(id)) stores.set(id, new Map())
      const map = stores.get(id)
      return {
        set: (k, v) => map.set(k, v),
        getString: (k) => map.get(k),
        remove: (k) => map.delete(k),
        clearAll: () => map.clear(),
      }
    },
  }
})

jest.mock("./modules/remote/src/TetraRemoteModule", () => ({
  remote: {
    addListener: jest.fn(),
    generateSecretKey: jest.fn(() => "00".repeat(32)),
    endpointId: jest.fn(() => null),
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    connect: jest.fn(),
    disconnect: jest.fn(),
    sendControl: jest.fn(),
    sendInput: jest.fn(),
    setAudioEnabled: jest.fn(),
    launchPairingUrl: jest.fn(() => null),
  },
}))
