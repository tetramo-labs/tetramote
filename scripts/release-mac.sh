#!/usr/bin/env bash
# Builds the Mac host and publishes it as a GitHub release that installed copies
# update to through Sparkle:
#
#   scripts/release-mac.sh 0.2.0
#
# Every release carries Tetratop-<version>.zip and appcast.xml; the app's
# SUFeedURL reads appcast.xml from the newest release. CFBundleVersion is the
# commit count, so it only ever grows. Needs a clean, pushed tree, `gh` signed
# in, and the Sparkle EdDSA key in the login Keychain (account "tetratop"; back
# it up with `generate_keys --account tetratop -x <file>`). Updates are signed
# with the Apple Development certificate, not notarized: they install on Macs
# that already run a Tetratop signed the same way.
set -euo pipefail

VERSION="${1:?usage: scripts/release-mac.sh <version, e.g. 0.2.0>}"
REPO="tetramo-labs/tetratop"
TAG="v$VERSION"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAC="$ROOT/mac"
OUT="$MAC/build/release/$VERSION"
SPARKLE_BIN="$MAC/build/SourcePackages/artifacts/sparkle/Sparkle/bin"

if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "The tree has uncommitted changes. Commit them first; a release is built from HEAD." >&2
  exit 1
fi
git -C "$ROOT" fetch -q origin main
if [[ "$(git -C "$ROOT" rev-parse HEAD)" != "$(git -C "$ROOT" rev-parse origin/main)" ]]; then
  echo "HEAD is not origin/main. Push (or pull) first so the release tag points at a published commit." >&2
  exit 1
fi
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Release $TAG already exists. Pick a higher version." >&2
  exit 1
fi

[[ -f "$ROOT/core/target/macos/libtetra_core.a" ]] || "$ROOT/scripts/build-core.sh" macos

BUILD="$(git -C "$ROOT" rev-list --count HEAD)"
cd "$MAC"
xcodegen generate
xcodebuild -project Tetratop.xcodeproj -scheme Tetratop -configuration Release -derivedDataPath build \
  -allowProvisioningUpdates MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD" build

APP="$MAC/build/Build/Products/Release/Tetratop.app"
codesign --verify --deep --strict "$APP"
rm -rf "$OUT"
mkdir -p "$OUT"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/Tetratop-$VERSION.zip"

"$SPARKLE_BIN/generate_appcast" --account tetratop \
  --download-url-prefix "https://github.com/$REPO/releases/download/$TAG/" \
  --link "https://github.com/$REPO" \
  -o "$OUT/appcast.xml" "$OUT"

gh release create "$TAG" --repo "$REPO" --target "$(git -C "$ROOT" rev-parse HEAD)" \
  --title "Tetratop $VERSION" --generate-notes \
  "$OUT/Tetratop-$VERSION.zip" "$OUT/appcast.xml"

echo "Published $TAG (build $BUILD). Feed: https://github.com/$REPO/releases/latest/download/appcast.xml"
