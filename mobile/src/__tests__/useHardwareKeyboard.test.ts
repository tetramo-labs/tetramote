import {FLAG_COMMAND, FLAG_SHIFT, remote, type HardwareKeyEvent} from "@tetramote/remote"
import {act, renderHook} from "@testing-library/react-native"

import {useHardwareKeyboard, useStickyModifiers} from "@/components/session/useHardwareKeyboard"
import {sendInput} from "@/services/remote"
import {useSettingsStore, type HardwareKeyboardMode} from "@/stores/settings"

jest.mock("@/services/remote", () => ({sendInput: jest.fn()}))

let pressKey: (event: HardwareKeyEvent) => void

async function session(mode: HardwareKeyboardMode) {
  useSettingsStore.getState().setSetting("hardware_keyboard", mode)
  jest.mocked(remote.addListener).mockImplementation(((name: string, listener: (event: HardwareKeyEvent) => void) => {
    if (name === "onKey") pressKey = listener
    return {remove: jest.fn()}
  }) as typeof remote.addListener)
  remote.setHardwareKeyboard = jest.fn()
  return renderHook(() => useHardwareKeyboard())
}

function sent() {
  return jest.mocked(sendInput).mock.calls.map(([events]) => events)
}

describe("useHardwareKeyboard with the key row's modifiers", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.mocked(sendInput).mockClear()
    useStickyModifiers.setState({modifiers: []})
  })
  afterEach(() => jest.useRealTimers())

  it("sends the row's ⌘ with the next Delete, through its repeats and release, then drops it", async () => {
    const {unmount} = await session("translated")
    useStickyModifiers.getState().toggle("command")
    pressKey({usage: 0x2a, down: true})
    jest.advanceTimersByTime(400)
    pressKey({usage: 0x2a, down: false})
    pressKey({usage: 0x2a, down: true})
    pressKey({usage: 0x2a, down: false})
    expect(sent()).toEqual([
      [{kind: "key", keyCode: 0x33, down: true, flags: FLAG_COMMAND}],
      [{kind: "key", keyCode: 0x33, down: true, flags: FLAG_COMMAND}],
      [{kind: "key", keyCode: 0x33, down: false, flags: FLAG_COMMAND}],
      [{kind: "key", keyCode: 0x33, down: true, flags: 0}],
      [{kind: "key", keyCode: 0x33, down: false, flags: 0}],
    ])
    expect(useStickyModifiers.getState().modifiers).toEqual([])
    await act(async () => unmount())
  })

  it("sends the row's ⇧ with an arrow when translated", async () => {
    const {unmount} = await session("translated")
    useStickyModifiers.getState().toggle("shift")
    pressKey({usage: 0x50, down: true})
    pressKey({usage: 0x50, down: false})
    expect(sent()).toEqual([
      [{kind: "key", keyCode: 0x7b, down: true, flags: FLAG_SHIFT}],
      [{kind: "key", keyCode: 0x7b, down: false, flags: FLAG_SHIFT}],
    ])
    await act(async () => unmount())
  })

  it("sends the row's ⌘ with a letter by position when raw", async () => {
    const {unmount} = await session("raw")
    useStickyModifiers.getState().toggle("command")
    pressKey({usage: 0x06, down: true})
    pressKey({usage: 0x06, down: false})
    expect(sent()).toEqual([
      [{kind: "key", keyCode: 0x08, down: true, flags: FLAG_COMMAND}],
      [{kind: "key", keyCode: 0x08, down: false, flags: FLAG_COMMAND}],
    ])
    expect(useStickyModifiers.getState().modifiers).toEqual([])
    await act(async () => unmount())
  })

  it("leaves a letter and the row's ⌘ to the text field when translated", async () => {
    const {unmount} = await session("translated")
    useStickyModifiers.getState().toggle("command")
    pressKey({usage: 0x06, down: true})
    pressKey({usage: 0x06, down: false})
    expect(sent()).toEqual([])
    expect(useStickyModifiers.getState().modifiers).toEqual(["command"])
    await act(async () => unmount())
  })
})
