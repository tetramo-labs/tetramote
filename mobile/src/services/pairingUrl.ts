export interface PairingCode {
  ticket: string
  secret: string
  name: string
}

const SECRET = /^[0-9a-f]{32}$/

/** Reads a `tetramote://pair?ticket=…&secret=…&name=…` code; null for anything else. */
export function parsePairingUrl(raw: string): PairingCode | null {
  const text = raw.trim()
  const match = /^tetramote:\/\/pair\?(.*)$/i.exec(text)
  if (!match) return null
  const params = new Map<string, string>()
  for (const part of match[1].split("&")) {
    const eq = part.indexOf("=")
    if (eq <= 0) continue
    try {
      params.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " ")))
    } catch {
      return null
    }
  }
  return pairingFromParams({ticket: params.get("ticket"), secret: params.get("secret"), name: params.get("name")})
}

export function pairingFromParams(params: {ticket?: unknown; secret?: unknown; name?: unknown}): PairingCode | null {
  const ticket = typeof params.ticket === "string" ? params.ticket.trim() : ""
  const secret = typeof params.secret === "string" ? params.secret.trim().toLowerCase() : ""
  const name = typeof params.name === "string" && params.name.trim() ? params.name.trim() : "Computer"
  if (!ticket || !SECRET.test(secret)) return null
  return {ticket, secret, name}
}
