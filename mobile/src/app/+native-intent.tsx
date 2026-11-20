import {parsePairingUrl} from "@/services/pairingUrl"

/** A Tetramote link opened outside the app (the camera, Messages, Safari) goes straight to pairing. */
export function redirectSystemPath({path}: {path: string; initial: boolean}): string {
  const code = parsePairingUrl(path)
  if (!code) return path
  return `/pair?id=${code.endpointId}&secret=${code.secret}&name=${encodeURIComponent(code.name)}`
}
