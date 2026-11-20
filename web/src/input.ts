export const FLAG_SHIFT = 0x20000
export const FLAG_CONTROL = 0x40000
export const FLAG_OPTION = 0x80000
export const FLAG_COMMAND = 0x100000

export const MOUSE_LEFT = 0
export const MOUSE_RIGHT = 1
export const MOUSE_MIDDLE = 2

export const SCROLL_BEGAN = 1
export const SCROLL_CHANGED = 2
export const SCROLL_ENDED = 3

export const KEY_RETURN = 0x24
export const KEY_TAB = 0x30
export const KEY_DELETE = 0x33
export const KEY_ESCAPE = 0x35
export const KEY_LEFT = 0x7b
export const KEY_RIGHT = 0x7c
export const KEY_DOWN = 0x7d
export const KEY_UP = 0x7e

const MAX_TEXT_BYTES = 1000

export type InputEvent =
  | {kind: "move"; dx: number; dy: number}
  | {kind: "moveTo"; x: number; y: number}
  | {kind: "button"; button: number; down: boolean; clicks: number}
  | {kind: "scroll"; dx: number; dy: number; phase: number}
  | {kind: "key"; keyCode: number; down: boolean; flags: number}
  | {kind: "text"; text: string}

const utf8 = new TextEncoder()

/** At most `max` bytes of UTF-8, cut on a character boundary. */
function textBytes(text: string, max: number): Uint8Array {
  const bytes = utf8.encode(text)
  if (bytes.length <= max) return bytes
  let end = max
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end)
}

/** Input records as PROTOCOL.md lays them out: `u16 length`, `u8 type`, big-endian payload. */
export function encodeRecords(events: InputEvent[]): Uint8Array {
  const chunks: Uint8Array[] = []
  for (const e of events) {
    let body: Uint8Array
    let view: DataView
    switch (e.kind) {
      case "move":
      case "moveTo":
        body = new Uint8Array(9)
        view = new DataView(body.buffer)
        body[0] = e.kind === "move" ? 0x01 : 0x02
        view.setFloat32(1, e.kind === "move" ? e.dx : e.x)
        view.setFloat32(5, e.kind === "move" ? e.dy : e.y)
        break
      case "button":
        body = Uint8Array.of(0x03, e.button, e.down ? 1 : 0, Math.max(1, Math.min(3, e.clicks)))
        break
      case "scroll":
        body = new Uint8Array(10)
        view = new DataView(body.buffer)
        body[0] = 0x04
        view.setFloat32(1, e.dx)
        view.setFloat32(5, e.dy)
        body[9] = e.phase
        break
      case "key":
        body = new Uint8Array(8)
        view = new DataView(body.buffer)
        body[0] = 0x05
        view.setUint16(1, e.keyCode)
        body[3] = e.down ? 1 : 0
        view.setUint32(4, e.flags)
        break
      case "text": {
        const text = textBytes(e.text, MAX_TEXT_BYTES)
        if (text.length === 0) continue
        body = new Uint8Array(1 + text.length)
        body[0] = 0x06
        body.set(text, 1)
        break
      }
    }
    const record = new Uint8Array(2 + body.length)
    new DataView(record.buffer).setUint16(0, body.length)
    record.set(body, 2)
    chunks.push(record)
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** Where an aspect-fit picture of `aspect` sits inside `box`. */
export function contentRect(box: Rect, aspect: number): Rect {
  if (box.width <= 0 || box.height <= 0 || aspect <= 0) return box
  const width = Math.min(box.width, box.height * aspect)
  const height = width / aspect
  return {left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height}
}

export function normalized(clientX: number, clientY: number, content: Rect): {x: number; y: number} {
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return {x: clamp((clientX - content.left) / content.width), y: clamp((clientY - content.top) / content.height)}
}

/** DOM mouse buttons (0 left, 1 middle, 2 right) to the protocol's (0 left, 1 right, 2 middle). */
export function protocolButton(domButton: number): number | null {
  return domButton === 0 ? MOUSE_LEFT : domButton === 2 ? MOUSE_RIGHT : domButton === 1 ? MOUSE_MIDDLE : null
}

export function modifierFlags(e: {shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean}): number {
  return (
    (e.shiftKey ? FLAG_SHIFT : 0) |
    (e.ctrlKey ? FLAG_CONTROL : 0) |
    (e.altKey ? FLAG_OPTION : 0) |
    (e.metaKey ? FLAG_COMMAND : 0)
  )
}

const LINE_PIXELS = 16
const PAGE_PIXELS = 400

/** A wheel event as a protocol scroll: positive `dy` drags content down, the opposite sign of the DOM's `deltaY`. */
export function scrollFromWheel(e: {deltaX: number; deltaY: number; deltaMode: number}): InputEvent {
  const scale = e.deltaMode === 1 ? LINE_PIXELS : e.deltaMode === 2 ? PAGE_PIXELS : 1
  return {kind: "scroll", dx: -e.deltaX * scale, dy: -e.deltaY * scale, phase: 0}
}

/** The DOM `code` for a typed character that needs a key press (a shortcut with a modifier held), or null. */
export function codeForCharacter(ch: string): string | null {
  if (/^[a-z]$/i.test(ch)) return `Key${ch.toUpperCase()}`
  if (/^[0-9]$/.test(ch)) return `Digit${ch}`
  if (ch === " ") return "Space"
  return null
}
