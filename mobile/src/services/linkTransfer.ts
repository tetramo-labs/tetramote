import * as DocumentPicker from "expo-document-picker"
import {File, Paths} from "expo-file-system"
import * as Sharing from "expo-sharing"

import {makePairingUrl, parsePairingUrl, type PairingCode} from "@/services/pairingUrl"
import type {PairedMac} from "@/stores/hosts"

const FORMAT = "tetramote-links"

/** Only computers paired with a secret this phone still has can be paired again from a link. */
export function linksJson(hosts: PairedMac[], now = new Date()): {json: string; count: number} {
  const computers = hosts
    .filter((h) => h.secret)
    .map((h) => ({name: h.name, link: makePairingUrl({endpointId: h.id, secret: h.secret!, name: h.name})}))
  const json = JSON.stringify({format: FORMAT, version: 1, exportedAt: now.toISOString(), computers}, null, 2)
  return {json, count: computers.length}
}

/** Reads an export, or any JSON array of links or `{link}` objects, keeping each computer once. */
export function parseLinksJson(text: string): PairingCode[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  const items = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as {computers?: unknown}).computers)
      ? (data as {computers: unknown[]}).computers
      : []
  const codes = new Map<string, PairingCode>()
  for (const item of items) {
    const link = typeof item === "string" ? item : (item as {link?: unknown} | null)?.link
    const code = typeof link === "string" ? parsePairingUrl(link) : null
    if (code) codes.set(code.endpointId, code)
  }
  return [...codes.values()]
}

/** Writes the links to a file in the cache and opens the share sheet on it; false when there was nothing to share. */
export async function shareLinks(hosts: PairedMac[], dialogTitle: string): Promise<boolean> {
  const {json, count} = linksJson(hosts)
  if (count === 0) return false
  const file = new File(Paths.cache, "Tetramote links.json")
  file.create({overwrite: true})
  await file.write(json)
  await Sharing.shareAsync(file.uri, {mimeType: "application/json", UTI: "public.json", dialogTitle})
  return true
}

/** Lets the user pick a links file; null when they cancel. */
export async function pickLinks(): Promise<PairingCode[] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "public.json", "text/plain"],
    copyToCacheDirectory: true,
  })
  if (result.canceled || !result.assets[0]) return null
  return parseLinksJson(await new File(result.assets[0].uri).text())
}
