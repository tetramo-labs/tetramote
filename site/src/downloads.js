export const REPO = "https://github.com/tetramo-labs/tetramote"
export const LATEST = `${REPO}/releases/latest`
const API = "https://api.github.com/repos/tetramo-labs/tetramote/releases/latest"

const PATTERNS = {
  mac: /_universal\.dmg$/,
  windows: /-setup\.exe$/,
  appimage: /\.AppImage$/,
  deb: /\.deb$/,
}

/** The visitor's desktop platform from a user agent, "phone" on iOS and Android, or null when unknown. */
export function detectPlatform(userAgent = "") {
  if (/iPhone|iPad|iPod|Android/i.test(userAgent)) return "phone"
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "mac"
  if (/Windows/i.test(userAgent)) return "windows"
  if (/Linux|X11|CrOS/i.test(userAgent)) return "linux"
  return null
}

/** Direct download links from a GitHub release's assets; a missing file falls back to the release page. */
export function pickAssets(assets = []) {
  return Object.fromEntries(
    Object.entries(PATTERNS).map(([key, pattern]) => [
      key,
      assets.find((asset) => pattern.test(asset.name))?.browser_download_url ?? LATEST,
    ]),
  )
}

export const fallbackLinks = pickAssets([])

/** The newest release's version and download links, or null when GitHub can't be reached. */
export async function latestRelease(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(API, {headers: {Accept: "application/vnd.github+json"}})
    if (!response.ok) return null
    const release = await response.json()
    return {version: release.tag_name?.replace(/^v/, "") ?? null, links: pickAssets(release.assets)}
  } catch {
    return null
  }
}
