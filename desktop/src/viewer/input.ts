import type {ViewerInput} from "@/ipc"

export const FLAG_SHIFT = 0x20000
export const FLAG_CONTROL = 0x40000
export const FLAG_OPTION = 0x80000
export const FLAG_COMMAND = 0x100000

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
  return domButton === 0 ? 0 : domButton === 2 ? 1 : domButton === 1 ? 2 : null
}

/** Modifier state as the wire's CGEventFlags. */
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

/**
 * A wheel event as a protocol scroll: positive `dy` drags content down, the
 * opposite sign of the DOM's `deltaY`.
 */
export function scrollFromWheel(e: {deltaX: number; deltaY: number; deltaMode: number}): ViewerInput {
  const scale = e.deltaMode === 1 ? LINE_PIXELS : e.deltaMode === 2 ? PAGE_PIXELS : 1
  return {kind: "scroll", dx: -e.deltaX * scale, dy: -e.deltaY * scale}
}
