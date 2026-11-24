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
    androidNote,
    steps,
    features,
    downloads,
    faq,
  } = await vite.ssrLoadModule("/src/App.jsx")
  const {REPO, LATEST, APP_STORE} = await vite.ssrLoadModule("/src/downloads.js")
  const page = new URL("index.html", dist)
  const html = await readFile(page, "utf8")
  const mount = '<div id="root"></div>'
  if (!html.includes(mount)) throw new Error(`dist/index.html has no empty ${mount}`)
  const body = renderToString(createElement(StrictMode, null, createElement(App)))
  await writeFile(page, html.replace(mount, `<div id="root">${body}</div>`))
  await writeFile(
    new URL("index.md", dist),
    markdown({lede, phoneNote, androidNote, steps, features, downloads, faq, REPO, LATEST, APP_STORE}),
  )
} finally {
  await vite.close()
}

function markdown({lede, phoneNote, androidNote, steps, features, downloads, faq, REPO, LATEST, APP_STORE}) {
  return `# Tetramote

Control your computer from your phone. ${lede}

## Pair once, then connect from anywhere

${steps.map((step, i) => `${i + 1}. **${step.title}.** ${step.body}`).join("\n")}

## What it does

${features.map((feature) => `- **${feature.title}.** ${feature.body}`).join("\n")}

## Download

${downloads.map((platform) => `- **${platform.name}.** ${platform.details}`).join("\n")}
- **iPhone.** ${phoneNote} ${APP_STORE}
- **Android.** ${androidNote}

Downloads: ${LATEST}
Source: ${REPO}

## Questions

${faq.map((item) => `### ${item.q}\n\n${item.a}`).join("\n\n")}
`
}
