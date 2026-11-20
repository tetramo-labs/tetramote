#!/usr/bin/env bash
# Regenerates public/screenshots from scripts/screenshots (needs Helium or Chrome, or CHROME set to a Chromium
# binary, and cwebp). Edit desktop.html, the frame pages or the *-app.webp captures, never the outputs.
set -euo pipefail
cd "$(dirname "$0")/screenshots"
browser=${CHROME:-}
for candidate in "/Applications/Helium.app/Contents/MacOS/Helium" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
  if [ -z "$browser" ] && [ -x "$candidate" ]; then browser=$candidate; fi
done
if [ -z "$browser" ]; then
  echo "No Chromium browser found: install Helium or Chrome, or set CHROME to a Chromium binary." >&2
  exit 1
fi
if ! command -v cwebp >/dev/null; then
  echo "cwebp not found: install it with 'brew install webp'." >&2
  exit 1
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp desktop.html folded.html laptop.html folded-app.webp laptop-app.webp "$tmp"
shot() {
  "$browser" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$tmp/profile" \
    --window-size="$2,$3" --force-device-scale-factor="$4" --default-background-color=00000000 \
    --screenshot="$tmp/$1.png" "file://$tmp/$1.html" >/dev/null 2>&1
  [ -s "$tmp/$1.png" ] || { echo "Rendering $1.html failed: run $browser by hand to see why." >&2; exit 1; }
}
shot desktop 1024 640 2
shot folded 610 849 1
shot laptop 800 1116 1
for name in folded laptop; do
  cwebp -quiet -q 84 -alpha_q 100 -m 6 -sharp_yuv "$tmp/$name.png" -o "../../public/screenshots/$name.webp"
done
