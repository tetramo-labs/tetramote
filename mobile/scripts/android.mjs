#!/usr/bin/env zx
// bun android [--prebuild] [--build-core] [--release] [--emulator]
import {existsSync} from "node:fs"

import {$, argv, cd, path} from "zx"

$.verbose = true
const app = path.resolve(import.meta.dirname, "..")
cd(app)

if (argv["build-core"] || !existsSync("modules/remote/android/src/main/jniLibs/arm64-v8a/libtetra_core.so")) {
  await $`../scripts/build-core.sh android`
}
if (argv.prebuild || !existsSync("android")) {
  await $`bunx expo prebuild --platform android`
}

const target = argv.emulator ? [] : ["--device"]
const variant = argv.release ? ["--variant", "release"] : []
await $`bunx expo run:android ${target} ${variant}`
