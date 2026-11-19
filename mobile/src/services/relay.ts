/** Empty means n0's public relays; anything else must be an http(s) URL with a host. */
export function isRelayUrl(value: string): boolean {
  if (!value) return true
  return /^https?:\/\/[^\s/]+(\/\S*)?$/i.test(value)
}
