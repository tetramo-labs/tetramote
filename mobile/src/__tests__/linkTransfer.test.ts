import {linksJson, parseLinksJson} from "@/services/linkTransfer"
import type {PairedMac} from "@/stores/hosts"

jest.mock("expo-document-picker", () => ({}))
jest.mock("expo-file-system", () => ({}))
jest.mock("expo-sharing", () => ({}))

const ID_A = "a".repeat(64)
const ID_B = "b".repeat(64)
const SECRET = "0123456789abcdef0123456789abcdef"

const host = (id: string, secret?: string): PairedMac => ({
  id,
  name: "Studio Mac",
  ticket: "",
  ...(secret ? {secret} : {}),
  pairedAt: 0,
  lastConnectedAt: null,
})

describe("linksJson", () => {
  it("exports only computers with a secret, as pairing links", () => {
    const {json, count} = linksJson([host(ID_A, SECRET), host(ID_B)], new Date("2026-11-20T00:00:00Z"))
    expect(count).toBe(1)
    expect(JSON.parse(json)).toEqual({
      format: "tetramote-links",
      version: 1,
      exportedAt: "2026-11-20T00:00:00.000Z",
      computers: [
        {name: "Studio Mac", link: `https://remote.tetramote.com/#id=${ID_A}&secret=${SECRET}&name=Studio%20Mac`},
      ],
    })
  })
})

describe("parseLinksJson", () => {
  const link = `https://remote.tetramote.com/#id=${ID_A}&secret=${SECRET}&name=Studio%20Mac`

  it("reads an export back", () => {
    expect(parseLinksJson(JSON.stringify({computers: [{name: "x", link}]}))).toEqual([
      {endpointId: ID_A, secret: SECRET, name: "Studio Mac"},
    ])
  })

  it("reads a plain array of links and keeps each computer once", () => {
    expect(parseLinksJson(JSON.stringify([link, {link}, "not a link"]))).toHaveLength(1)
  })

  it("returns nothing for text that isn't JSON or has no links", () => {
    expect(parseLinksJson("hello")).toEqual([])
    expect(parseLinksJson(JSON.stringify({computers: [{link: "https://example.com"}]}))).toEqual([])
  })
})
