#!/usr/bin/env bash
# Publishes a desktop release that every installed copy updates to:
#
#   scripts/release-desktop.sh 0.3.0
#
# 1. Stamps the version into the desktop app, commits and pushes it.
# 2. Builds the universal macOS app here, signed with an Apple Development
#    certificate of team B8446S9493 (the same team as the SwiftUI app, so
#    Sparkle and macOS permissions carry over), and its updater bundle.
# 3. Creates a draft GitHub release with the macOS build, latest.json (Tauri's
#    updater feed) and appcast.xml (Sparkle's, for SwiftUI installs that
#    haven't moved to this app yet).
# 4. Runs .github/workflows/release-desktop.yml to add Windows and Linux,
#    then publishes the release.
#
# Needs a clean, pushed main, gh signed in, the updater key at
# ~/.tauri/tetratop.key, and the Sparkle EdDSA key in the login Keychain
# (account "tetratop").
set -euo pipefail

VERSION="${1:?usage: scripts/release-desktop.sh <version, e.g. 0.3.0>}"
REPO="tetramo-labs/tetratop"
TAG="v$VERSION"
TEAM="B8446S9493"
SPARKLE_VERSION="2.10.1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP="$ROOT/desktop"
OUT="$DESKTOP/target/release-upload/$VERSION"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"

if [[ -n "$(git -C "$ROOT" status --porcelain -- desktop core scripts .github)" ]]; then
  echo "desktop/, core/, scripts/ or .github/ has uncommitted changes. Commit them first; a release is built from HEAD." >&2
  exit 1
fi
git -C "$ROOT" fetch -q origin main
if [[ "$(git -C "$ROOT" rev-parse HEAD)" != "$(git -C "$ROOT" rev-parse origin/main)" ]]; then
  echo "HEAD is not origin/main. Push (or pull) first." >&2
  exit 1
fi
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Release $TAG already exists. Pick a higher version." >&2
  exit 1
fi

IDENTITY="$(python3 - "$TEAM" <<'PY'
import re, subprocess, sys
team = sys.argv[1]
ids = subprocess.run(["security", "find-identity", "-v", "-p", "codesigning"], capture_output=True, text=True).stdout
for sha, name in re.findall(r'\)\s+([0-9A-F]{40})\s+"(Apple Development: [^"]+)"', ids):
    pem = subprocess.run(["security", "find-certificate", "-c", name, "-p", "-Z"], capture_output=True, text=True).stdout
    for block in pem.split("SHA-1 hash: ")[1:]:
        if not block.startswith(sha):
            continue
        cert = block[block.index("-----BEGIN"):]
        subject = subprocess.run(["openssl", "x509", "-noout", "-subject"], input=cert, capture_output=True, text=True).stdout
        if f"OU={team}" in subject.replace(" ", "") or f"OU = {team}" in subject:
            print(sha)
            sys.exit(0)
sys.exit(1)
PY
)" || { echo "No valid Apple Development certificate for team $TEAM in the keychain. Add one in Xcode > Settings > Accounts." >&2; exit 1; }

BUILD="$(git -C "$ROOT" rev-list --count HEAD)"
python3 - "$DESKTOP" "$VERSION" "$((BUILD + 1))" <<'PY'
import json, re, sys
desktop, version, build = sys.argv[1], sys.argv[2], sys.argv[3]
conf_path = f"{desktop}/src-tauri/tauri.conf.json"
conf = json.load(open(conf_path))
conf["version"] = version
conf["bundle"]["macOS"]["bundleVersion"] = build
open(conf_path, "w").write(json.dumps(conf, indent=2) + "\n")
pkg_path = f"{desktop}/package.json"
pkg = json.load(open(pkg_path))
pkg["version"] = version
open(pkg_path, "w").write(json.dumps(pkg, indent=2) + "\n")
cargo_path = f"{desktop}/src-tauri/Cargo.toml"
cargo = open(cargo_path).read()
open(cargo_path, "w").write(re.sub(r'(?m)^version = ".*"$', f'version = "{version}"', cargo, count=1))
PY
(cd "$DESKTOP" && cargo update -p tetratop-desktop --offline >/dev/null 2>&1 || true)
git -C "$ROOT" add desktop/src-tauri/tauri.conf.json desktop/package.json desktop/src-tauri/Cargo.toml desktop/Cargo.lock
if ! git -C "$ROOT" diff --cached --quiet; then
  git -C "$ROOT" commit -q -m "Release desktop $VERSION"
  git -C "$ROOT" push -q origin HEAD:main
fi

rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
export APPLE_SIGNING_IDENTITY="$IDENTITY"
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/tetratop.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
(cd "$DESKTOP" && bun install --frozen-lockfile >/dev/null && CI=true bunx tauri build --target universal-apple-darwin)

BUNDLE="$DESKTOP/target/universal-apple-darwin/release/bundle"
APP="$BUNDLE/macos/Tetratop.app"
codesign --verify --deep --strict "$APP"
rm -rf "$OUT" && mkdir -p "$OUT"
cp "$BUNDLE/macos/Tetratop.app.tar.gz" "$OUT/Tetratop_universal.app.tar.gz"
cp "$BUNDLE/macos/Tetratop.app.tar.gz.sig" "$OUT/Tetratop_universal.app.tar.gz.sig"
cp "$BUNDLE"/dmg/*.dmg "$OUT/Tetratop_${VERSION}_universal.dmg"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/Tetratop-$VERSION-mac.zip"

# The appcast is written here rather than by generate_appcast, which leaves the
# enclosure unsigned because this app has no SUPublicEDKey; SwiftUI installs
# reject an update without the signature.
SPARKLE="${XDG_CACHE_HOME:-$HOME/.cache}/tetratop/sparkle-$SPARKLE_VERSION"
if [[ ! -x "$SPARKLE/bin/sign_update" ]]; then
  mkdir -p "$SPARKLE"
  curl -fsSL "https://github.com/sparkle-project/Sparkle/releases/download/$SPARKLE_VERSION/Sparkle-$SPARKLE_VERSION.tar.xz" | tar -xJ -C "$SPARKLE"
fi
SPARKLE_SIGNATURE="$("$SPARKLE/bin/sign_update" --account tetratop "$OUT/Tetratop-$VERSION-mac.zip")"
[[ "$SPARKLE_SIGNATURE" == *'sparkle:edSignature="'* ]] || { echo "sign_update didn't sign the Sparkle zip: $SPARKLE_SIGNATURE" >&2; exit 1; }
BUILD="$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$APP/Contents/Info.plist")"
python3 - "$OUT/appcast.xml" "$VERSION" "$BUILD" "https://github.com/$REPO" \
  "https://github.com/$REPO/releases/download/$TAG/Tetratop-$VERSION-mac.zip" "$SPARKLE_SIGNATURE" <<'PY'
import email.utils, sys
path, version, build, link, url, signature = sys.argv[1:]
open(path, "w").write(f"""<?xml version="1.0" standalone="yes"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
    <channel>
        <title>Tetratop</title>
        <item>
            <title>{version}</title>
            <pubDate>{email.utils.formatdate(localtime=True)}</pubDate>
            <link>{link}</link>
            <sparkle:version>{build}</sparkle:version>
            <sparkle:shortVersionString>{version}</sparkle:shortVersionString>
            <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
            <enclosure url="{url}" type="application/octet-stream" {signature}/>
        </item>
    </channel>
</rss>
""")
PY

URL="https://github.com/$REPO/releases/download/$TAG/Tetratop_universal.app.tar.gz"
python3 - "$OUT" "$VERSION" "$URL" <<'PY'
import datetime, json, sys
out, version, url = sys.argv[1:]
sig = open(f"{out}/Tetratop_universal.app.tar.gz.sig").read().strip()
entry = {"signature": sig, "url": url}
manifest = {
    "version": version,
    "notes": f"Tetratop {version}",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {"darwin-aarch64": entry, "darwin-x86_64": entry},
}
open(f"{out}/latest.json", "w").write(json.dumps(manifest, indent=2) + "\n")
PY

COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
gh release create "$TAG" --repo "$REPO" --draft --target "$COMMIT" \
  --title "Tetratop $VERSION" --generate-notes \
  "$OUT/Tetratop_universal.app.tar.gz" "$OUT/Tetratop_universal.app.tar.gz.sig" \
  "$OUT/Tetratop_${VERSION}_universal.dmg" "$OUT/Tetratop-$VERSION-mac.zip" \
  "$OUT/appcast.xml" "$OUT/latest.json"
RELEASE_ID="$(gh api "repos/$REPO/releases" --jq ".[] | select(.tag_name == \"$TAG\") | .id" | head -1)"

DISPATCHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
gh workflow run release-desktop.yml --repo "$REPO" --ref main -f commit="$COMMIT" -f release_id="$RELEASE_ID"
RUN=""
for _ in $(seq 1 30); do
  RUN="$(gh run list --repo "$REPO" --workflow release-desktop.yml --limit 5 --json databaseId,createdAt \
    --jq "[.[] | select(.createdAt >= \"$DISPATCHED\")][0].databaseId // empty")"
  [[ -n "$RUN" ]] && break
  sleep 2
done
[[ -n "$RUN" ]] || { echo "The Windows/Linux build didn't start. Run release-desktop.yml by hand with commit=$COMMIT release_id=$RELEASE_ID." >&2; exit 1; }
gh run watch "$RUN" --repo "$REPO" --exit-status || {
  echo "The Windows/Linux build failed; the draft release stays. Fix it, run release-desktop.yml with commit=$COMMIT release_id=$RELEASE_ID (platforms=<the failed one> redoes just that build), then: gh release edit $TAG --repo $REPO --draft=false --latest" >&2
  exit 1
}

gh release edit "$TAG" --repo "$REPO" --draft=false --latest
echo "Published $TAG. Updater feed: https://github.com/$REPO/releases/latest/download/latest.json"
