import {resolve} from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import {defineConfig} from "vitest/config"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {alias: {"@": resolve(import.meta.dirname, "src")}},
  server: {port: 1420, strictPort: true},
  build: {
    target: "safari16",
    rollupOptions: {
      input: {main: resolve(import.meta.dirname, "index.html"), viewer: resolve(import.meta.dirname, "viewer.html")},
    },
  },
  test: {environment: "node"},
})
