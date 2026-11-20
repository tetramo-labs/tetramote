export interface PairingCode {
  endpointId: string
  secret: string
  name: string
}

const HOST = "remote.tetramote.com"
const ID = /^[0-9a-f]{64}$/
const SECRET = /^[0-9a-f]{32}$/

/** Reads a `https://remote.tetramote.com/#id=…&secret=…&name=…` link as `core/src/link.rs` writes it; null otherwise. */
export function parsePairingUrl(raw: string): PairingCode | null {
  const text = raw.trim()
  const hash = text.indexOf("#")
  if (hash < 0) return null
  const location = text
    .slice(0, hash)
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
  if (location.toLowerCase() !== HOST) return null
  const params = new Map<string, string>()
  for (const part of text.slice(hash + 1).split("&")) {
    const eq = part.indexOf("=")
    if (eq <= 0) continue
    try {
      params.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " ")))
    } catch {
      return null
    }
  }
  return pairingFromParams({id: params.get("id"), secret: params.get("secret"), name: params.get("name")})
}

export function pairingFromParams(params: {id?: unknown; secret?: unknown; name?: unknown}): PairingCode | null {
  const endpointId = typeof params.id === "string" ? params.id.trim().toLowerCase() : ""
  const secret = typeof params.secret === "string" ? params.secret.trim().toLowerCase() : ""
  const name = typeof params.name === "string" && params.name.trim() ? params.name.trim() : "Computer"
  if (!ID.test(endpointId) || !SECRET.test(secret)) return null
  return {endpointId, secret, name}
}
