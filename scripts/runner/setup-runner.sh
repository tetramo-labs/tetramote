#!/usr/bin/env bash
# shellcheck disable=SC2016
# Turns an Apple Silicon Mac into a GitHub Actions runner host for Tetramote:
#
#   GH_RUNNER_TOKEN=<token> scripts/runner/setup-runner.sh --runners 1
#
# Made to share a Mac (and its user) with the Glassly runners: everything lives
# under $RUNNER_BASE_DIR (default ~/tetramote-runner), runners are named
# tetramote-<host>-N, the cleanup jobs are com.tetramote.*, and the runners get
# the newest Xcode through DEVELOPER_DIR in their .env, so xcode-select (which
# Glassly's builds use) is never changed. System settings (pmset, the
# limit.maxfiles daemon) are only written when missing or different, and sudo
# is only asked for when one of them needs writing. Re-running is safe: it
# reconciles the toolchain, the cleanup schedule and each runner's .env, and
# skips runners that are already registered.
#
# Needs Xcode 27.1 or later in /Applications (the iPhone Duo build requires its
# SDK) and Homebrew. Installs what is missing of: the Homebrew formulas below,
# bun, rustup (stable, iOS and macOS targets), Maestro and the iOS 27.1+
# simulator runtime.
#
# Env:
#   GH_RUNNER_TOKEN  registration token, needed when a runner is not registered yet:
#                    gh api -X POST repos/tetramo-labs/tetramote/actions/runners/registration-token --jq .token
#   GH_RUNNER_URL    default https://github.com/tetramo-labs/tetramote
#   RUNNER_BASE_DIR  default ~/tetramote-runner
#   RUNNER_NAME      base name, default tetramote-<LocalHostName>; runners get -1, -2, ...
#   RUNNER_LABELS    extra comma-separated labels
#   RUNNER_VERSION   actions/runner version, default the latest release
#   XCODE_APP        Xcode to use, default the newest /Applications/Xcode*.app
#   RUNNER_ASC_PROFILE  asc profile the jobs use (ASC_PROFILE in .env), default tetramote-ci
#
# Flags:
#   --runners N      runners to keep on this host, default the number already
#                    registered here or 1; 0 skips runner registration.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
ok() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[ERR]${NC} $*" >&2; exit 1; }

SUDO_PRIMED=0
as_root() {
  if [[ "$SUDO_PRIMED" -eq 0 ]]; then
    info "sudo is needed to run: $*"
    sudo -v
    ( while kill -0 "$$" 2>/dev/null; do sudo -n true; sleep 60; done ) 2>/dev/null &
    SUDO_PRIMED=1
  fi
  sudo "$@"
}

version_ge() {
  [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)" == "$1" ]]
}

newest_xcode() {
  local app version best="" best_version=""
  for app in /Applications/Xcode*.app; do
    [[ -d "$app/Contents/Developer" ]] || continue
    version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null)" || continue
    if [[ -z "$best" ]] || version_ge "$version" "$best_version"; then
      best="$app"
      best_version="$version"
    fi
  done
  [[ -n "$best" ]] && echo "$best"
}

append_once() {
  grep -qF "$1" "$ZPROFILE" 2>/dev/null || printf '\n%s\n' "$2" >> "$ZPROFILE"
}

pmset_value() {
  pmset -g | awk -v key="$1" '$1 == key && !found { print $2; found = 1 }'
}

ensure_pmset() {
  local current
  current="$(pmset_value "$1")"
  if [[ -n "$current" && "$current" != "$2" ]]; then
    as_root pmset -a "$1" "$2"
  fi
}

replace_file() {
  if [[ -f "$2" ]] && cmp -s "$1" "$2"; then
    rm -f "$1"
    return 1
  fi
  mv "$1" "$2"
}

RUNNER_COUNT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runners) RUNNER_COUNT="${2:-}"; shift 2 ;;
    --runners=*) RUNNER_COUNT="${1#*=}"; shift ;;
    -h|--help) sed -n '3,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//; $d'; exit 0 ;;
    *) fail "Unknown argument: $1 (see --help)" ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || fail "This script sets up macOS runners only (got $(uname -s))."
[[ "$(uname -m)" == "arm64" ]] || fail "This script needs an Apple Silicon Mac (got $(uname -m))."
[[ "$EUID" -ne 0 ]] || fail "Run this as the runner user, not root; it asks for sudo itself when needed."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GH_RUNNER_URL="${GH_RUNNER_URL:-https://github.com/tetramo-labs/tetramote}"
GH_REPO="${GH_RUNNER_URL#https://github.com/}"
RUNNER_BASE_DIR="${RUNNER_BASE_DIR:-$HOME/tetramote-runner}"
HOST_NAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
RUNNER_NAME_BASE="${RUNNER_NAME:-tetramote-$(echo "$HOST_NAME" | tr '[:upper:]' '[:lower:]')}"
RUNNER_LABELS_EXTRA="${RUNNER_LABELS:-}"
ASC_PROFILE="${RUNNER_ASC_PROFILE:-tetramote-ci}"
BREW_PREFIX="/opt/homebrew"
ZPROFILE="$HOME/.zprofile"
RUST_TARGETS=(aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios x86_64-apple-darwin)
BREW_FORMULAS=(git gh cmake cocoapods xcbeautify coreutils jq ffmpeg imagemagick webp openjdk@17 asc)
MIN_XCODE="27.1"
MIN_IOS_RUNTIME="27.1"

shopt -s nullglob
EXISTING=("$RUNNER_BASE_DIR"/actions-runner-*/.runner)
shopt -u nullglob
if [[ -z "$RUNNER_COUNT" ]]; then
  RUNNER_COUNT="${#EXISTING[@]}"
  [[ "$RUNNER_COUNT" -gt 0 ]] || RUNNER_COUNT=1
fi
[[ "$RUNNER_COUNT" =~ ^[0-9]+$ ]] || fail "--runners must be a non-negative integer (got '$RUNNER_COUNT')."

NEEDS_TOKEN=0
for ((i = 1; i <= RUNNER_COUNT; i++)); do
  [[ -f "$RUNNER_BASE_DIR/actions-runner-$RUNNER_NAME_BASE-$i/.runner" ]] || NEEDS_TOKEN=1
done
if [[ "$NEEDS_TOKEN" -eq 1 && -z "${GH_RUNNER_TOKEN:-}" ]]; then
  fail "Set GH_RUNNER_TOKEN to register new runners. A repo admin gets one (valid 1 hour) with:
  gh api -X POST repos/$GH_REPO/actions/runners/registration-token --jq .token"
fi

if [[ -z "${RUNNER_VERSION:-}" ]]; then
  RUNNER_VERSION="$(curl -fsSL --max-time 5 https://api.github.com/repos/actions/runner/releases/latest 2>/dev/null \
    | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1 || true)"
  RUNNER_VERSION="${RUNNER_VERSION:-2.334.0}"
fi

info "Host $HOST_NAME: $RUNNER_COUNT runner(s) named $RUNNER_NAME_BASE-N under $RUNNER_BASE_DIR"
info "Repository $GH_RUNNER_URL, actions/runner $RUNNER_VERSION"
mkdir -p "$RUNNER_BASE_DIR"

xcode-select -p >/dev/null 2>&1 || { xcode-select --install || true; fail "Xcode command line tools were missing. Re-run once their installer finishes."; }
XCODE_APP="${XCODE_APP:-$(newest_xcode || true)}"
[[ -n "$XCODE_APP" && -d "$XCODE_APP" ]] || fail "No Xcode in /Applications. Install Xcode $MIN_XCODE or later, launch it once, then re-run."
XCODE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$XCODE_APP/Contents/Info.plist")"
version_ge "$XCODE_VERSION" "$MIN_XCODE" || fail "$XCODE_APP is Xcode $XCODE_VERSION; the iPhone Duo build needs $MIN_XCODE or later. Install it to /Applications and re-run."
export DEVELOPER_DIR="$XCODE_APP/Contents/Developer"
if ! xcodebuild -license check >/dev/null 2>&1; then
  as_root env DEVELOPER_DIR="$DEVELOPER_DIR" xcodebuild -license accept
fi
if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  as_root env DEVELOPER_DIR="$DEVELOPER_DIR" xcodebuild -runFirstLaunch
fi
ok "Xcode $XCODE_VERSION ($XCODE_APP) for the runners; xcode-select stays at $(xcode-select -p)"

if [[ ! -x "$BREW_PREFIX/bin/brew" ]]; then
  info "Installing Homebrew"
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
eval "$("$BREW_PREFIX/bin/brew" shellenv)"
append_once 'brew shellenv' 'eval "$(/opt/homebrew/bin/brew shellenv)"'

MISSING=()
for formula in "${BREW_FORMULAS[@]}"; do
  if [[ "$formula" == asc ]] && command -v asc >/dev/null 2>&1; then
    continue
  fi
  brew list --formula "$formula" >/dev/null 2>&1 || MISSING+=("$formula")
done
if [[ "${#MISSING[@]}" -gt 0 ]]; then
  info "Installing ${MISSING[*]}"
  HOMEBREW_NO_INSTALL_UPGRADE=1 brew install "${MISSING[@]}"
fi
ok "Homebrew formulas present: ${BREW_FORMULAS[*]}"

export BUN_INSTALL="$HOME/.bun"
export PATH="$HOME/.cargo/bin:$BUN_INSTALL/bin:$HOME/.maestro/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  info "Installing bun"
  curl -fsSL https://bun.sh/install | bash
fi
append_once '.bun/bin' 'export BUN_INSTALL="$HOME/.bun"; export PATH="$BUN_INSTALL/bin:$PATH"'
ok "bun $(bun --version)"

if ! command -v rustup >/dev/null 2>&1; then
  info "Installing rustup"
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain stable
fi
append_once '.cargo/env' '. "$HOME/.cargo/env"'
rustup toolchain list | grep -q '^stable' || rustup toolchain install stable --profile minimal
rustup component add --toolchain stable clippy rustfmt
rustup target add --toolchain stable "${RUST_TARGETS[@]}"
ok "$(rustc +stable --version), targets ${RUST_TARGETS[*]}"

if ! command -v maestro >/dev/null 2>&1; then
  info "Installing Maestro"
  curl -fsSL https://get.maestro.mobile.dev | bash
fi
append_once '.maestro/bin' 'export PATH="$HOME/.maestro/bin:$PATH"'
ok "Maestro $(MAESTRO_CLI_NO_ANALYTICS=1 JAVA_HOME="$BREW_PREFIX/opt/openjdk@17" maestro --version 2>/dev/null | tail -1)"

IOS_RUNTIMES="$(xcrun simctl list runtimes -j | jq -r '.runtimes[] | select(.platform == "iOS" and .isAvailable) | .version')"
HAS_RUNTIME=0
for v in $IOS_RUNTIMES; do
  if version_ge "$v" "$MIN_IOS_RUNTIME"; then
    HAS_RUNTIME=1
  fi
done
if [[ "$HAS_RUNTIME" -eq 0 ]]; then
  info "No iOS $MIN_IOS_RUNTIME+ simulator runtime; downloading the one for Xcode $XCODE_VERSION"
  xcodebuild -downloadPlatform iOS
fi
ok "iOS simulator runtimes: $(xcrun simctl list runtimes -j | jq -r '[.runtimes[] | select(.platform == "iOS" and .isAvailable) | .version] | join(", ")')"

ensure_pmset sleep 0
ensure_pmset disksleep 0
ensure_pmset autorestart 1
ensure_pmset powernap 0
ok "Power settings: no sleep, restart after power loss"

MAXFILES_PLIST=/Library/LaunchDaemons/limit.maxfiles.plist
if [[ -f "$MAXFILES_PLIST" ]]; then
  ok "File descriptor limit daemon already installed ($MAXFILES_PLIST), left as is"
else
  as_root tee "$MAXFILES_PLIST" >/dev/null <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
        "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>limit.maxfiles</string>
    <key>ProgramArguments</key>
    <array>
      <string>launchctl</string>
      <string>limit</string>
      <string>maxfiles</string>
      <string>524288</string>
      <string>524288</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>ServiceIPC</key><false/>
  </dict>
</plist>
PLIST
  as_root chown root:wheel "$MAXFILES_PLIST"
  as_root chmod 644 "$MAXFILES_PLIST"
  as_root launchctl load -w "$MAXFILES_PLIST" 2>/dev/null || true
  ok "File descriptor limit raised to 524288"
fi

cp "$SCRIPT_DIR/runner-cleanup.sh" "$RUNNER_BASE_DIR/runner-cleanup.sh"
chmod +x "$RUNNER_BASE_DIR/runner-cleanup.sh"
mkdir -p "$HOME/Library/LaunchAgents"
for job in runner-cleanup runner-disk-guard; do
  plist="$HOME/Library/LaunchAgents/com.tetramote.$job.plist"
  sed "s|@@RUNNER_BASE_DIR@@|$RUNNER_BASE_DIR|g" "$SCRIPT_DIR/$job.plist.template" > "$plist.tmp"
  if replace_file "$plist.tmp" "$plist" || ! launchctl list "com.tetramote.$job" >/dev/null 2>&1; then
    launchctl unload "$plist" 2>/dev/null || true
    launchctl load -w "$plist" 2>/dev/null || warn "launchctl could not load $plist; log in to the Mac's desktop session and re-run."
  fi
done
ok "Cleanup scheduled: Sundays 04:00 (full) and every 30 minutes (by free space)"

RUNNER_PATH="$HOME/.cargo/bin:$BREW_PREFIX/opt/rustup/bin:$HOME/.bun/bin:$HOME/.maestro/bin:$BREW_PREFIX/bin:$BREW_PREFIX/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LABELS="self-hosted,macOS,ARM64,tetramote${RUNNER_LABELS_EXTRA:+,$RUNNER_LABELS_EXTRA}"
for ((i = 1; i <= RUNNER_COUNT; i++)); do
  name="$RUNNER_NAME_BASE-$i"
  home="$RUNNER_BASE_DIR/actions-runner-$name"
  mkdir -p "$home"
  cd "$home"

  if [[ ! -f ./config.sh ]]; then
    tarball="actions-runner-osx-arm64-$RUNNER_VERSION.tar.gz"
    info "Downloading actions/runner $RUNNER_VERSION into $home"
    curl -fsSL -o "$tarball" "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/$tarball"
    tar xzf "$tarball"
    rm -f "$tarball"
  fi

  if [[ ! -f ./.runner ]]; then
    ./config.sh --unattended --replace \
      --url "$GH_RUNNER_URL" \
      --token "$GH_RUNNER_TOKEN" \
      --name "$name" \
      --labels "$LABELS,$name" \
      --work "$home/_work"
  fi

  {
    echo "PATH=$RUNNER_PATH"
    echo "DEVELOPER_DIR=$DEVELOPER_DIR"
    echo "JAVA_HOME=$BREW_PREFIX/opt/openjdk@17"
    echo "ASC_PROFILE=$ASC_PROFILE"
    echo "ASC_BYPASS_KEYCHAIN=1"
    echo "CARGO_BUILD_JOBS=2"
    echo "MAESTRO_CLI_NO_ANALYTICS=1"
    echo "LANG=en_US.UTF-8"
  } > .env.tmp
  echo "$RUNNER_PATH" > .path.tmp
  env_changed=0
  replace_file .env.tmp .env && env_changed=1
  replace_file .path.tmp .path && env_changed=1

  if [[ ! -f "$HOME/Library/LaunchAgents/actions.runner.${GH_REPO//\//-}.$name.plist" ]]; then
    ./svc.sh install
    ./svc.sh start
  elif [[ "$env_changed" -eq 1 ]]; then
    if pgrep -f "$home/bin/Runner.Worker" >/dev/null; then
      warn "$name is running a job; its new .env applies after: cd $home && ./svc.sh stop && ./svc.sh start"
    else
      ./svc.sh stop || true
      ./svc.sh start
    fi
  else
    ./svc.sh start >/dev/null 2>&1 || true
  fi
  ok "Runner $name ($LABELS,$name) installed as a LaunchAgent"
done
[[ "$RUNNER_COUNT" -gt 0 ]] || info "Runner registration skipped (--runners 0)"

cat <<EOF

Host $HOST_NAME is set up. Once, by hand (scripts/runner/README.md has details):
  1. asc auth login --bypass-keychain --name $ASC_PROFILE \\
       --key-id <KEY_ID> --issuer-id <ISSUER_ID> --private-key <path to AuthKey_<KEY_ID>.p8>
     then asc auth status: if the default profile changed, switch Glassly's back
     (asc auth switch --name glassly-ci). Tetramote jobs pick $ASC_PROFILE via ASC_PROFILE.
  2. System Settings: automatic login for $USER, Lock Screen > Require password: Never.
  3. Check the runners: gh api repos/$GH_REPO/actions/runners --jq '.runners[] | [.name, .status] | @tsv'

Cleanup log: $RUNNER_BASE_DIR/runner-cleanup.log
Deep clean now: $RUNNER_BASE_DIR/runner-cleanup.sh --tier all --force
EOF
