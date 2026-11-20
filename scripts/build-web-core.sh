#!/usr/bin/env bash
# Builds web/wasm (the browser's iroh session) into web/src/core/. The output is committed, because Cloudflare
# Pages only runs the Vite build; rerun this after changing core/ or web/wasm/.
#
# Needs the wasm32-unknown-unknown target and llvm-tools rustup components, and wasm-bindgen-cli at the version in
# web/wasm/Cargo.lock. ring's C code is archived with llvm-ar, since Apple's ar drops wasm objects; ring is rebuilt
# every time because cc-rs doesn't notice a changed archiver.
set -euo pipefail

export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE="$ROOT/web/wasm"
OUT="$ROOT/web/src/core"

want=$(grep -A1 '^name = "wasm-bindgen"$' "$CRATE/Cargo.lock" | sed -n 's/^version = "\(.*\)"/\1/p')
have=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}')
if [[ "$want" != "$have" ]]; then
  echo "wasm-bindgen-cli $want is needed (found ${have:-none}): cargo install wasm-bindgen-cli --version $want --locked" >&2
  exit 1
fi

LLVM_AR="$(rustc --print sysroot)/lib/rustlib/$(rustc -vV | sed -n 's/^host: //p')/bin/llvm-ar"
if [[ ! -x "$LLVM_AR" ]]; then
  echo "llvm-ar is missing: rustup component add llvm-tools" >&2
  exit 1
fi
export AR_wasm32_unknown_unknown="$LLVM_AR"

cd "$CRATE"
cargo clean --release --target wasm32-unknown-unknown -p ring
cargo build --release --locked --target wasm32-unknown-unknown
rm -rf "$OUT"
wasm-bindgen --target web --out-dir "$OUT" --out-name tetra_web \
  "$CRATE/target/wasm32-unknown-unknown/release/tetra_web.wasm"
if grep -q 'from "env"' "$OUT/tetra_web.js"; then
  echo "tetra_web.wasm has unresolved C symbols; ring was archived without llvm-ar" >&2
  exit 1
fi
