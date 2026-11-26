import {useSessionStore} from "@/stores/session"

describe("session pointer shape", () => {
  beforeEach(() => useSessionStore.getState().end())

  it("starts a new session without the last session's shape", () => {
    useSessionStore.getState().applyHostMessage({t: "pointer", png: "AAAA", width: 16, height: 16, hotX: 8, hotY: 8})
    useSessionStore.getState().begin({id: null, name: "Mac", ticket: "t", pairingSecret: null}, "trackpad", false)
    expect(useSessionStore.getState().pointerShape).toBeNull()
  })

  it("keeps the host's pointer image as a PNG data URI with its size and hotspot in points", () => {
    useSessionStore
      .getState()
      .applyHostMessage({t: "pointer", png: "iVBORw0KGgo=", width: 28, height: 40, hotX: 5, hotY: 5.5})
    expect(useSessionStore.getState().pointerShape).toEqual({
      uri: "data:image/png;base64,iVBORw0KGgo=",
      width: 28,
      height: 40,
      hotX: 5,
      hotY: 5.5,
    })
  })

  it("forgets the shape when the session ends", () => {
    useSessionStore.getState().applyHostMessage({t: "pointer", png: "AAAA", width: 16, height: 16, hotX: 8, hotY: 8})
    useSessionStore.getState().end()
    expect(useSessionStore.getState().pointerShape).toBeNull()
  })
})
