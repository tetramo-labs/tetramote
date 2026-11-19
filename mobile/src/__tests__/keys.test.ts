import {FLAG_COMMAND, FLAG_SHIFT} from "@tetratop/remote"

import {keyPress, shortcutFor} from "@/services/keys"
import {isRelayUrl} from "@/services/relay"

describe("shortcutFor", () => {
  it("turns c with command into ⌘C on ANSI key 8", () => {
    expect(shortcutFor("c", ["command"])).toEqual(keyPress(0x08, FLAG_COMMAND))
  })

  it("adds shift for capitals", () => {
    expect(shortcutFor("Z", ["command"])).toEqual(keyPress(0x06, FLAG_COMMAND | FLAG_SHIFT))
  })

  it("has no shortcut for characters off the ANSI layout", () => {
    expect(shortcutFor("é", ["command"])).toBeNull()
  })
})

describe("isRelayUrl", () => {
  it("accepts empty and http(s) URLs only", () => {
    expect(isRelayUrl("")).toBe(true)
    expect(isRelayUrl("https://relay.example.com")).toBe(true)
    expect(isRelayUrl("https://relay.example.com/path")).toBe(true)
    expect(isRelayUrl("relay.example.com")).toBe(false)
    expect(isRelayUrl("ftp://relay")).toBe(false)
  })
})
