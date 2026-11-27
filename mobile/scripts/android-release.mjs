#!/usr/bin/env zx
// bun android-release [--skip-core]
// Builds the Google Play bundle at build/android/Tetramote.aab, signed with the upload key in
// ~/.tetramote/credentials/upload-keystore.jks whose password the macOS keychain holds; Play re-signs it.
// CI passes the key and its password as TETRAMOTE_UPLOAD_STORE_FILE and TETRAMOTE_UPLOAD_STORE_PASSWORD.
import {existsSync} from "node:fs"

import {$, argv, cd, fs, path} from "zx"

const KEYSTORE =
  process.env.TETRAMOTE_UPLOAD_STORE_FILE || path.join(process.env.HOME, ".tetramote/credentials/upload-keystore.jks")
const KEYCHAIN_SERVICE = "tetramote-android-upload"

$.verbose = true
const app = path.resolve(import.meta.dirname, "..")
cd(app)

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!existsSync(KEYSTORE)) {
  fail(`No upload keystore at ${KEYSTORE}. Restore it from your backup; Play only accepts bundles signed with it.`)
}
const password =
  process.env.TETRAMOTE_UPLOAD_STORE_PASSWORD ||
  (
    await $({quiet: true, nothrow: true})`security find-generic-password -s ${KEYCHAIN_SERVICE} -a upload-keystore -w`
  ).stdout.trim()
if (!password) {
  fail(
    `The keychain has no ${KEYCHAIN_SERVICE} password. Add it with: security add-generic-password -s ${KEYCHAIN_SERVICE} -a upload-keystore -w`,
  )
}

if (!argv["skip-core"] || !existsSync("modules/remote/android/src/main/jniLibs/arm64-v8a/libtetra_core.so")) {
  await $`../scripts/build-core.sh android`
}
await $`bunx expo prebuild --platform android --clean --no-install`
await $({
  cwd: "android",
  env: {
    ...process.env,
    ORG_GRADLE_PROJECT_TETRAMOTE_UPLOAD_STORE_FILE: KEYSTORE,
    ORG_GRADLE_PROJECT_TETRAMOTE_UPLOAD_STORE_PASSWORD: password,
  },
})`./gradlew bundleRelease`

const built = path.resolve("android/app/build/outputs/bundle/release/app-release.aab")
const out = path.resolve("build/android/Tetramote.aab")
await fs.ensureDir(path.dirname(out))
await fs.copy(built, out)

const signer = (await $({quiet: true})`keytool -printcert -jarfile ${out}`).stdout
const expected = (await $({quiet: true})`keytool -list -v -keystore ${KEYSTORE} -alias upload -storepass ${password}`)
  .stdout
const sha = (text) => text.match(/SHA256:\s*([0-9A-F:]+)/)?.[1]
if (!sha(signer) || sha(signer) !== sha(expected)) {
  fail(
    `${out} isn't signed with the upload key. Check that android/app/build.gradle has the release signing config (bunx expo prebuild --platform android --clean).`,
  )
}
const manifest = (await $({quiet: true})`bunx expo config --type public --json`).stdout
const {version, android} = JSON.parse(manifest)
console.log(`Built ${out}: com.tetramo.tetramote ${version} (${android.versionCode}), signed with the upload key.`)
