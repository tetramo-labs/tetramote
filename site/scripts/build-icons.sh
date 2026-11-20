#!/usr/bin/env bash
# Regenerates the raster icons from public/favicon.svg (needs ImageMagick). The outputs are committed.
set -euo pipefail
cd "$(dirname "$0")/../public"
render() { magick -background none -density 1200 favicon.svg -resize "$1x$1" "$2"; }
square() { sed 's/ rx="200"//' favicon.svg | magick -background none -density 1200 svg:- -resize "$1x$1" "$2"; }
tmp=$(mktemp -d)
for size in 16 32 48; do render "$size" "$tmp/$size.png"; done
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" favicon.ico
square 180 apple-touch-icon.png
square 512 icon-512.png
rm -rf "$tmp"
