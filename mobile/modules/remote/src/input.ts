export const MOUSE_LEFT = 0
export const MOUSE_RIGHT = 1
export const MOUSE_MIDDLE = 2

export const SCROLL_NONE = 0
export const SCROLL_BEGAN = 1
export const SCROLL_CHANGED = 2
export const SCROLL_ENDED = 3
export const SCROLL_MOMENTUM = 4

export const FLAG_SHIFT = 0x20000
export const FLAG_CONTROL = 0x40000
export const FLAG_OPTION = 0x80000
export const FLAG_COMMAND = 0x100000

const MAX_TEXT_BYTES = 1000

export type InputEvent =
  | {kind: "move"; dx: number; dy: number}
  | {kind: "moveTo"; x: number; y: number}
  | {kind: "button"; button: number; down: boolean; clicks: number}
  | {kind: "scroll"; dx: number; dy: number; phase: number}
  | {kind: "key"; keyCode: number; down: boolean; flags: number}
  | {kind: "text"; text: string}

function payloadSize(event: InputEvent, text?: Uint8Array): number {
  switch (event.kind) {
    case "move":
    case "moveTo":
      return 8
    case "button":
      return 3
    case "scroll":
      return 9
    case "key":
      return 7
    case "text":
      return text?.length ?? 0
  }
}

const TYPE = {move: 0x01, moveTo: 0x02, button: 0x03, scroll: 0x04, key: 0x05, text: 0x06} as const

/** Frames input events as PROTOCOL.md's input records, ready for `remote.sendInput`. */
export function encodeInput(events: InputEvent[]): Uint8Array {
  const encoder = new TextEncoder()
  const texts = events.map((e) =>
    e.kind === "text" ? truncateUtf8(encoder.encode(e.text), MAX_TEXT_BYTES) : undefined,
  )
  const total = events.reduce((sum, e, i) => sum + 3 + payloadSize(e, texts[i]), 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let at = 0
  events.forEach((event, i) => {
    const size = payloadSize(event, texts[i])
    view.setUint16(at, size + 1)
    view.setUint8(at + 2, TYPE[event.kind])
    const p = at + 3
    switch (event.kind) {
      case "move":
        view.setFloat32(p, event.dx)
        view.setFloat32(p + 4, event.dy)
        break
      case "moveTo":
        view.setFloat32(p, event.x)
        view.setFloat32(p + 4, event.y)
        break
      case "button":
        view.setUint8(p, event.button)
        view.setUint8(p + 1, event.down ? 1 : 0)
        view.setUint8(p + 2, event.clicks)
        break
      case "scroll":
        view.setFloat32(p, event.dx)
        view.setFloat32(p + 4, event.dy)
        view.setUint8(p + 8, event.phase)
        break
      case "key":
        view.setUint16(p, event.keyCode)
        view.setUint8(p + 2, event.down ? 1 : 0)
        view.setUint32(p + 3, event.flags)
        break
      case "text":
        out.set(texts[i] ?? new Uint8Array(), p)
        break
    }
    at = p + size
  })
  return out
}

function truncateUtf8(bytes: Uint8Array, max: number): Uint8Array {
  if (bytes.length <= max) return bytes
  let end = max
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end)
}
