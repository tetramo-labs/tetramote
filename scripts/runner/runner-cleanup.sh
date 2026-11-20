#!/usr/bin/env bash
#
# Frees disk on a Tetramote runner host. setup-runner.sh installs it next to the
# runners and schedules it with launchd (weekly, plus a half-hourly --auto run).
#
# Deletes only what is Tetramote's: the runners' own _work checkouts, Rust
# target dirs inside them, Tetramote-* DerivedData and $RUNNER_BASE_DIR/derived-data.
# Caches shared with the Glassly runners on the same Mac (bun, CocoaPods,
# ~/Library/Caches, simulators, other DerivedData) are left to Glassly's cleanup.
#
# Tiers (Tier 2 includes Tier 1):
#   1  _work checkouts untouched for 7 days, Tetramote-* DerivedData untouched
#      for 7 days, cargo incremental dirs in the checkouts.
#   2  all Tetramote-* DerivedData, $RUNNER_BASE_DIR/derived-data, and every
#      core/, desktop/ and web/wasm/ target dir in the checkouts (the next
#      build recompiles the Rust core and the iOS app from scratch).
#
# Defers (exit 0) while a Tetramote job or a local xcodebuild, cargo, rustc,
# bun or pod install runs, unless --force. --auto picks the tier from free
# space on /: nothing at AUTO_TIER1_GIB (40) or more, Tier 1 below it, Tier 2
# below AUTO_TIER2_GIB (20), and it ignores running builds below EMERGENCY_GIB
# (5), since a full disk kills them anyway.
#
# Logs to $RUNNER_BASE_DIR/runner-cleanup.log (default: this script's folder),
# trimmed to its last 500 lines.
#
# Usage:
#   runner-cleanup.sh [--tier 1|2|all] [--auto] [--dry-run] [--force]

set -u
LC_ALL=C

TIER="all"
DRY_RUN=0
FORCE=0
AUTO=0
AUTO_TIER1_GIB="${AUTO_TIER1_GIB:-40}"
AUTO_TIER2_GIB="${AUTO_TIER2_GIB:-20}"
EMERGENCY_GIB="${EMERGENCY_GIB:-5}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier) TIER="${2:-}"; shift 2 ;;
    --tier=*) TIER="${1#*=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    --auto) AUTO=1; shift ;;
    -h|--help) sed -n '2,/^set -u/p' "$0" | sed 's/^# \{0,1\}//; $d'; exit 0 ;;
    *) echo "Unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done

case "$TIER" in
  1|2|all) ;;
  *) echo "Invalid --tier '$TIER' (expected 1, 2 or all)" >&2; exit 2 ;;
esac

RUNNER_BASE_DIR="${RUNNER_BASE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
LOG_FILE="$RUNNER_BASE_DIR/runner-cleanup.log"
DERIVED_DATA="$HOME/Library/Developer/Xcode/DerivedData"
mkdir -p "$RUNNER_BASE_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

trim_log() {
  local tmp
  tmp="$(mktemp)"
  tail -n 500 "$LOG_FILE" > "$tmp" && mv "$tmp" "$LOG_FILE"
}
trap trim_log EXIT

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

free_bytes() {
  echo "$(( $(df -k / | awk 'NR == 2 { print $4 }') * 1024 ))"
}

human_bytes() {
  awk -v b="$1" 'BEGIN {
    split("B KiB MiB GiB TiB", units, " ")
    i = 1
    while (b >= 1024 && i < 5) { b /= 1024; i++ }
    printf "%.2f %s\n", b, units[i]
  }'
}

size_kib() {
  du -sk "$1" 2>/dev/null | awk '{ print $1 }'
}

nuke() {
  local kib
  kib="$(size_kib "$1")"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "  would delete: $1 ($(human_bytes "$(( ${kib:-0} * 1024 ))"))"
  else
    rm -rf -- "$1"
    log "  deleted: $1 ($(human_bytes "$(( ${kib:-0} * 1024 ))"))"
  fi
}

nuke_found() {
  local path
  while IFS= read -r path; do
    nuke "$path"
  done < <(find "$@" 2>/dev/null)
}

log "Starting cleanup tier=$TIER dry_run=$DRY_RUN force=$FORCE base=$RUNNER_BASE_DIR"
START_FREE="$(free_bytes)"
log "Before: $(human_bytes "$START_FREE") free on /"

if [[ "$AUTO" -eq 1 ]]; then
  FREE_GIB=$(( START_FREE / 1073741824 ))
  if (( FREE_GIB >= AUTO_TIER1_GIB )); then
    log "Auto: $FREE_GIB GiB free (>= $AUTO_TIER1_GIB), nothing to do."
    exit 0
  elif (( FREE_GIB >= AUTO_TIER2_GIB )); then
    TIER=1
  else
    TIER=2
  fi
  log "Auto: $FREE_GIB GiB free, running tier $TIER"
  if (( FREE_GIB < EMERGENCY_GIB )); then
    log "Below the $EMERGENCY_GIB GiB emergency floor: cleaning even if a build is running."
    FORCE=1
  fi
fi

BUILD_PROCS_REGEX="$RUNNER_BASE_DIR/actions-runner-[^/]*/bin/Runner\\.Worker|(^|/)xcodebuild( |\$)|(^|/)cargo( |\$)|(^|/)rustc |(^|/)bun (install|run|ios)|(^|/)pod install"
if [[ "$FORCE" -ne 1 ]] && pgrep -u "$USER" -f "$BUILD_PROCS_REGEX" >/dev/null 2>&1; then
  log "Build running, deferring cleanup:"
  pgrep -u "$USER" -fl "$BUILD_PROCS_REGEX" | head -20 | sed 's/^/  /'
  exit 0
fi

shopt -s nullglob
CHECKOUTS=("$RUNNER_BASE_DIR"/actions-runner-*/_work/*/*)
WORK_DIRS=("$RUNNER_BASE_DIR"/actions-runner-*/_work)
shopt -u nullglob

log "Tier 1"
if [[ "${#WORK_DIRS[@]}" -gt 0 ]]; then
  nuke_found "${WORK_DIRS[@]}" -mindepth 2 -maxdepth 2 -type d -mtime +7 -not -path '*/_work/_*'
fi
nuke_found "$DERIVED_DATA" -mindepth 1 -maxdepth 1 -type d -name 'Tetramote-*' -mtime +7
for checkout in ${CHECKOUTS[@]+"${CHECKOUTS[@]}"}; do
  [[ -d "$checkout" && "$checkout" != */_work/_* ]] || continue
  for target in "$checkout/core/target" "$checkout/desktop/target" "$checkout/web/wasm/target"; do
    [[ -d "$target" ]] && nuke_found "$target" -mindepth 2 -maxdepth 3 -type d -name incremental
  done
done

if [[ "$TIER" == 2 || "$TIER" == all ]]; then
  log "Tier 2"
  nuke_found "$DERIVED_DATA" -mindepth 1 -maxdepth 1 -type d -name 'Tetramote-*'
  [[ -d "$RUNNER_BASE_DIR/derived-data" ]] && nuke_found "$RUNNER_BASE_DIR/derived-data" -mindepth 1 -maxdepth 1
  for checkout in ${CHECKOUTS[@]+"${CHECKOUTS[@]}"}; do
    [[ "$checkout" != */_work/_* ]] || continue
    for target in "$checkout/core/target" "$checkout/desktop/target" "$checkout/web/wasm/target"; do
      [[ -d "$target" ]] && nuke "$target"
    done
  done
fi

END_FREE="$(free_bytes)"
log "After: $(human_bytes "$END_FREE") free on /"
if (( END_FREE >= START_FREE )); then
  log "Freed $(human_bytes $(( END_FREE - START_FREE )))"
else
  log "Free space shrank by $(human_bytes $(( START_FREE - END_FREE ))) (a build wrote files during cleanup)"
fi
log "Done."
