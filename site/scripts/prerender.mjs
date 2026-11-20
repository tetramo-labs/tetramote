/**
 * Runs after `vite build`: renders the page into dist/index.html for crawlers (the browser hydrates it) and
 * writes its Markdown twin to dist/index.md. Components must render without `window` outside effects.
 */
import {readFile, writeFile} from "node:fs/promises"

import {createElement, StrictMode} from "react"
import {renderToString} from "react-dom/server"
import {createServer} from "vite"

const dist = new URL("../dist/", import.meta.url)
const vite = await createServer({
  server: {middlewareMode: true, hmr: false},
  appType: "custom",
  logLevel: "error",
  optimizeDeps: {noDiscovery: true},
})

try {
  const {
    default: App,
    lede,
    phoneNote,
    steps,
    features,
    privacy,
    downloads,
    faq,
  } = await vite.ssrLoadModule("/src/App.jsx")
  const {REPO, LATEST} = await vite.ssrLoadModule("/src/downloads.js")
  const page = new URL("index.html", dist)
  const html = await readFile(page, "utf8")
  const mount = '<div id="root"></div>'
  if (!html.includes(mount)) throw new Error(`dist/index.html has no empty ${mount}`)
  const body = renderToString(createElement(StrictMode, null, createElement(App)))
  await writeFile(page, html.replace(mount, `<div id="root">${body}</div>`))
  await writeFile(
    new URL("index.md", dist),
    markdown({lede, phoneNote, steps, features, privacy, downloads, faq, REPO, LATEST}),
  )
} finally {
  await vite.close()
}

function markdown({lede, phoneNote, steps, features, privacy, downloads, faq, REPO, LATEST}) {
  return `# Tetramote

Control your computer from your phone. ${lede}

## Pair once, then connect from anywhere

${steps.map((step, i) => `${i + 1}. **${step.title}.** ${step.body}`).join("\n")}

## What it does

${features.map((feature) => `- **${feature.title}.** ${feature.body}`).join("\n")}

## There's no account and no Tetramote server

Tetramote connects your devices with [iroh](https://iroh.computer). Every connection is end-to-end encrypted QUIC and goes direct whenever the networks allow it. When they don't, traffic passes through n0's public relays, or a relay you run yourself, which see only encrypted packets.

${privacy.map((fact) => `- ${fact}`).join("\n")}

## Download

${downloads.map((platform) => `- **${platform.name}.** ${platform.details}`).join("\n")}
- **iPhone and Android.** ${phoneNote}

Downloads: ${LATEST}
Source: ${REPO}

## Questions

${faq.map((item) => `### ${item.q}\n\n${item.a}`).join("\n\n")}
`
}
