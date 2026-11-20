import {readFileSync} from "node:fs"
import {resolve} from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import type {PreviewServer} from "vite"
import {defineConfig} from "vitest/config"

/** `vite preview` sends public/_headers' site-wide headers too, so the CSP is checked before Cloudflare serves it. */
function siteHeaders(server: PreviewServer) {
  const lines = readFileSync(resolve(import.meta.dirname, "public/_headers"), "utf8").split("\n")
  const start = lines.indexOf("/*")
  const headers: [string, string][] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  ")) break
    const colon = line.indexOf(":")
    headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()])
  }
  server.middlewares.use((_request, response, next) => {
    for (const [name, value] of headers) response.setHeader(name, value)
    next()
  })
}

export default defineConfig({
  plugins: [react(), tailwindcss(), {name: "site-headers", configurePreviewServer: siteHeaders}],
  resolve: {alias: {"@": resolve(import.meta.dirname, "src")}},
  build: {target: "safari16"},
  test: {environment: "node"},
})
