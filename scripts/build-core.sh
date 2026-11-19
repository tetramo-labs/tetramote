#!/usr/bin/env bash
# Builds core/ for the phone app (the desktop app links it as a Rust crate):
#   ios     -> mobile/modules/remote/ios/TetraCore.xcframework
#   android -> mobile/modules/remote/android/src/main/jniLibs/<abi>/libtetra_core.so
#
# Needs rustup targets aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
# aarch64-linux-android x86_64-linux-android,
# cargo-ndk, and an Android NDK under $ANDROID_HOME/ndk.
set -euo pipefail

# More parallel rustc jobs than this corrupt freshly built proc-macro dylibs
# under the macOS 27 linker ("mis-aligned LINKEDIT string pool").
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE="$ROOT/core"
TARGET_DIR="$CORE/target"
MODULE="$ROOT/mobile/modules/remote"
cd "$CORE"

build_ios() {
  export IPHONEOS_DEPLOYMENT_TARGET=17.0
  for target in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios; do
    cargo build --release --locked --lib --target "$target"
    strip -S -x "$TARGET_DIR/$target/release/libtetra_core.a"
  done
  mkdir -p "$TARGET_DIR/ios-simulator"
  lipo -create \
    "$TARGET_DIR/aarch64-apple-ios-sim/release/libtetra_core.a" \
    "$TARGET_DIR/x86_64-apple-ios/release/libtetra_core.a" \
    -output "$TARGET_DIR/ios-simulator/libtetra_core.a"
  rm -rf "$MODULE/ios/TetraCore.xcframework"
  xcodebuild -create-xcframework \
    -library "$TARGET_DIR/aarch64-apple-ios/release/libtetra_core.a" \
    -library "$TARGET_DIR/ios-simulator/libtetra_core.a" \
    -output "$MODULE/ios/TetraCore.xcframework"
  mkdir -p "$MODULE/ios/include"
  cp "$CORE/include/tetra_core.h" "$CORE/include/module.modulemap" "$MODULE/ios/include/"
}

build_android() {
  if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
    local sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
    ANDROID_NDK_HOME="$sdk/ndk/$(ls "$sdk/ndk" | sort -V | tail -1)"
    export ANDROID_NDK_HOME
  fi
  local jni_libs="$MODULE/android/src/main/jniLibs"
  rm -rf "$jni_libs"
  cargo ndk -t arm64-v8a -t x86_64 -P 28 -o "$jni_libs" build --release --locked --lib
  find "$jni_libs" -name '*.so' ! -name 'libtetra_core.so' -delete
}

case "${1:-all}" in
  ios) build_ios ;;
  android) build_android ;;
  all) build_ios; build_android ;;
  *) echo "usage: $0 [ios|android|all]" >&2; exit 1 ;;
esac
