import {pairingFromParams, parsePairingUrl} from "@/services/pairingUrl"

const SECRET = "0123456789abcdef0123456789abcdef"

describe("parsePairingUrl", () => {
  it("reads ticket, secret and a percent-encoded name", () => {
    expect(
      parsePairingUrl(`tetramote://pair?ticket=endpointabc&secret=${SECRET}&name=Fosse%E2%80%99s%20MacBook`),
    ).toEqual({
      ticket: "endpointabc",
      secret: SECRET,
      name: "Fosse’s MacBook",
    })
  })

  it("defaults the name to Computer", () => {
    expect(parsePairingUrl(`tetramote://pair?ticket=t&secret=${SECRET}`)?.name).toBe("Computer")
  })

  it("rejects other URLs, missing tickets and malformed secrets", () => {
    expect(parsePairingUrl("https://example.com")).toBeNull()
    expect(parsePairingUrl(`tetramote://pair?secret=${SECRET}`)).toBeNull()
    expect(parsePairingUrl("tetramote://pair?ticket=t&secret=xyz")).toBeNull()
    expect(parsePairingUrl("tetramote://pair?ticket=%E0%A4%A&secret=" + SECRET)).toBeNull()
  })

  it("accepts deep-link params from the router", () => {
    expect(pairingFromParams({ticket: "t", secret: SECRET.toUpperCase(), name: "Studio"})).toEqual({
      ticket: "t",
      secret: SECRET,
      name: "Studio",
    })
    expect(pairingFromParams({ticket: ["t"], secret: SECRET})).toBeNull()
  })
})
