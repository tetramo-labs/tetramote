#!/usr/bin/env zx
// bun ios-release [--upload] [--archive-only] [--skip-build] [--skip-core]
// Archives the App Store build and exports a signed IPA under build/; --upload sends it to App Store Connect.
// Signing comes from asc (`asc doctor`), not an Xcode account: the distribution key must be in a keychain.
import {existsSync} from "node:fs"

import {$, argv, cd, fs, os, path} from "zx"

import {selectNewestXcode} from "./xcode.mjs"

const BUNDLE_ID = "com.tetramo.tetramote"
const TEAM_ID = "B8446S9493"
const PROFILE_NAME = "Tetramote App Store"

$.verbose = true
const app = path.resolve(import.meta.dirname, "..")
cd(app)

const upload = Boolean(argv.upload)
const archiveOnly = Boolean(argv["archive-only"])
const skipBuild = Boolean(argv["skip-build"])
if (archiveOnly && skipBuild) fail("--archive-only builds the archive, so it cannot be combined with --skip-build.")
if (archiveOnly && upload) fail("--archive-only stops before the export, so it cannot be combined with --upload.")

const buildDir = path.resolve("build")
const archivePath = path.join(buildDir, "Tetramote.xcarchive")
const exportPath = path.join(buildDir, "ios-export")
const derivedDataPath = path.resolve(process.env.IOS_DERIVED_DATA_PATH || path.join(buildDir, "DerivedData"))
const pbxproj = path.resolve("ios/Tetramote.xcodeproj/project.pbxproj")

function fail(message) {
  console.error(`\n${message}`)
  process.exit(1)
}

async function json(command) {
  return JSON.parse((await command.quiet()).stdout)
}

/** The commit count unless TETRAMOTE_BUILD_NUMBER pins it, the same rule app.config.ts uses. */
async function buildNumber() {
  const pinned = process.env.TETRAMOTE_BUILD_NUMBER?.trim()
  if (pinned) {
    if (!/^[1-9]\d*$/.test(pinned))
      fail(`TETRAMOTE_BUILD_NUMBER=${pinned} is not a positive integer. Unset it or fix it.`)
    return pinned
  }
  return (await $`git rev-list --count HEAD`.quiet()).stdout.trim()
}

async function plistValue(plist, key) {
  return (await $`plutil -extract ${key} raw ${plist}`.quiet()).stdout.trim()
}

/**
 * Downloads and installs an active, manually managed App Store profile for the app, creating
 * "Tetramote App Store" from every distribution certificate when the account has none. Returns its name.
 */
async function installAppStoreProfile() {
  const signingDir = path.join(buildDir, "signing")
  await fs.emptyDir(signingDir)
  const bundleIds = await json($`asc bundle-ids list --paginate`)
  const bundle = bundleIds.data?.find((b) => b.attributes.identifier === BUNDLE_ID)
  if (!bundle)
    fail(`No App Store Connect bundle ID for ${BUNDLE_ID}. Create it with asc bundle-ids create, then retry.`)

  const linked = await json($`asc bundle-ids profiles list --id ${bundle.id} --paginate`)
  const candidates = (linked.data ?? [])
    .filter((p) => p.attributes.profileType === "IOS_APP_STORE" && p.attributes.profileState === "ACTIVE")
    .sort((a, b) => Number(b.attributes.name === PROFILE_NAME) - Number(a.attributes.name === PROFILE_NAME))
  for (const profile of candidates) {
    const installed = await installProfile(profile.id, signingDir)
    if (installed) return installed
  }

  console.log(`No manually managed App Store profile for ${BUNDLE_ID}; creating "${PROFILE_NAME}"`)
  const certificates = await json($`asc certificates list --certificate-type IOS_DISTRIBUTION,DISTRIBUTION --paginate`)
  const certificateIds = (certificates.data ?? []).map((c) => c.id)
  if (!certificateIds.length) fail("App Store Connect has no distribution certificate. Create one, then retry.")
  const created = await json(
    $`asc profiles create --name ${PROFILE_NAME} --profile-type IOS_APP_STORE --bundle ${bundle.id} --certificate ${certificateIds.join(",")}`,
  )
  console.log(`Created profile "${PROFILE_NAME}" (${created.data.id})`)
  return (
    (await installProfile(created.data.id, signingDir)) ?? fail(`Profile ${created.data.id} could not be installed.`)
  )
}

/** Installs a profile where Xcode looks for it, keyed by UUID; returns null for Xcode-managed ones, which manual signing rejects. */
async function installProfile(id, signingDir) {
  const file = path.join(signingDir, `${id}.mobileprovision`)
  await $`asc profiles download --id ${id} --output ${file}`.quiet()
  const decoded = path.join(signingDir, `${id}.plist`)
  await $`security cms -D -i ${file} -o ${decoded}`.quiet()
  if ((await plistValue(decoded, "IsXcodeManaged")) === "true") return null
  const uuid = await plistValue(decoded, "UUID")
  const name = await plistValue(decoded, "Name")
  const profiles = path.join(os.homedir(), "Library/Developer/Xcode/UserData/Provisioning Profiles")
  await fs.copy(file, path.join(profiles, `${uuid}.mobileprovision`), {overwrite: true})
  console.log(`Installed provisioning profile "${name}" (${id}, ${uuid})`)
  return name
}

/** Rubygems lookup for xcodeproj: Homebrew's pod wrapper keeps it in a private GEM_HOME, rbenv's in the active Ruby. */
async function rubyEnv() {
  const pod = (await $({nothrow: true, quiet: true})`command -v pod`).stdout.trim()
  const wrapper = pod ? await fs.readFile(pod, "utf8").catch(() => "") : ""
  const gemHome = wrapper.match(/GEM_HOME=["']?([^"'\s]+)["']?/)?.[1]
  return gemHome ? {...process.env, GEM_HOME: gemHome} : process.env
}

/**
 * Sets manual distribution signing on the app target's Release configuration only: Pods targets
 * reject a provisioning profile, so it cannot go on the xcodebuild command line. Restore the project afterwards.
 */
async function applyAppTargetSigning(profileName) {
  const ruby = `
require 'xcodeproj'
project = Xcodeproj::Project.open(${JSON.stringify(path.dirname(pbxproj))})
target = project.targets.find { |t| t.product_type == 'com.apple.product-type.application' }
abort('[ios-release] no application target in the Xcode project') unless target
config = target.build_configurations.find { |c| c.name == 'Release' }
abort("[ios-release] target #{target.name} has no Release configuration") unless config
settings = config.build_settings
settings['CODE_SIGN_STYLE'] = 'Manual'
settings['DEVELOPMENT_TEAM'] = ${JSON.stringify(TEAM_ID)}
settings['CODE_SIGN_IDENTITY'] = 'iPhone Distribution'
settings['CODE_SIGN_IDENTITY[sdk=iphoneos*]'] = 'iPhone Distribution'
settings['PROVISIONING_PROFILE_SPECIFIER'] = ${JSON.stringify(profileName)}
project.save
puts "[ios-release] signing #{target.name} Release with #{settings['PROVISIONING_PROFILE_SPECIFIER']}"
`
  await $({env: await rubyEnv(), input: ruby})`ruby -`
}

function exportOptions(profileName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>${BUNDLE_ID}</key>
    <string>${profileName}</string>
  </dict>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
  <key>destination</key>
  <string>export</string>
</dict>
</plist>
`
}

async function writeSummary(lines) {
  console.log(`\n${lines.join("\n")}`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.map((l) => `- ${l}`).join("\n")}\n`)
  }
}

await selectNewestXcode()
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version
const archivedPlist = path.join(archivePath, "Products/Applications/Tetramote.app/Info.plist")

const identities = (await $`security find-identity -v -p codesigning`.quiet()).stdout
if (!new RegExp(`(iPhone|Apple) Distribution: .*\\(${TEAM_ID}\\)`).test(identities)) {
  fail(
    `No distribution identity for team ${TEAM_ID} in the keychain search list. Import the .p12 with its private key, then retry.`,
  )
}

await fs.ensureDir(buildDir)
const profileName = await installAppStoreProfile()

let build
if (skipBuild) {
  if (!existsSync(archivedPlist)) fail(`No archive at ${archivePath}. Run bun ios-release without --skip-build.`)
  build = await plistValue(archivedPlist, "CFBundleVersion")
  console.log(`Reusing ${archivePath} (build ${build})`)
} else {
  build = await buildNumber()
  process.env.TETRAMOTE_BUILD_NUMBER = build
  console.log(`Building Tetramote ${version} (${build})`)

  if (!argv["skip-core"] || !existsSync("modules/remote/ios/TetraCore.xcframework")) {
    await $`../scripts/build-core.sh ios`
  }
  await $`bunx expo prebuild --platform ios`
  await fs.writeFile("ios/.xcode.env.local", `export NODE_BINARY=${process.execPath}\n`)

  const pristine = await fs.readFile(pbxproj)
  try {
    await applyAppTargetSigning(profileName)
    await fs.remove(archivePath)
    await $`xcodebuild archive -workspace ios/Tetramote.xcworkspace -scheme Tetramote -configuration Release -destination generic/platform=iOS -archivePath ${archivePath} -derivedDataPath ${derivedDataPath}`
  } finally {
    await fs.writeFile(pbxproj, pristine)
  }
  if (!existsSync(archivedPlist)) fail(`xcodebuild finished but left no app in ${archivePath}. Check the log above.`)
}

if (archiveOnly) {
  await writeSummary([`Tetramote ${version} (${build}) archived`, `Archive: ${archivePath}`])
  process.exit(0)
}

const exportOptionsPlist = path.join(buildDir, "ExportOptions.plist")
await fs.writeFile(exportOptionsPlist, exportOptions(profileName))
await fs.remove(exportPath)
await $`xcodebuild -exportArchive -archivePath ${archivePath} -exportOptionsPlist ${exportOptionsPlist} -exportPath ${exportPath}`
const ipa = path.join(exportPath, "Tetramote.ipa")
if (!existsSync(ipa)) fail(`xcodebuild exported no IPA to ${exportPath}. Check the log above.`)

const unpacked = path.join(buildDir, "ipa-check")
await fs.emptyDir(unpacked)
await $`unzip -q ${ipa} Payload/Tetramote.app/Info.plist -d ${unpacked}`
const ipaPlist = path.join(unpacked, "Payload/Tetramote.app/Info.plist")
const shipped = {
  CFBundleIdentifier: await plistValue(ipaPlist, "CFBundleIdentifier"),
  CFBundleShortVersionString: await plistValue(ipaPlist, "CFBundleShortVersionString"),
  CFBundleVersion: await plistValue(ipaPlist, "CFBundleVersion"),
}
const expected = {CFBundleIdentifier: BUNDLE_ID, CFBundleShortVersionString: version, CFBundleVersion: build}
for (const [key, value] of Object.entries(expected)) {
  if (shipped[key] !== value) {
    fail(`The IPA has ${key} ${shipped[key]}, expected ${value}. Rebuild without --skip-build.`)
  }
}
console.log(`Verified ${ipa}: ${BUNDLE_ID} ${shipped.CFBundleShortVersionString} (${shipped.CFBundleVersion})`)

if (upload) {
  const result = await $({nothrow: true})`asc builds upload --app ${BUNDLE_ID} --ipa ${ipa} --verify-timeout 90s`
  if (result.exitCode !== 0) {
    fail(
      `Uploading ${ipa} failed. Check asc doctor, that the App Store Connect app exists, and that build ${build} is new for ${version}; then rerun with --skip-build --upload.`,
    )
  }
}

await writeSummary([
  `Tetramote ${version} (${build}) exported`,
  `IPA: ${ipa}`,
  `App Store Connect: ${upload ? "uploaded" : "not uploaded"}`,
])
