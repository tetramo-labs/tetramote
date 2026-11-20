import assert from "node:assert/strict"
import {access, readFile} from "node:fs/promises"
import test from "node:test"

import {preview} from "vite"

import {LATEST, detectPlatform, latestRelease, pickAssets} from "../src/downloads.js"

const dist = new URL("../dist/", import.meta.url)
const read = (path) => readFile(new URL(path, dist), "utf8")

const releaseAssets = [
  "latest.json",
  "Tetramote_0.4.0_amd64.AppImage",
  "Tetramote_0.4.0_amd64.AppImage.sig",
  "Tetramote_0.4.0_amd64.deb",
  "Tetramote_0.4.0_amd64.deb.sig",
  "Tetramote_0.4.0_universal.dmg",
  "Tetramote_0.4.0_x64-setup.exe",
  "Tetramote_0.4.0_x64-setup.exe.sig",
  "Tetramote_universal.app.tar.gz",
  "Tetramote_universal.app.tar.gz.sig",
].map((name) => ({name, browser_download_url: `https://example.test/${name}`}))

test("detectPlatform reads desktop and phone user agents", () => {
  assert.equal(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"), "mac")
  assert.equal(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"), "windows")
  assert.equal(detectPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"), "linux")
  assert.equal(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 27_1 like Mac OS X) AppleWebKit/605.1.15"), "phone")
  assert.equal(detectPlatform("Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36"), "phone")
  assert.equal(detectPlatform(""), null)
})

test("pickAssets links each installer and skips signatures and updater archives", () => {
  assert.deepEqual(pickAssets(releaseAssets), {
    mac: "https://example.test/Tetramote_0.4.0_universal.dmg",
    windows: "https://example.test/Tetramote_0.4.0_x64-setup.exe",
    appimage: "https://example.test/Tetramote_0.4.0_amd64.AppImage",
    deb: "https://example.test/Tetramote_0.4.0_amd64.deb",
  })
  assert.deepEqual(pickAssets([releaseAssets[5]]), {
    mac: "https://example.test/Tetramote_0.4.0_universal.dmg",
    windows: LATEST,
    appimage: LATEST,
    deb: LATEST,
  })
})

test("latestRelease returns the version and links, or null when GitHub fails", async () => {
  const ok = async () => ({ok: true, json: async () => ({tag_name: "v0.4.0", assets: releaseAssets})})
  const release = await latestRelease(ok)
  assert.equal(release.version, "0.4.0")
  assert.equal(release.links.deb, "https://example.test/Tetramote_0.4.0_amd64.deb")
  assert.equal(await latestRelease(async () => ({ok: false, status: 403})), null)
  assert.equal(
    await latestRelease(async () => {
      throw new TypeError("Failed to fetch")
    }),
    null,
  )
})

test("the build prerenders the page and writes its Markdown twin", async () => {
  const html = await read("index.html")
  assert.match(html, /<h1[^>]*>Control your computer from your phone\.<\/h1>/)
  assert.match(html, /<link rel="canonical" href="https:\/\/tetramote\.com\/"/)
  assert.match(html, /href="https:\/\/github\.com\/tetramo-labs\/tetramote\/releases\/latest"/)
  for (const asset of ["og.png", "favicon.ico", "favicon.svg", "apple-touch-icon.png", "icon-512.png"]) {
    await access(new URL(asset, dist))
  }
  for (const [, src] of html.matchAll(/<img[^>]+src="\/([^"]+)"/g)) await access(new URL(src, dist))
  const markdown = await read("index.md")
  assert.ok(markdown.startsWith("# Tetramote\n"))
  assert.match(markdown, /## Pair once, then connect from anywhere/)
  assert.match(await read("_headers"), /\/\*\.md\n {2}Content-Type: text\/markdown/)
  assert.match(await read("robots.txt"), /Sitemap: https:\/\/tetramote\.com\/sitemap\.xml/)
})

test("preview serves the page, its Markdown twin and a 404 for unknown paths", async (t) => {
  const server = await preview({preview: {host: "127.0.0.1", port: 0}, logLevel: "silent"})
  t.after(() => new Promise((resolve) => server.httpServer.close(resolve)))
  const base = server.resolvedUrls.local[0]
  const home = await fetch(base)
  assert.equal(home.status, 200)
  assert.match(await home.text(), /Pair once, then connect from anywhere/)
  assert.equal((await fetch(new URL("index.md", base))).status, 200)
  const missing = await fetch(new URL("no-such-page", base))
  assert.equal(missing.status, 404)
  assert.match(await missing.text(), /Page not found/)
})
