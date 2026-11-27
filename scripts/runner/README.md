# Self-hosted runner

Tetramote's iOS jobs (the Rust core for iOS, the Expo app built with Xcode 27.1+ for the iPhone Duo, Maestro
screenshots, App Store Connect uploads) run on a self-hosted Apple Silicon Mac. Workflows target it with
`runs-on: [self-hosted, macOS, ARM64, tetramote]`. Pushes to `main` also run the macOS leg of `desktop.yml` and the
`mobile.yml` check there, and `release-desktop.yml` builds and signs the macOS desktop app there. Pull requests and
the Windows and Linux builds stay on GitHub-hosted runners.

The runner shares a Mac and its macOS user with the Glassly runners (`bob`, `kevin`). The two setups stay apart:

| | Tetramote | Glassly |
| --- | --- | --- |
| Install dir | `~/tetramote-runner` | `<glassly clone>/ci-runner` |
| Runner names | `tetramote-<host>-N` | `<host>-N` |
| Runner services | `actions.runner.tetramo-labs-tetramote.*` | `actions.runner.tetramo-labs-glassly.*` |
| Cleanup jobs | `com.tetramote.runner-cleanup`, `com.tetramote.runner-disk-guard` | `com.glassly.*` |
| Xcode | newest `/Applications/Xcode*.app`, via `DEVELOPER_DIR` in the runner's `.env` | `xcode-select` |
| asc profile | `tetramote-ci` (`ASC_PROFILE` in `.env`) | the default profile |

Runners are registered to this repository only, so Glassly jobs never land on them and Tetramote jobs never land on
Glassly's.

## Security

This repository is public, so anyone can open a pull request, and a self-hosted runner executes whatever a workflow
tells it to with the runner user's keys and sessions. A job may pick the self-hosted runner only on
`workflow_dispatch` or a `push` to `main`. `desktop.yml` and `mobile.yml` also run on `pull_request`, so their
`runs-on` chooses the self-hosted runner only when `github.event_name == 'push'` and `github.ref == 'refs/heads/main'`.
Never route `pull_request`, `pull_request_target` or any other trigger a fork can fire to it.

A fork's pull request runs the workflow files from its own branch, so it can rewrite `runs-on` to reach this runner.
The guard against that is Settings > Actions > General > "Approval for running fork pull request workflows from
contributors" set to **Require approval for all external contributors**. Read a fork's workflow changes before you
approve its run.

On the self-hosted runner, `desktop.yml` checks out without `git clean`, so `desktop/target` survives between runs,
and skips `Swatinem/rust-cache`, which would prune the `~/.cargo` this user shares with Glassly.

## Set up a Mac

Prerequisites: Apple Silicon, Homebrew, and Xcode 27.1 or later in `/Applications` (launched once). bob and kevin
have these from the Glassly setup. The script installs what is missing: `git gh cmake cocoapods xcbeautify coreutils jq
ffmpeg imagemagick webp openjdk@17 asc` (Maestro needs the JDK), bun, rustup (stable with the `aarch64-apple-ios`,
`aarch64-apple-ios-sim`, `x86_64-apple-ios` and `x86_64-apple-darwin` targets), Maestro, and the iOS simulator
runtime for that Xcode. It asks for sudo only to accept the Xcode license, finish Xcode's first launch, or change
power and file-limit settings that differ from what it needs (on a Glassly host they already match).

Get a registration token (valid one hour) on a machine where `gh` is signed in as a repo admin:

```bash
gh api -X POST repos/tetramo-labs/tetramote/actions/runners/registration-token --jq .token
```

Then on the Mac, as the runner user:

```bash
git clone https://github.com/tetramo-labs/tetramote.git ~/dev/tetramote
cd ~/dev/tetramote
GH_RUNNER_TOKEN=<token> scripts/runner/setup-runner.sh --runners 1
```

`--runners N` keeps N runners on the host (default: as many as are already registered, or 1). Re-running is safe:
it reconciles the toolchain, the cleanup jobs and each runner's `.env` (restarting idle runners whose `.env`
changed) and only needs a token for runners not registered yet. Re-run it after installing a newer Xcode so the
runners switch to it. `scripts/runner/setup-runner.sh --help` lists the environment overrides.

## After setup

1. Log the runner user in to `asc` under its own profile, stored in `~/.asc/config.json` rather than the keychain:

   ```bash
   asc auth login --bypass-keychain --name tetramote-ci \
     --key-id <KEY_ID> --issuer-id <ISSUER_ID> --private-key <path>/AuthKey_<KEY_ID>.p8
   ASC_PROFILE=tetramote-ci asc auth status
   asc auth status
   ```

   The last command shows the default profile, which Glassly's jobs use. If logging in changed it, switch it back
   with `asc auth switch --name glassly-ci`.
2. On a new Mac (bob and kevin already have it): System Settings > Users & Groups, log this user in automatically,
   and Lock Screen > Require password: Never, so the runners come back after a power cut.

## Verify

```bash
gh api repos/tetramo-labs/tetramote/actions/runners --jq '.runners[] | [.name, .status, ([.labels[].name] | join(","))] | @tsv'
gh workflow run runner-diagnostics.yml -f runner_label=tetramote-bob-1
```

`runner-diagnostics.yml` prints the Xcode, iOS simulator runtimes, toolchain versions, `asc` status and disk space a
job would see, and fails when the runner can't build Tetramote. Dispatch it with `download_ios_platform` when the
iOS 27.1+ runtime is missing and `repair` when simulators don't show up.

Each runner is a LaunchAgent in `~/Library/LaunchAgents`; restart one with `./svc.sh stop && ./svc.sh start` from
`~/tetramote-runner/actions-runner-<name>`. To remove a runner, run `./svc.sh uninstall` and
`./config.sh remove --token <token>` there, with a token from
`gh api -X POST repos/tetramo-labs/tetramote/actions/runners/remove-token --jq .token`.

## Cleanup

`runner-cleanup.sh` (installed as `~/tetramote-runner/runner-cleanup.sh`) deletes only Tetramote's files: the
runners' `_work` checkouts, Rust target dirs inside them, `Tetramote-*` DerivedData and
`~/tetramote-runner/derived-data`. Shared caches (bun, CocoaPods, `~/Library/Caches`, other DerivedData, simulators)
are left to Glassly's cleanup on the same host.

- Sundays 04:00, an hour after Glassly's: Tier 2 (all of the above).
- Every 30 minutes, `--auto`: nothing with 40 GiB or more free, Tier 1 (checkouts and `Tetramote-*` DerivedData
  untouched for 7 days, cargo incremental dirs) below that, Tier 2 below 20 GiB.

Both defer while a Tetramote job or a local `xcodebuild`, `cargo`, `bun` or `pod install` runs, except below 5 GiB
free. Run it by hand with `--dry-run`, `--tier 1` or `--force`; the log is `~/tetramote-runner/runner-cleanup.log`.
