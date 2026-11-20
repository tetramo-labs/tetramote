export interface Link {
  endpointId: string
  secret: string
  name: string
}

const HOST = "remote.tetramote.com"
const ID = /^[0-9a-f]{64}$/
const SECRET = /^[0-9a-f]{32}$/

/** The `id`, `secret` and `name` after `#`, as `core/src/link.rs` writes them; null when either value is malformed. */
export function parseFragment(fragment: string): Link | null {
  const params = new Map<string, string>()
  for (const part of fragment.replace(/^#/, "").split("&")) {
    const eq = part.indexOf("=")
    if (eq <= 0) continue
    try {
      params.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " ")))
    } catch {
      return null
    }
  }
  const endpointId = params.get("id")?.trim().toLowerCase() ?? ""
  const secret = params.get("secret")?.trim().toLowerCase() ?? ""
  if (!ID.test(endpointId) || !SECRET.test(secret)) return null
  return {endpointId, secret, name: params.get("name")?.trim() || "Computer"}
}

/** A pasted or scanned link: `https://remote.tetramote.com/#…`, with or without its scheme or trailing slash. */
export function parseLink(text: string): Link | null {
  const trimmed = text.trim()
  const hash = trimmed.indexOf("#")
  if (hash < 0) return null
  const location = trimmed
    .slice(0, hash)
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
  if (location.toLowerCase() !== HOST) return null
  return parseFragment(trimmed.slice(hash + 1))
}

export function fragmentFor(link: Link): string {
  return `#id=${link.endpointId}&secret=${link.secret}&name=${encodeURIComponent(link.name)}`
}
