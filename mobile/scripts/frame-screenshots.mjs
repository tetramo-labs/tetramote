#!/usr/bin/env zx
// zx scripts/frame-screenshots.mjs [--sets iphone-6.9,iphone-duo]
// Composites screenshots/raw/ (from screenshots-ios.mjs) into store shots in screenshots/framed/<set>/ with
// ImageMagick. A canvas is the raw capture's own size, which App Store Connect takes for that slot, unless the set
// names one (Google Play takes at most 2:1, so the Android set is 1080x1920).
import {$, argv, cd, chalk, fs, os, path} from "zx"

$.verbose = false
cd(path.resolve(import.meta.dirname, ".."))

const RAW_DIR = "screenshots/raw"
const FRAMED_DIR = "screenshots/framed"
const BRAND = "#004dfc"
const BASE = "#171717"
const FONTS = [
  "/Library/Fonts/SF-Pro-Rounded-Semibold.otf",
  path.join(os.homedir(), "Library/Fonts/SF-Pro-Rounded-Semibold.otf"),
  "/System/Library/Fonts/SFNSRounded.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
]

/** `radius` is the screen's corner radius as a fraction of the shot's shorter side; captions break at `\n` on portrait canvases. */
const SETS = [
  {
    slug: "iphone-6.9",
    slides: [
      {
        raw: "iphone-6.9/01-session.png",
        out: "01-session.png",
        caption: "Your computer,\non your phone",
        radius: 0.125,
      },
      {
        raw: "iphone-6.9/05-keyboard.png",
        out: "02-keyboard.png",
        caption: "A full keyboard,\nshortcuts too",
        radius: 0.125,
      },
      {raw: "iphone-6.9/02-home.png", out: "03-home.png", caption: "Your computers,\none tap away", radius: 0.125},
      {raw: "iphone-6.9/03-pair.png", out: "04-pair.png", caption: "Pair once\nwith a code", radius: 0.125},
      {
        raw: "iphone-6.9/04-settings.png",
        out: "05-settings.png",
        caption: "Trackpad or touch,\nyour choice",
        radius: 0.125,
      },
    ],
  },
  {
    slug: "android-phone",
    canvas: [1080, 1920],
    slides: [
      {
        raw: "android-phone/01-session.png",
        out: "01-session.png",
        caption: "Your computer,\non your phone",
        radius: 0.06,
      },
      {
        raw: "android-phone/02-keyboard.png",
        out: "02-keyboard.png",
        caption: "A full keyboard,\nshortcuts too",
        radius: 0.06,
      },
      {raw: "android-phone/03-home.png", out: "03-home.png", caption: "Your computers,\none tap away", radius: 0.06},
      {raw: "android-phone/04-pair.png", out: "04-pair.png", caption: "Pair once\nwith a code", radius: 0.06},
      {
        raw: "android-phone/05-settings.png",
        out: "05-settings.png",
        caption: "Fast or sharp,\nyour choice",
        radius: 0.06,
      },
    ],
  },
  {
    slug: "iphone-duo",
    slides: [
      {raw: "iphone-duo-cover/01-session.png", out: "01-folded.png", caption: "Optimized for\niPhone Duo", radius: 0.1},
      {raw: "iphone-duo-open/01-session.png", out: "02-open.png", caption: "Unfold for the whole screen", radius: 0.04},
      {raw: "iphone-duo-half/01-session.png", out: "03-laptop.png", caption: "Half open,\nit's a laptop", radius: 0.04},
    ],
  },
]

async function imageSize(file) {
  const out = await $`magick identify -format ${"%w %h"} ${file}`
  return out.stdout.trim().split(" ").map(Number)
}

/** A brand-blue glow from above the top edge fading into the dark base. */
function background(w, h) {
  return [
    "-size",
    `${w}x${h}`,
    "-define",
    `gradient:center=${Math.round(w / 2)},${Math.round(-h * 0.08)}`,
    "-define",
    `gradient:radii=${Math.round(Math.max(w, h) * 0.75)},${Math.round(h * 0.9)}`,
    `radial-gradient:${BRAND}-${BASE}`,
  ]
}

async function frame(slide, font, outFile, tmp, canvas) {
  const rawFile = path.join(RAW_DIR, slide.raw)
  const [rw, rh] = await imageSize(rawFile)
  const [w, h] = canvas ?? [rw, rh]
  const landscape = w > h
  const caption = landscape ? slide.caption.replace(/\n/g, " ") : slide.caption
  const lines = caption.split("\n").length
  const pointsize = Math.round(Math.min(w * 0.075, h * 0.05))
  const captionTop = Math.round(h * 0.05)
  const shotTop = Math.round(captionTop + lines * pointsize * 1.25 + pointsize * 0.8)
  const bezel = Math.round(Math.min(w, h) * 0.014)
  const scale = Math.min((w - 2 * Math.round(w * 0.08) - 2 * bezel) / rw, (h - shotTop - h * 0.04 - 2 * bezel) / rh)
  const [sw, sh] = [Math.round(rw * scale), Math.round(rh * scale)]
  const radius = Math.round(Math.min(sw, sh) * slide.radius)
  const [fw, fh, fr] = [sw + 2 * bezel, sh + 2 * bezel, radius + bezel]

  const shot = path.join(tmp, "shot.png")
  const mask = ["(", "+clone", "-fill", "black", "-colorize", "100", "-fill", "white"]
  mask.push("-draw", `roundrectangle 0,0 ${sw - 1},${sh - 1} ${radius},${radius}`, ")")
  const body = ["(", "-size", `${fw}x${fh}`, "xc:none", "-fill", "#050505", "-stroke", "#ffffff2e"]
  body.push("-strokewidth", String(Math.max(2, Math.round(bezel / 6))))
  body.push("-draw", `roundrectangle 1,1 ${fw - 2},${fh - 2} ${fr},${fr}`, ")")
  await $`magick ${rawFile} -resize ${`${sw}x${sh}!`} ${mask} -alpha off -compose CopyOpacity -composite \
    ${body} +swap -gravity center -compose Over -composite ${shot}`

  const blur = Math.round(Math.min(w, h) * 0.025)
  const shadow = [
    "(",
    shot,
    "(",
    "+clone",
    "-background",
    "black",
    "-shadow",
    `60x${blur}+0+${Math.round(blur / 2)}`,
    ")",
  ]
  shadow.push("+swap", "-background", "none", "-layers", "merge", "+repage", ")")
  await $`magick ${background(w, h)} ${shadow} \
    -gravity North -geometry ${`+0+${shotTop - bezel - blur * 2}`} -compose Over -composite \
    -font ${font} -pointsize ${pointsize} -interline-spacing ${Math.round(pointsize * 0.12)} -fill white \
    -gravity North -annotate ${`+0+${captionTop}`} ${caption} -alpha off -depth 8 ${outFile}`

  const [ow, oh] = await imageSize(outFile)
  if (ow !== w || oh !== h) throw new Error(`${outFile} came out ${ow}x${oh}, not the capture's ${w}x${h}.`)
  return [w, h]
}

const wanted = argv.sets ? String(argv.sets).split(",") : SETS.map((s) => s.slug)
const sets = SETS.filter((s) => wanted.includes(s.slug))
if (sets.length !== wanted.length) {
  console.error(chalk.red(`Unknown --sets ${argv.sets}. Use: ${SETS.map((s) => s.slug).join(", ")}`))
  process.exit(1)
}
if ((await $({nothrow: true})`which magick`).exitCode !== 0) {
  console.error(chalk.red("ImageMagick is not installed: brew install imagemagick"))
  process.exit(1)
}
const font = FONTS.find((f) => fs.pathExistsSync(f))
console.log(chalk.gray(`Font: ${font}`))

let failed = 0
for (const set of sets) {
  console.log(chalk.bold.cyan(`\n=== ${set.slug} ===`))
  const missing = set.slides.map((s) => path.join(RAW_DIR, s.raw)).filter((f) => !fs.pathExistsSync(f))
  if (missing.length > 0) {
    console.error(chalk.red(`Missing raw captures (run scripts/screenshots-ios.mjs): ${missing.join(", ")}`))
    failed++
    continue
  }
  const outDir = path.join(FRAMED_DIR, set.slug)
  await fs.emptyDir(outDir)
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tetramote-frame-"))
  try {
    for (const slide of set.slides) {
      const [w, h] = await frame(slide, font, path.join(outDir, slide.out), tmp, set.canvas)
      console.log(chalk.green(`  ${slide.out} @ ${w}x${h}`))
    }
  } catch (err) {
    console.error(chalk.red(`  ${err.message}`))
    failed++
  } finally {
    await fs.remove(tmp)
  }
}
if (failed > 0) process.exit(1)
