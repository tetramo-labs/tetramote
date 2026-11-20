# App Store screenshots

`raw/` holds the simulator captures and `framed/` the store shots made from them. Both are committed, so a caption or
layout change only needs `frame-screenshots`.

## Capturing

From `mobile/`:

```bash
zx scripts/screenshots-ios.mjs                      # build a Release simulator app, then capture every device
zx scripts/screenshots-ios.mjs --skip-build         # reuse the newest Release simulator build
zx scripts/screenshots-ios.mjs --app path/to/Tetramote.app
zx scripts/screenshots-ios.mjs --device iphone-6.9  # or iphone-duo; all is the default
zx scripts/screenshots-ios.mjs --device iphone-duo --sim <udid>   # use an existing simulator
```

It needs Xcode 27.1 or later, Maestro, `duoctl` (`brew install skarol/tap/duoctl`), ffmpeg, ImageMagick and Helium or
Chrome (or `CHROME` set to a Chromium binary). The build step mirrors `bun ios --release --simulator` into `ios/build`
and builds the fake host (`core/target/release/examples/fakehost`) if it is missing.

No real computer is involved. The script renders `site/scripts/screenshots/desktop.html` at 2048×1280, encodes it to
H.264 and streams it from the fake host as "MacBook Pro". `.maestro/flows/screenshots.yaml` launches the app with
`-TetramotePairURL <link>`, which pairs and opens the session, then relaunches it for the home, pair sheet and settings
shots. At every capture point the flow calls the script's local capture server, which runs `xcrun simctl io screenshot`,
or on the iPhone Duo folds, rotates and shoots through `duoctl`.

Simulators are named `tetramote-shots-<device>` and reused; one left by an older Xcode is recreated. Each run sets dark
appearance and a 9:41 status bar, and shuts down the simulators it booted unless `--keep-booted` is passed.

| Device | Simulator | Raw output | Size |
|---|---|---|---|
| `iphone-6.9` | newest iPhone Pro Max | `raw/iphone-6.9/01-session … 05-keyboard.png` | 1320×2868 |
| `iphone-duo` | iPhone Duo, folded | `raw/iphone-duo-cover/01-session … 05-keyboard.png` | 1398×2034 |
| | open, landscape | `raw/iphone-duo-open/01-session.png` | 2853×2007 |
| | half open (laptop) | `raw/iphone-duo-half/01-session.png` | 2007×2853 |

## Framing

```bash
zx scripts/frame-screenshots.mjs                    # every set
zx scripts/frame-screenshots.mjs --sets iphone-duo
```

ImageMagick puts each capture in a dark rounded bezel on a brand-blue (#004dfc) to #171717 gradient under a white
SF Pro Rounded Semibold caption (from `/Library/Fonts`; it falls back to the system's SF Rounded). Every canvas is the
capture's own size. Slides and captions live in `SETS` in `scripts/frame-screenshots.mjs`; keep this table in sync.

| Framed output | Raw source | Caption |
|---|---|---|
| `framed/iphone-6.9/01-session.png` | `iphone-6.9/01-session.png` | Your computer, on your phone |
| `framed/iphone-6.9/02-keyboard.png` | `iphone-6.9/05-keyboard.png` | A full keyboard, shortcuts too |
| `framed/iphone-6.9/03-home.png` | `iphone-6.9/02-home.png` | Your computers, one tap away |
| `framed/iphone-6.9/04-pair.png` | `iphone-6.9/03-pair.png` | Pair once with a code |
| `framed/iphone-6.9/05-settings.png` | `iphone-6.9/04-settings.png` | Trackpad or touch, your choice |
| `framed/iphone-duo/01-folded.png` | `iphone-duo-cover/01-session.png` | Built for iPhone Duo |
| `framed/iphone-duo/02-open.png` | `iphone-duo-open/01-session.png` | Unfold for the whole screen |
| `framed/iphone-duo/03-laptop.png` | `iphone-duo-half/01-session.png` | Half open, it's a laptop |

## Uploading to App Store Connect

Screenshots only change on a version in `PREPARE_FOR_SUBMISSION`. The 6.9" set goes to `APP_IPHONE_69` and the Duo
set, which mixes both displays, to `APP_IPHONE_DUO`:

```bash
asc screenshots upload --app 6837369826 --version <version> --locale en-US \
  --path screenshots/framed/iphone-6.9 --device-type APP_IPHONE_69 --replace --confirm
asc screenshots upload --app 6837369826 --version <version> --locale en-US \
  --path screenshots/framed/iphone-duo --device-type APP_IPHONE_DUO --replace --confirm
```

Add `--dry-run` (without `--confirm`) to preview, and check sizes first with
`asc screenshots validate --path screenshots/framed/iphone-duo --device-type APP_IPHONE_DUO`.
