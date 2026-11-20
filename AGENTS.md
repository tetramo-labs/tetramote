# AGENTS.md

Rules for coding agents working in Tetramote. The phone app follows the Glassly App's design and stack
(`~/dev/glassly/mobile`); when this file is silent, do what the Glassly App does.

## Map

- `core/`: Rust transport (iroh 1.4). `PROTOCOL.md` is its spec, `core/include/tetra_core.h` its C API,
  `core/src/android.rs` its JNI API (`com.tetramote.remote.TetraNative`).
- `desktop/`: the Tauri 2 desktop app (macOS, Windows, Linux): `src-tauri/` Rust backend on `tetra_core`,
  `src/` React 19 + Vite + Tailwind 4 + Zustand frontend (popover `index.html`, viewer `viewer.html`),
  `media/` (`tetra_media`) the per-OS capture/encode/audio/input layer behind one interface in `media/src/lib.rs`.
- `mobile/`: Expo app. Screens are in `src/app/`, the native module is in `modules/remote/` (Swift in
  `ios/`, Kotlin in `android/`, TypeScript API in `src/`).

## Commands

- Core: `scripts/build-core.sh [ios|android|all]`, then `cd core && cargo test && cargo clippy --all-targets`.
  The script caps cargo at 2 jobs: more corrupt freshly built proc-macro dylibs under the macOS 27 linker.
- Desktop: `cd desktop && bun install`, then `bunx tauri dev`; checks are `CARGO_BUILD_JOBS=2 cargo test -p tetra_media
  -p tetramote-desktop`, `cargo clippy -p tetra_media -p tetramote-desktop --all-targets`, `bunx vitest run`,
  `bunx tsc --noEmit -p .` and `bunx eslint .`. Windows and Linux are checked by `.github/workflows/desktop.yml`.
  Run the app with `TETRAMOTE_PROFILE=<name>` in tests so it never reads the real keys (README lists the
  other test variables). Release with `scripts/release-desktop.sh <version>`.
- Mobile, from `mobile/`: `bun run test` (Jest), `bun compile` (tsc), `bun run lint:check`, `bun ios`, `bun android`.
  `ios/` and `android/` are generated (CNG); make durable changes in `app.config.ts` or the module.
- Use bun, never npm or yarn. Installs skip versions published less than 7 days ago (`mobile/bunfig.toml`).

## Rules

- A wire change updates `PROTOCOL.md`, `core/`, `desktop/` (host and viewer), both native module platforms and
  `modules/remote/src/types.ts` in the same commit.
- Key codes and modifier flags on the wire are macOS virtual key codes and CGEventFlags whatever the host OS;
  `desktop/media/src/keymap.rs` is the one table that maps them.
- Video and audio never cross the JS bridge; JS only sees state and control JSON.
- Comments: none inside function bodies, JSX or nested blocks; none on fields, params, types or values. A
  comment heads a function, type or module in one or two lines stating a constraint a reader would
  otherwise break. Never narrate code or explain a fix (that goes in the commit message).
- Format TypeScript with the checked-in `.prettierrc` (double quotes, no semicolons, width 120), Swift with
  `swiftformat` (2-space indent), Rust with `cargo fmt`, Kotlin with 4 spaces.
- iPhone Duo: build iOS with Xcode 27.1 or later (`bun ios` picks the newest; an older SDK puts the app in
  a compatibility window beside the rail). Session geometry comes from `sessionLayout()` and rail buttons
  from `useRailActions()`, both decided from window sizes, never the device or orientation. Check folded,
  open and sideways with `duoctl` before calling Duo work done.
- Mobile UI: Uniwind `className` with semantic tokens (`bg-primary-foreground`, `text-muted-foreground`),
  `useAppTheme()` for values passed through `style` or props, no `StyleSheet.create`, navigation through
  `useNavigationStore`, copy in `src/i18n/en.ts` via `tx`/`translate()`, sizes from the window via
  `useLayout()`, content off the iPhone Duo's rail. Never clip a `GlassView` itself.
- Error messages say what failed and what to do next.
- Tests take expected values from literals or the spec, never recomputed the way the code does.
- Commits: imperative subjects, focused scope, no AI attribution lines or trailers.
