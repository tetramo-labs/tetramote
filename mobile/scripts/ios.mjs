#!/usr/bin/env zx
// bun ios [--prebuild] [--build-core] [--release] [--simulator] [--match <device name>]
import {existsSync} from "node:fs"

import {$, argv, cd, path} from "zx"

import {selectNewestXcode} from "./xcode.mjs"

$.verbose = true
const app = path.resolve(import.meta.dirname, "..")
cd(app)
await selectNewestXcode()

if (argv["build-core"] || !existsSync("modules/remote/ios/TetraCore.xcframework")) {
  await $`../scripts/build-core.sh ios`
}
if (argv.prebuild || !existsSync("ios")) {
  await $`bunx expo prebuild --platform ios`
}

const target = argv.simulator ? [] : ["--device", ...(argv.match ? [argv.match] : [])]
const config = argv.release ? ["--configuration", "Release"] : []
await $`bunx expo run:ios ${target} ${config}`
