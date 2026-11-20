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
- `web/`: the browser client at remote.tetramote.com (React 19 + Vite + Tailwind 4, static on Cloudflare Pages).
  `web/wasm` (`tetra_web`) runs the session in WebAssembly on `tetra_core` without its `native` feature (just
  `protocol`, `input` and `link`) and iroh through relays; its key table is `desktop/media/src/keymap.rs`.
  `web/src/core/` is its generated, committed output.
- `site/`: tetramote.com, a static React 18 + Vite 6 + Tailwind 4 page (`src/App.jsx`) prerendered into `dist/index.html`
  with a Markdown twin at `/index.md` (`scripts/prerender.mjs`), served by Cloudflare Pages.

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
- Web, from `web/`: `bun run dev`, `bunx vitest run`, `bun run build` (tsc + Vite), `bunx eslint .`. After changing
  `core/` or `web/wasm/`, run `scripts/build-web-core.sh` and commit `web/src/core/`. The Cloudflare Pages project
  `tetramote-remote` builds `web/` on every push to `main` that touches it.
- Site, from `site/`: `bun run dev`, `bun run test` (builds, then `node --test`). The Cloudflare Pages project
  `tetramote` builds `site/` on every push to `main` that touches it. Download links come from GitHub's latest
  release in the browser and fall back to the release page. `scripts/build-screenshots.sh` rebuilds the homepage
  screenshots from `scripts/screenshots/`.
- Use bun, never npm or yarn. Installs skip versions published less than 7 days ago (`mobile/bunfig.toml`).

## Rules

- A wire change updates `PROTOCOL.md`, `core/`, `desktop/` (host and viewer), both native module platforms,
  `modules/remote/src/types.ts` and `web/` (rebuilt with `scripts/build-web-core.sh`) in the same commit. The link
  format lives in `core/src/link.rs`, `mobile/src/services/pairingUrl.ts` and `web/src/link.ts`.
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
