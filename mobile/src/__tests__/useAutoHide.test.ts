import {act, renderHook} from "@testing-library/react-native"

import {useAutoHide} from "@/hooks/useAutoHide"

describe("useAutoHide", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it("stays visible while disabled", async () => {
    const {result} = await renderHook(() => useAutoHide(false, 1000))
    await act(async () => jest.advanceTimersByTime(5000))
    expect(result.current.visible).toBe(true)
    await act(async () => result.current.toggle())
    expect(result.current.visible).toBe(true)
  })

  it("hides after the delay, and use restarts the countdown", async () => {
    const {result} = await renderHook(() => useAutoHide(true, 1000))
    await act(async () => jest.advanceTimersByTime(800))
    await act(async () => result.current.show())
    await act(async () => jest.advanceTimersByTime(800))
    expect(result.current.visible).toBe(true)
    await act(async () => jest.advanceTimersByTime(300))
    expect(result.current.visible).toBe(false)
  })

  it("toggles with a three-finger tap", async () => {
    const {result} = await renderHook(() => useAutoHide(true, 1000))
    await act(async () => result.current.toggle())
    expect(result.current.visible).toBe(false)
    await act(async () => result.current.toggle())
    expect(result.current.visible).toBe(true)
    await act(async () => jest.advanceTimersByTime(1000))
    expect(result.current.visible).toBe(false)
  })

  it("shows the controls again when auto-hide is turned off", async () => {
    const {result, rerender} = await renderHook(({on}: {on: boolean}) => useAutoHide(on, 1000), {
      initialProps: {on: true},
    })
    await act(async () => jest.advanceTimersByTime(1000))
    expect(result.current.visible).toBe(false)
    await rerender({on: false})
    expect(result.current.visible).toBe(true)
  })
})
