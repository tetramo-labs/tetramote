#!/usr/bin/env zx
// zx scripts/screenshots-ios.mjs [--device iphone-6.9|iphone-duo|all] [--skip-build] [--app <path>] [--sim <udid>]
//   [--keep-booted] [--port <n>]
// Captures raw App Store screenshots into screenshots/raw/<slug>/ by running .maestro/flows/screenshots.yaml
// against a fake host that streams site/scripts/screenshots/desktop.html. Frame them with frame-screenshots.mjs.
import {createServer} from "node:http"
import os from "node:os"

import {$, argv, cd, chalk, fs, glob, path, sleep} from "zx"

import {selectNewestXcode} from "./xcode.mjs"

$.verbose = false
const app = path.resolve(import.meta.dirname, "..")
const repo = path.resolve(app, "..")
cd(app)

const OUT_DIR = "screenshots/raw"
const PRODUCTS = "ios/build/Build/Products/Release-iphonesimulator"
const FAKEHOST = path.join(repo, "core/target/release/examples/fakehost")
const DESKTOP_HTML = path.join(repo, "site/scripts/screenshots/desktop.html")
const HOST_NAME = "MacBook Pro"
const FLOW = ".maestro/flows/screenshots.yaml"
const POSTURE_SETTLE_MS = 2500
const STATUS_BAR = [
  "--time",
  "9:41",
  "--dataNetwork",
  "wifi",
  "--wifiMode",
  "active",
  "--wifiBars",
  "3",
  "--cellularMode",
  "active",
  "--cellularBars",
  "4",
  "--batteryState",
  "discharging",
  "--batteryLevel",
  "100",
]

/** Each capture's `expect` is that display's native pixel size; a capture with `only` is taken for those shots alone. */
const DEVICES = [
  {
    slug: "iphone-6.9",
    label: 'iPhone 6.9"',
    phoneName: "iPhone",
    pick: /^iPhone (\d+) Pro Max$/,
    captures: [{slug: "iphone-6.9", expect: [1320, 2868]}],
  },
  {
    slug: "iphone-duo",
    label: "iPhone Duo",
    phoneName: "iPhone Duo",
    pick: /^iPhone Duo$/,
    foldable: true,
    captures: [
      {slug: "iphone-duo-cover", posture: ["close", "portrait"], expect: [1398, 2034]},
      {slug: "iphone-duo-open", posture: ["open", "landscape"], expect: [2853, 2007], only: ["01-session"]},
      {slug: "iphone-duo-half", posture: ["half", "portrait"], expect: [2007, 2853], only: ["01-session"]},
    ],
  },
]

const wanted = argv.device && argv.device !== "all" ? String(argv.device).split(",") : DEVICES.map((d) => d.slug)
const devices = DEVICES.filter((d) => wanted.includes(d.slug))
if (devices.length !== wanted.length) {
  console.error(
    chalk.red(`Unknown --device ${argv.device}. Use one of: ${DEVICES.map((d) => d.slug).join(", ")}, all.`),
  )
  process.exit(1)
}
if (argv.sim && devices.length !== 1) {
  console.error(chalk.red("--sim needs a single --device, since one simulator is one device type."))
  process.exit(1)
}

async function plistValue(plist, key) {
  const out = await $({nothrow: true})`/usr/libexec/PlistBuddy -c ${`Print :${key}`} ${plist}`
  return out.exitCode === 0 ? out.stdout.trim() : null
}

async function imageSize(file) {
  const out = await $({nothrow: true})`sips -g pixelWidth -g pixelHeight ${file}`
  return [Number(out.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]), Number(out.stdout.match(/pixelHeight:\s*(\d+)/)?.[1])]
}

async function newest(paths) {
  const stats = await Promise.all(paths.map(async (p) => ({p, mtime: (await fs.stat(p)).mtimeMs})))
  return stats.sort((a, b) => b.mtime - a.mtime)[0]?.p ?? null
}

/** Mirrors `bun ios --release --simulator` without installing; the Duo needs the iOS 27.1 SDK or later. */
async function buildApp() {
  if (!(await fs.pathExists("modules/remote/ios/TetraCore.xcframework")))
    await $({stdio: "inherit"})`../scripts/build-core.sh ios`
  if (!(await fs.pathExists("ios"))) await $({stdio: "inherit"})`bunx expo prebuild --platform ios`
  await $({stdio: "inherit"})`xcodebuild -workspace ios/Tetramote.xcworkspace -scheme Tetramote -configuration Release \
    -destination ${"generic/platform=iOS Simulator"} -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build`
  return newest(await glob(`${PRODUCTS}/*.app`, {onlyDirectories: true}))
}

async function resolveApp() {
  if (argv.app) return path.resolve(String(argv.app))
  if (!argv["skip-build"]) return buildApp()
  const derived = path.join(os.homedir(), "Library/Developer/Xcode/DerivedData")
  return newest([
    ...(await glob(`${PRODUCTS}/*.app`, {onlyDirectories: true})),
    ...(await glob(`${derived}/Tetramote-*/Build/Products/Release-iphonesimulator/Tetramote.app`, {
      onlyDirectories: true,
    })),
  ])
}

async function browserPath() {
  const candidates = [
    process.env.CHROME,
    "/Applications/Helium.app/Contents/MacOS/Helium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ]
  for (const c of candidates) if (c && (await fs.pathExists(c))) return c
  throw new Error("No Chromium browser found: install Helium or Chrome, or set CHROME to a Chromium binary.")
}

/** Renders the mock desktop at 2048×1280 and loops it as the Annex B H.264 (with AUDs) the fake host streams. */
async function makeDesktopStream(dir) {
  await fs.copy(DESKTOP_HTML, path.join(dir, "desktop.html"))
  const png = path.join(dir, "desktop.png")
  await $({
    nothrow: true,
    quiet: true,
  })`${await browserPath()} --headless=new --disable-gpu --hide-scrollbars --no-first-run \
    ${`--user-data-dir=${dir}/profile`} --window-size=1024,640 --force-device-scale-factor=2 \
    ${`--screenshot=${png}`} ${`file://${dir}/desktop.html`}`
  if (!(await fs.pathExists(png)))
    throw new Error(`Rendering ${DESKTOP_HTML} failed: run the browser by hand to see why.`)
  const h264 = path.join(dir, "desktop.h264")
  await $`ffmpeg -y -loglevel error -loop 1 -i ${png} -t 4 -r 30 -vf format=yuv420p -c:v libx264 -bf 0 -g 30 \
    -x264-params aud=1:repeat-headers=1 -f h264 ${h264}`
  return h264
}

async function startFakeHost(dir) {
  if (!(await fs.pathExists(FAKEHOST))) {
    if (argv["skip-build"]) throw new Error(`${FAKEHOST} is missing: run without --skip-build to build it.`)
    await $({
      stdio: "inherit",
      cwd: path.join(repo, "core"),
      env: {...process.env, CARGO_BUILD_JOBS: "2"},
    })`cargo build --release --example fakehost`
  }
  const h264 = await makeDesktopStream(dir)
  const pairingFile = path.join(dir, "pair.txt")
  const log = path.join(dir, "events.log")
  const proc = $({
    nothrow: true,
  })`${FAKEHOST} --h264 ${h264} --name ${HOST_NAME} --pairing-file ${pairingFile} --log ${log}`
  for (let i = 0; i < 60 && !(await fs.pathExists(pairingFile)); i++) await sleep(500)
  if (!(await fs.pathExists(pairingFile))) {
    proc.kill()
    throw new Error("The fake host wrote no pairing link within 30 s: run it by hand to see why.")
  }
  const url = (await fs.readFile(pairingFile, "utf8")).trim()
  return {proc, url, log}
}

async function peerConnections(log) {
  const text = await fs.readFile(log, "utf8").catch(() => "")
  return text.split("\n").filter((l) => l.includes('"type":"peerConnected"')).length
}

const versionKey = (v) => v.split(".").map(Number)
const compareVersions = (a, b) => {
  const [x, y] = [versionKey(a), versionKey(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/** The newest device type matching `pick` on the newest runtime that has one: the Duo needs 27.1, the phones 27.0. */
function findDeviceType(device, runtimes) {
  for (const runtime of runtimes) {
    const match = runtime.supportedDeviceTypes
      .map((d) => ({name: d.name, id: d.identifier, match: d.name.match(device.pick)}))
      .filter((d) => d.match)
      .map((d) => ({name: d.name, id: d.id, gen: Number(d.match[1] ?? 0)}))
      .sort((a, b) => b.gen - a.gen)[0]
    if (match) return {...match, runtime}
  }
  return null
}

async function listDevices() {
  const json = JSON.parse((await $`xcrun simctl list devices -j`).stdout)
  return Object.entries(json.devices).flatMap(([runtime, list]) => list.map((d) => ({...d, runtime})))
}

/** Reuses `tetramote-shots-<slug>`, recreating it when the newest Xcode would pick another device type or runtime. */
async function ensureSimulator(device, runtimes) {
  if (argv.sim) {
    const found = (await listDevices()).find((d) => d.udid === argv.sim)
    if (!found) throw new Error(`No simulator ${argv.sim}: list them with xcrun simctl list devices.`)
    const typeName = (
      JSON.parse((await $`xcrun simctl list devicetypes -j`).stdout).devicetypes.find(
        (t) => t.identifier === found.deviceTypeIdentifier,
      ) ?? {}
    ).name
    if (!device.pick.test(typeName ?? "")) throw new Error(`${found.name} is a ${typeName}, not a ${device.label}.`)
    return {udid: found.udid, name: found.name, booted: found.state === "Booted"}
  }
  const dt = findDeviceType(device, runtimes)
  if (!dt)
    throw new Error(`No installed runtime supports ${device.label}: install one under Xcode > Settings > Components.`)
  const name = `tetramote-shots-${device.slug}`
  let sim = (await listDevices()).find((d) => d.name === name && d.isAvailable !== false)
  if (sim && (sim.deviceTypeIdentifier !== dt.id || sim.runtime !== dt.runtime.identifier)) {
    await $({nothrow: true})`xcrun simctl shutdown ${sim.udid}`
    await $({nothrow: true})`xcrun simctl delete ${sim.udid}`
    sim = null
  }
  if (!sim) {
    console.log(chalk.cyan(`  Creating ${name} (${dt.name}, ${dt.runtime.name})`))
    const udid = (await $`xcrun simctl create ${name} ${dt.id} ${dt.runtime.identifier}`).stdout.trim()
    return {udid, name, booted: false}
  }
  return {udid: sim.udid, name, booted: sim.state === "Booted"}
}

async function duoctl(udid, ...args) {
  const out = await $({nothrow: true})`duoctl -d ${udid} ${args}`
  if (out.exitCode !== 0) throw new Error(`duoctl ${args.join(" ")} failed: ${out.stderr.trim() || out.stdout.trim()}`)
  return out.stdout
}

/** duoctl rotate does not always take on the first try, so it repeats until the state reports the orientation. */
async function setPosture(udid, [hinge, orientation]) {
  await duoctl(udid, hinge)
  await sleep(1000)
  for (let i = 0; i < 5; i++) {
    const state = JSON.parse(await duoctl(udid, "state"))
    if (state.orientation === orientation) break
    if (i === 4) throw new Error(`The Duo stayed ${state.orientation} after ${hinge}; wanted ${orientation}.`)
    await $({nothrow: true})`duoctl -d ${udid} rotate ${orientation}`
    await sleep(1000)
  }
  await sleep(POSTURE_SETTLE_MS)
}

async function screencap(udid, dest, foldable) {
  await fs.ensureDir(path.dirname(dest))
  const out = foldable
    ? await $({nothrow: true})`duoctl -d ${udid} screenshot ${dest}`
    : await $({nothrow: true})`xcrun simctl io ${udid} screenshot ${dest}`
  return out.exitCode === 0 && (await fs.pathExists(dest))
}

let current = null
const captured = []

async function captureAll(name) {
  const {udid, device} = current
  for (const cap of device.captures.filter((c) => !c.only || c.only.includes(name))) {
    if (cap.posture) await setPosture(udid, cap.posture)
    const dest = path.join(OUT_DIR, cap.slug, `${name}.png`)
    if (await screencap(udid, dest, device.foldable)) {
      captured.push({file: dest, expect: cap.expect})
      console.log(chalk.gray(`  captured ${cap.slug}/${name}`))
    } else {
      console.warn(chalk.yellow(`  capture failed: ${cap.slug}/${name}`))
    }
  }
  if (device.foldable) await setPosture(udid, device.captures[0].posture)
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost")
  if (url.pathname !== "/capture") return res.writeHead(404).end()
  captureAll(url.searchParams.get("name") || `shot-${captured.length + 1}`)
    .then(() => res.writeHead(200).end("ok"))
    .catch((err) => {
      console.error(chalk.red(`  ${err.message}`))
      res.writeHead(500).end(String(err))
    })
})
const port = Number(argv.port ?? 8479)
await new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve))

await selectNewestXcode()
const runtimes = JSON.parse((await $`xcrun simctl list runtimes -j`).stdout)
  .runtimes.filter((r) => r.platform === "iOS" && r.isAvailable)
  .sort((a, b) => compareVersions(b.version, a.version))

const appPath = await resolveApp()
if (!appPath || !(await fs.pathExists(appPath))) {
  console.error(chalk.red("No Release simulator build of Tetramote found: run without --skip-build, or pass --app."))
  process.exit(1)
}
const bundleId = (await plistValue(path.join(appPath, "Info.plist"), "CFBundleIdentifier")) ?? "com.tetramo.tetramote"
console.log(chalk.gray(`App: ${appPath} (${bundleId})`))

const work = await fs.mkdtemp(path.join(os.tmpdir(), "tetramote-shots-"))
let host = null
let failed = 0
const bootedHere = []
try {
  host = await startFakeHost(work)
  console.log(chalk.gray(`Fake host "${HOST_NAME}" is up`))
  for (const device of devices) {
    console.log(chalk.bold.cyan(`\n=== ${device.label} ===`))
    const sim = await ensureSimulator(device, runtimes)
    if (!sim.booted) {
      await $({nothrow: true})`xcrun simctl boot ${sim.udid}`
      bootedHere.push(sim.udid)
    }
    await $`xcrun simctl bootstatus ${sim.udid} -b`
    await $`xcrun simctl ui ${sim.udid} appearance dark`
    await $`xcrun simctl status_bar ${sim.udid} override ${STATUS_BAR}`
    await $`xcrun simctl install ${sim.udid} ${appPath}`
    console.log(chalk.gray(`  ${sim.name} (${sim.udid})`))
    if (device.foldable) await setPosture(sim.udid, device.captures[0].posture)
    for (const cap of device.captures) await fs.emptyDir(path.join(OUT_DIR, cap.slug))

    current = {udid: sim.udid, device}
    const before = await peerConnections(host.log)
    const result = await $({stdio: "inherit", nothrow: true})`maestro --device ${sim.udid} test ${FLOW} \
      -e ${`MAESTRO_APP_ID=${bundleId}`} -e ${`PAIR_URL=${host.url}`} -e ${`PHONE_NAME=${device.phoneName}`} -e ${`CAPTURE_URL=http://localhost:${port}`}`
    if ((await peerConnections(host.log)) === before)
      console.warn(chalk.yellow("  The app never connected to the fake host."))
    if (result.exitCode !== 0) {
      failed++
      console.warn(chalk.yellow(`  ${FLOW} failed on ${device.slug}; captures up to the failure are kept.`))
    }
  }
} finally {
  server.close()
  host?.proc.kill()
  await fs.remove(work)
  if (!argv["keep-booted"]) for (const udid of bootedHere) await $({nothrow: true})`xcrun simctl shutdown ${udid}`
}

let mismatched = 0
for (const {file, expect} of captured) {
  const [w, h] = await imageSize(file)
  if (w === expect[0] && h === expect[1]) continue
  mismatched++
  console.warn(chalk.yellow(`  ${file} is ${w}x${h}, expected ${expect.join("x")}`))
}
console.log(chalk.cyan(`\nCaptured ${captured.length} screenshot(s) in ${OUT_DIR}`))
if (captured.length === 0 || failed > 0 || mismatched > 0) process.exit(1)
