import {makePairingUrl, pairingFromParams, parsePairingUrl} from "@/services/pairingUrl"
import {redirectSystemPath} from "@/app/+native-intent"

const ID = "20335dac186d6285c52b0dbe2f7b91a73dadbea6abe08d6e9aa777fe2bfe99e5"
const SECRET = "0123456789abcdef0123456789abcdef"
const LINK = `https://remote.tetramote.com/#id=${ID}&secret=${SECRET}&name=Fosse%E2%80%99s%20MacBook`

describe("parsePairingUrl", () => {
  it("reads the id, secret and a percent-encoded name", () => {
    expect(parsePairingUrl(LINK)).toEqual({endpointId: ID, secret: SECRET, name: "Fosse’s MacBook"})
  })

  it("accepts the link without its scheme or slash and defaults the name to Computer", () => {
    expect(parsePairingUrl(`remote.tetramote.com#id=${ID.toUpperCase()}&secret=${SECRET}`)).toEqual({
      endpointId: ID,
      secret: SECRET,
      name: "Computer",
    })
  })

  it("rejects other hosts, old codes and malformed values", () => {
    expect(parsePairingUrl("https://example.com")).toBeNull()
    expect(parsePairingUrl(`https://example.com/#id=${ID}&secret=${SECRET}`)).toBeNull()
    expect(parsePairingUrl(`tetramote://pair?ticket=t&secret=${SECRET}`)).toBeNull()
    expect(parsePairingUrl(`https://remote.tetramote.com/#id=${ID}&secret=xyz`)).toBeNull()
    expect(parsePairingUrl(`https://remote.tetramote.com/#id=abc&secret=${SECRET}`)).toBeNull()
    expect(parsePairingUrl(`https://remote.tetramote.com/#id=${ID}&secret=${SECRET}&name=%E0%A4%A`)).toBeNull()
  })

  it("accepts deep-link params from the router", () => {
    expect(pairingFromParams({id: ID, secret: SECRET.toUpperCase(), name: "Studio"})).toEqual({
      endpointId: ID,
      secret: SECRET,
      name: "Studio",
    })
    expect(pairingFromParams({id: [ID], secret: SECRET})).toBeNull()
  })
})

describe("redirectSystemPath", () => {
  it("sends an opened link to the pair screen and leaves other paths alone", () => {
    expect(redirectSystemPath({path: LINK, initial: true})).toBe(
      `/pair?id=${ID}&secret=${SECRET}&name=Fosse%E2%80%99s%20MacBook`,
    )
    expect(redirectSystemPath({path: "/settings", initial: false})).toBe("/settings")
  })
})

describe("makePairingUrl", () => {
  it("writes the link the computer shares, which reads back", () => {
    expect(makePairingUrl({endpointId: ID, secret: SECRET, name: "Fosse’s Mac"})).toBe(
      `https://remote.tetramote.com/#id=${ID}&secret=${SECRET}&name=Fosse%E2%80%99s%20Mac`,
    )
    const odd = makePairingUrl({endpointId: ID, secret: SECRET, name: "It's (mine)!"})
    expect(odd).toBe(`https://remote.tetramote.com/#id=${ID}&secret=${SECRET}&name=It%27s%20%28mine%29%21`)
    expect(parsePairingUrl(odd)?.name).toBe("It's (mine)!")
  })
})
