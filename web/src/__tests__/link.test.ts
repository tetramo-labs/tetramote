import {describe, expect, it} from "vitest"

import {fragmentFor, parseFragment, parseLink} from "@/link"

const ID = "20335dac186d6285c52b0dbe2f7b91a73dadbea6abe08d6e9aa777fe2bfe99e5"
const SECRET = "0123456789abcdef0123456789abcdef"
const LINK = `https://remote.tetramote.com/#id=${ID}&secret=${SECRET}&name=Fosse%E2%80%99s%20Mac`

describe("links", () => {
  it("reads the link core/src/link.rs writes", () => {
    expect(parseLink(LINK)).toEqual({endpointId: ID, secret: SECRET, name: "Fosse’s Mac"})
    expect(parseFragment(`#id=${ID}&secret=${SECRET}&name=Fosse%E2%80%99s%20Mac`)?.name).toBe("Fosse’s Mac")
  })

  it("accepts loose forms and defaults the name", () => {
    expect(parseLink(`  remote.tetramote.com#id=${ID.toUpperCase()}&secret=${SECRET.toUpperCase()}  `)).toEqual({
      endpointId: ID,
      secret: SECRET,
      name: "Computer",
    })
  })

  it("rejects other hosts and malformed values", () => {
    expect(parseLink(`https://example.com/#id=${ID}&secret=${SECRET}`)).toBeNull()
    expect(parseLink(`https://remote.tetramote.com/?id=${ID}&secret=${SECRET}`)).toBeNull()
    expect(parseLink(`https://remote.tetramote.com/#id=${ID}`)).toBeNull()
    expect(parseLink(`https://remote.tetramote.com/#id=abc&secret=${SECRET}`)).toBeNull()
    expect(parseLink(`https://remote.tetramote.com/#id=${ID}&secret=${SECRET}&name=%E0%A4%A`)).toBeNull()
    expect(parseLink("tetramote://pair?ticket=t&secret=0123456789abcdef0123456789abcdef")).toBeNull()
  })

  it("writes a fragment that reads back", () => {
    expect(fragmentFor({endpointId: ID, secret: SECRET, name: "Studio Mac"})).toBe(
      `#id=${ID}&secret=${SECRET}&name=Studio%20Mac`,
    )
  })
})
