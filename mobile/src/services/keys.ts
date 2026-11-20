import {FLAG_COMMAND, FLAG_CONTROL, FLAG_OPTION, FLAG_SHIFT, type InputEvent} from "@tetramote/remote"

export const KEY = {
  return: 0x24,
  tab: 0x30,
  space: 0x31,
  delete: 0x33,
  escape: 0x35,
  forwardDelete: 0x75,
  home: 0x73,
  end: 0x77,
  pageUp: 0x74,
  pageDown: 0x79,
  left: 0x7b,
  right: 0x7c,
  down: 0x7d,
  up: 0x7e,
} as const

export type Modifier = "command" | "option" | "control" | "shift"

export const MODIFIER_FLAGS: Record<Modifier, number> = {
  command: FLAG_COMMAND,
  option: FLAG_OPTION,
  control: FLAG_CONTROL,
  shift: FLAG_SHIFT,
}

/** macOS virtual key codes for an ANSI keyboard. */
const ANSI: Record<string, number> = {
  "a": 0x00,
  "s": 0x01,
  "d": 0x02,
  "f": 0x03,
  "h": 0x04,
  "g": 0x05,
  "z": 0x06,
  "x": 0x07,
  "c": 0x08,
  "v": 0x09,
  "b": 0x0b,
  "q": 0x0c,
  "w": 0x0d,
  "e": 0x0e,
  "r": 0x0f,
  "y": 0x10,
  "t": 0x11,
  "1": 0x12,
  "2": 0x13,
  "3": 0x14,
  "4": 0x15,
  "6": 0x16,
  "5": 0x17,
  "=": 0x18,
  "9": 0x19,
  "7": 0x1a,
  "-": 0x1b,
  "8": 0x1c,
  "0": 0x1d,
  "]": 0x1e,
  "o": 0x1f,
  "u": 0x20,
  "[": 0x21,
  "i": 0x22,
  "p": 0x23,
  "l": 0x25,
  "j": 0x26,
  "'": 0x27,
  "k": 0x28,
  ";": 0x29,
  "\\": 0x2a,
  ",": 0x2b,
  "/": 0x2c,
  "n": 0x2d,
  "m": 0x2e,
  ".": 0x2f,
  "`": 0x32,
  " ": 0x31,
}

export function flagsFor(modifiers: Iterable<Modifier>): number {
  let flags = 0
  for (const m of modifiers) flags |= MODIFIER_FLAGS[m]
  return flags
}

export function keyPress(keyCode: number, flags = 0): InputEvent[] {
  return [
    {kind: "key", keyCode, down: true, flags},
    {kind: "key", keyCode, down: false, flags},
  ]
}

/** A typed character as a shortcut (⌘C, ⌃A…) when modifiers are held; null when it has no ANSI key. */
export function shortcutFor(char: string, modifiers: Iterable<Modifier>): InputEvent[] | null {
  const lower = char.toLowerCase()
  const code = ANSI[lower]
  if (code === undefined || char.length !== 1) return null
  const shift = char !== lower ? FLAG_SHIFT : 0
  return keyPress(code, flagsFor(modifiers) | shift)
}
