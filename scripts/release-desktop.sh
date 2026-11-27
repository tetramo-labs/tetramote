#!/usr/bin/env bash
# Publishes a desktop release that every installed copy updates to:
#
#   scripts/release-desktop.sh 0.3.0
#
# 1. Stamps the version into the desktop app, commits and pushes it.
# 2. Runs .github/workflows/release-desktop.yml on that commit and waits for it:
#    a draft release, the universal macOS app signed on the self-hosted Mac with
#    the Apple Development certificate in the APPLE_DEV_P12_B64 secret (always
#    the same one, so macOS keeps the screen recording and accessibility grants
#    across updates), Windows and Linux on GitHub's runners, and the updater feed
#    (latest.json, signed with the TAURI_SIGNING_PRIVATE_KEY secret). It
#    publishes once latest.json lists every platform.
#
# Needs a clean, pushed main and gh signed in with the workflow scope. Runs on
# any machine; the keys live in GitHub secrets.
set -euo pipefail

VERSION="${1:?usage: scripts/release-desktop.sh <version, e.g. 0.3.0>}"
REPO="tetramo-labs/tetramote"
TAG="v$VERSION"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP="$ROOT/desktop"

if [[ -n "$(git -C "$ROOT" status --porcelain -- desktop core scripts .github)" ]]; then
  echo "desktop/, core/, scripts/ or .github/ has uncommitted changes. Commit them first; a release is built from main." >&2
  exit 1
fi
git -C "$ROOT" fetch -q origin main
if [[ "$(git -C "$ROOT" rev-parse HEAD)" != "$(git -C "$ROOT" rev-parse origin/main)" ]]; then
  echo "HEAD is not origin/main. Push (or pull) first." >&2
  exit 1
fi
if [[ "$(gh release view "$TAG" --repo "$REPO" --json isDraft --jq .isDraft 2>/dev/null || true)" == "false" ]]; then
  echo "Release $TAG is already published. Pick a higher version." >&2
  exit 1
fi

python3 - "$DESKTOP" "$VERSION" <<'PY'
import json, re, sys
desktop, version = sys.argv[1], sys.argv[2]
conf_path = f"{desktop}/src-tauri/tauri.conf.json"
conf = json.load(open(conf_path))
conf["version"] = version
open(conf_path, "w").write(json.dumps(conf, indent=2) + "\n")
pkg_path = f"{desktop}/package.json"
pkg = json.load(open(pkg_path))
pkg["version"] = version
open(pkg_path, "w").write(json.dumps(pkg, indent=2) + "\n")
cargo_path = f"{desktop}/src-tauri/Cargo.toml"
cargo = open(cargo_path).read()
open(cargo_path, "w").write(re.sub(r'(?m)^version = ".*"$', f'version = "{version}"', cargo, count=1))
PY
(cd "$DESKTOP" && cargo update -p tetramote-desktop --offline >/dev/null 2>&1 || true)
git -C "$ROOT" add desktop/src-tauri/tauri.conf.json desktop/package.json desktop/src-tauri/Cargo.toml desktop/Cargo.lock
if ! git -C "$ROOT" diff --cached --quiet; then
  git -C "$ROOT" commit -q -m "Release desktop $VERSION"
  git -C "$ROOT" push -q origin HEAD:main
fi

COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
DISPATCHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
gh workflow run release-desktop.yml --repo "$REPO" --ref main -f version="$VERSION"
RUN=""
for _ in $(seq 1 30); do
  RUN="$(gh run list --repo "$REPO" --workflow release-desktop.yml --limit 5 --json databaseId,createdAt,headSha \
    --jq "[.[] | select(.createdAt >= \"$DISPATCHED\" and .headSha == \"$COMMIT\")][0].databaseId // empty")"
  [[ -n "$RUN" ]] && break
  sleep 2
done
[[ -n "$RUN" ]] || { echo "The release workflow didn't start. Run release-desktop.yml by hand with version=$VERSION." >&2; exit 1; }
echo "Releasing $TAG from $COMMIT: https://github.com/$REPO/actions/runs/$RUN"
gh run watch "$RUN" --repo "$REPO" --exit-status || {
  echo "The release failed; the draft release $TAG stays. Fix it, then run release-desktop.yml again with version=$VERSION (it reuses the draft)." >&2
  exit 1
}
echo "Published $TAG. Updater feed: https://github.com/$REPO/releases/latest/download/latest.json"
