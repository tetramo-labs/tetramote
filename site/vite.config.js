import {readFileSync} from "node:fs"

import react from "@vitejs/plugin-react"
import {defineConfig} from "vite"

/** Unknown page URLs get public/404.html with a 404 locally, as Cloudflare Pages serves them. */
function notFound(server) {
  server.middlewares.use((request, response, next) => {
    const {pathname} = new URL(request.url, "http://localhost")
    const known =
      pathname === "/" || pathname === "/index.html" || pathname.startsWith("/@") || /\.[^/]*$/.test(pathname)
    if (known) return next()
    response.writeHead(404, {"Content-Type": "text/html; charset=utf-8"})
    response.end(readFileSync(new URL("public/404.html", import.meta.url)))
  })
}

export default defineConfig({
  appType: "mpa",
  plugins: [react(), {name: "not-found", configureServer: notFound, configurePreviewServer: notFound}],
})
