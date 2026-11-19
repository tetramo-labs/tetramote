import {readdirSync} from "node:fs"

import {$} from "zx"

const versionKey = (v) => v.split(".").map(Number)

function compareVersions(a, b) {
  const [x, y] = [versionKey(a), versionKey(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  }
  return 0
}

/**
 * Points DEVELOPER_DIR at the newest Xcode in /Applications unless it is already set.
 * iOS gives an app the iPhone Duo's full window, status rail included, only when it
 * was linked against the iOS 27.1 SDK or later; an older SDK leaves it in a
 * compatibility window beside the rail.
 */
export async function selectNewestXcode() {
  if (process.env.DEVELOPER_DIR) return process.env.DEVELOPER_DIR
  const candidates = []
  for (const name of readdirSync("/Applications").filter((n) => /^Xcode.*\.app$/.test(n))) {
    const app = `/Applications/${name}`
    const out = await $({
      nothrow: true,
      quiet: true,
    })`/usr/libexec/PlistBuddy -c ${"Print :CFBundleShortVersionString"} ${`${app}/Contents/Info.plist`}`
    if (out.exitCode === 0) candidates.push({app, version: out.stdout.trim()})
  }
  candidates.sort((a, b) => compareVersions(b.version, a.version))
  if (!candidates[0]) throw new Error("No Xcode found in /Applications. Install Xcode 27.1 or later.")
  process.env.DEVELOPER_DIR = `${candidates[0].app}/Contents/Developer`
  console.log(`Xcode ${candidates[0].version} (${candidates[0].app})`)
  return process.env.DEVELOPER_DIR
}
