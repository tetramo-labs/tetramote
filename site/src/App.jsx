import {useEffect, useState} from "react"

import {APP_STORE, LATEST, REPO, detectPlatform, fallbackLinks, latestRelease} from "./downloads.js"

const PLATFORM_NAMES = {mac: "macOS", windows: "Windows", linux: "Linux"}

export const lede =
  "Tetramote shows your Mac, Windows or Linux screen on your phone, with its sound, and sends your taps and typing back. Scan the computer's code with the app, or open its link in any browser. There's no account to make and no Tetramote server in between."

export const phoneNote =
  "Get Tetramote for iPhone on the App Store. It's optimized for the iPhone Duo and works on every iPhone with iOS 17 or later."

export const androidNote =
  "The Android app isn't on Google Play yet. Until it is, open the computer's link in your phone's browser, or build the app from the source on GitHub."

export const steps = [
  {
    title: "Install Tetramote on the computer",
    body: "Its icon is in the menu bar on a Mac and in the system tray on Windows and Linux. Click it to show a pairing code.",
  },
  {
    title: "Scan the code with your phone",
    body: "Or click Copy link on the computer and paste it into the phone. The code and link stay the same until you make a new one.",
  },
  {
    title: "Connect again without a code",
    body: "Your phone and the computer now have each other's keys, so later connections need no code. They work on the same Wi-Fi or across the internet.",
  },
]

export const features = [
  {
    title: "Screen and sound",
    body: "The screen streams as H.264 from the computer's hardware encoder where it has one, and system audio streams as Opus. Turn on connection details in Settings to see whether the connection is direct and how long a round trip takes.",
  },
  {
    title: "Trackpad or direct touch",
    body: "Drag to move the pointer, tap to click, tap with two fingers to right-click, and drag two fingers to scroll. To drag a window, hold your finger still until the phone taps back, then drag. Or switch to direct touch and tap the screen itself, pinching to zoom in.",
  },
  {
    title: "Modifier and arrow keys",
    body: "A row above the phone's keyboard has Esc, Tab, Command, Option, Control, Shift and the arrow keys. On Windows and Linux, Command and Control press Ctrl and Option presses Alt.",
  },
  {
    title: "Clipboard and displays",
    body: "Send your phone's clipboard to the computer, or copy the computer's clipboard to your phone. With more than one monitor, pick which one to show.",
  },
  {
    title: "Full screen",
    body: "The computer's screen fills the display, and the controls float on top and hide after a few seconds. Tap with three fingers to bring them back.",
  },
  {
    title: "From a browser or another computer",
    body: "Open a computer's link in any browser and its screen opens in the tab, with mouse, keyboard, touch and sound. The desktop app controls other computers too, in a window.",
  },
]

export const downloads = [
  {
    id: "mac",
    name: "macOS",
    details:
      "The app runs on Apple silicon and Intel Macs. It isn't notarized yet, so the first time you open it, allow it in System Settings › Privacy & Security. It needs Screen Recording and Accessibility permission to share the screen and take input.",
    files: [{key: "mac", label: "Download .dmg"}],
  },
  {
    id: "windows",
    name: "Windows",
    details: "Needs Windows 10 or later. Tetramote uses the GPU's H.264 encoder when there is one.",
    files: [{key: "windows", label: "Download installer"}],
  },
  {
    id: "linux",
    name: "Linux",
    details:
      "Needs GNOME or KDE Plasma with PipeWire, on Wayland or X11. It also needs glibc 2.39 or newer, which means Ubuntu 24.04, Debian 13, Fedora 40 or later.",
    files: [
      {key: "appimage", label: "AppImage"},
      {key: "deb", label: ".deb"},
    ],
  },
]

export const faq = [
  {
    q: "Does it cost anything?",
    a: "No. Tetramote is free, and its code is open source under the MIT license.",
  },
  {
    q: "Do I need an account?",
    a: "No. The computer shows a code, your phone scans it once, and from then on the two identify each other by their keys.",
  },
  {
    q: "Does it work away from home?",
    a: "Yes. Your phone reaches the computer over the internet, directly when the networks allow it and through an encrypted relay when they don't. The computer needs to be on with Tetramote running.",
  },
  {
    q: "Does my screen pass through your servers?",
    a: "No. There is no Tetramote server. When a relay is needed, it forwards packets it can't read. The relays belong to n0, the team behind iroh, and you can set your own in the phone's settings.",
  },
  {
    q: "Where do I get the phone app?",
    a: `${phoneNote} ${androidNote}`,
  },
  {
    q: "Can I use it without installing anything?",
    a: "The computer you share needs the desktop app. The device you control it from needs nothing installed. Open the computer's link in Chrome, Edge, Safari or Firefox and the screen opens in that tab. Browsers can't connect directly, so they always go through an encrypted relay.",
  },
  {
    q: "Which Linux desktops work?",
    a: "GNOME and KDE Plasma, on Wayland or X11. Tetramote shares the screen and takes input through the desktop portal, and wlroots compositors such as Sway don't offer remote input there yet.",
  },
]

function Mark({size = 28}) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true">
      <rect width="1024" height="1024" rx="230" fill="#004dfc" />
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M292 282H732A60 60 0 0 1 792 342V602A60 60 0 0 1 732 662H292A60 60 0 0 1 232 602V342A60 60 0 0 1 292 282ZM292 326A16 16 0 0 0 276 342V602A16 16 0 0 0 292 618H732A16 16 0 0 0 748 602V342A16 16 0 0 0 732 326Z"
      />
      <rect x="437" y="702" width="150" height="44" rx="22" fill="#fff" />
      <path d="M461 352 613 493H549L580 563 546 578 513 507 461 553Z" fill="#fff" />
    </svg>
  )
}

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9.5M8.5 3.5 13 8l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/** Release links start at the release page so the prerendered HTML works without JavaScript. */
function useRelease() {
  const [release, setRelease] = useState({version: null, links: fallbackLinks})
  const [platform, setPlatform] = useState(null)
  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent))
    let live = true
    latestRelease().then((latest) => {
      if (live && latest) setRelease(latest)
    })
    return () => {
      live = false
    }
  }, [])
  return {...release, platform}
}

const wrap = "mx-auto w-full max-w-[1120px] px-6"
const section = `${wrap} pt-24 pb-8 max-sm:pt-18`
const h2 = "text-[clamp(32px,4.2vw,46px)] leading-[1.08] tracking-[-0.03em]"
const h3 = "text-xl leading-snug tracking-[-0.01em]"
const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-[15px] font-semibold no-underline transition-opacity hover:opacity-85 motion-reduce:transition-none forced-colors:border forced-colors:border-[CanvasText]"
const buttonPrimary = `${buttonBase} bg-button text-button-text`
const buttonSecondary = `${buttonBase} border border-border bg-surface text-foreground dark:border-0`
const buttonOnSurface = `${buttonBase} border border-border bg-background text-foreground dark:border-0`
const actions = "flex flex-wrap gap-3 max-sm:*:flex-auto"
const group = "flex flex-col gap-1"
const groupItem =
  "rounded-[4px] bg-surface first:rounded-t-2xl last:rounded-b-2xl forced-colors:border forced-colors:border-[CanvasText]"

function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background">
      <div className={`${wrap} flex h-16 items-center gap-8`}>
        <a
          className="inline-flex items-center gap-2.5 text-lg font-semibold tracking-[-0.01em] text-foreground no-underline hover:opacity-100"
          href="/"
          aria-label="Tetramote home">
          <Mark />
          <span>Tetramote</span>
        </a>
        <nav aria-label="Sections" className="ml-auto flex gap-1 max-lg:hidden">
          {[
            ["#pairing", "How it works"],
            ["#features", "Features"],
            ["/privacy", "Privacy"],
            ["#faq", "FAQ"],
            [REPO, "GitHub"],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="px-3 py-2.5 text-[15px] text-muted no-underline hover:text-foreground hover:opacity-100">
              {label}
            </a>
          ))}
        </nav>
        <a className={`${buttonPrimary} min-h-[38px] px-4 text-sm max-lg:ml-auto`} href="#download">
          Download
        </a>
      </div>
    </header>
  )
}

function Hero({links, platform, version}) {
  const desktop = platform && platform !== "phone" ? platform : "mac"
  const primary = {
    mac: {href: links.mac, label: "Download for macOS"},
    windows: {href: links.windows, label: "Download for Windows"},
    linux: {href: "#download", label: "Download for Linux"},
  }[desktop]
  const others = Object.keys(PLATFORM_NAMES).filter((id) => id !== desktop)
  return (
    <section
      className={`${wrap} grid items-center gap-16 pt-22 pb-24 max-lg:gap-14 max-lg:pt-14 max-lg:pb-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]`}>
      <div>
        <h1 className="text-[clamp(44px,6.4vw,72px)] leading-[1.02] tracking-[-0.035em]">
          Control your computer from your phone.
        </h1>
        <p className="mt-7 max-w-[34em] text-[19px] text-muted max-sm:text-lg">{lede}</p>
        <div className={`${actions} mt-9`}>
          {platform === "phone" ? (
            <a className={buttonPrimary} href="#download">
              Get it for your computer
            </a>
          ) : (
            <a className={buttonPrimary} href={primary.href}>
              {primary.label}
            </a>
          )}
          <a className={buttonSecondary} href="#download">
            All downloads <Arrow />
          </a>
        </div>
        <p className="mt-5 text-sm text-muted">
          Free and open source{version ? ` · Version ${version}` : ""} · Also for{" "}
          {others.map((id, i) => (
            <span key={id}>
              {i > 0 ? " and " : ""}
              <a href="#download">{PLATFORM_NAMES[id]}</a>
            </span>
          ))}
          {" · "}
          <a href={APP_STORE}>iPhone app on the App Store</a>
        </p>
      </div>
      <figure className="m-0 w-full max-w-[530px] justify-self-center max-lg:max-w-[474px]">
        <img
          src="/screenshots/laptop.webp"
          width="1060"
          height="1116"
          alt="Tetramote on a half-open iPhone Duo, in front of an iPhone 18 Pro: on the Duo, the computer's screen fills the top half and a trackpad and a row of controls the bottom half; the iPhone shows the screen above a trackpad."
        />
      </figure>
    </section>
  )
}

function Pairing() {
  return (
    <section id="pairing" className={section} aria-labelledby="pairing-title">
      <h2 id="pairing-title" className={h2}>
        Pair once, then connect from anywhere.
      </h2>
      <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="border-t border-border pt-6">
            <span className="mb-4 grid size-8 place-items-center rounded-full bg-surface text-[15px] font-semibold text-link tabular-nums">
              {i + 1}
            </span>
            <h3 className={h3}>{step.title}</h3>
            <p className="mt-2 text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Features() {
  return (
    <section id="features" className={section} aria-labelledby="features-title">
      <h2 id="features-title" className={h2}>
        What it does
      </h2>
      <div className="mt-12 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <article key={feature.title} className="border-t border-border pt-6">
            <h3 className={h3}>{feature.title}</h3>
            <p className="mt-2 text-muted">{feature.body}</p>
          </article>
        ))}
      </div>
      <div className="mt-18 grid items-center gap-12 rounded-3xl bg-surface p-12 max-lg:px-8 max-lg:py-10 max-sm:px-6 max-sm:py-8 lg:grid-cols-2 forced-colors:border forced-colors:border-[CanvasText]">
        <div className="max-w-[30em]">
          <h3 className="text-[clamp(26px,3vw,32px)] tracking-[-0.025em]">Optimized for the iPhone Duo</h3>
          <p className="mt-2 text-lg text-muted">
            Half open, the session works like a laptop, with the screen on the top half and a trackpad on the bottom.
            When the phone is folded, the Back and Close buttons and the session controls move into the status rail,
            which leaves the whole display for the screen. Other phones show the screen above the trackpad too.
          </p>
        </div>
        <figure className="m-0 w-full max-w-[405px] justify-self-center">
          <img
            src="/screenshots/folded.webp"
            width="810"
            height="849"
            alt="Tetramote on the folded iPhone Duo, in front of an iPhone 18 Pro: the computer's screen above a trackpad, with the Duo's session controls in its status rail."
          />
        </figure>
      </div>
    </section>
  )
}

function Downloads({links, version}) {
  const row = `${groupItem} grid items-start gap-x-8 gap-y-2 p-6 lg:grid-cols-[170px_minmax(0,1fr)_auto]`
  const rowActions = `${actions} max-lg:mt-3 lg:justify-end`
  return (
    <section id="download" className={section} aria-labelledby="download-title">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <h2 id="download-title" className={h2}>
          Download
        </h2>
        <a className={buttonSecondary} href={LATEST}>
          {version ? `Release notes for ${version}` : "Release notes"} <Arrow />
        </a>
      </div>
      <ul className={`${group} mt-10`}>
        {downloads.map((platform) => (
          <li key={platform.id} className={row}>
            <h3 className={`${h3} pt-0.5`}>{platform.name}</h3>
            <p className="max-w-[36em] text-muted">{platform.details}</p>
            <div className={rowActions}>
              {platform.files.map((file, i) => (
                <a key={file.key} className={i === 0 ? buttonPrimary : buttonOnSurface} href={links[file.key]}>
                  {file.label}
                </a>
              ))}
            </div>
          </li>
        ))}
        <li className={row}>
          <h3 className={`${h3} pt-0.5`}>iPhone</h3>
          <p className="max-w-[36em] text-muted">{phoneNote}</p>
          <div className={rowActions}>
            <a href={APP_STORE} className="inline-block rounded-[10px]">
              <img
                src="/app-store-badge.png"
                width="135"
                height="40"
                alt="Download on the App Store"
                className="block h-10 w-auto"
              />
            </a>
          </div>
        </li>
        <li className={row}>
          <h3 className={`${h3} pt-0.5`}>Android</h3>
          <p className="max-w-[36em] text-muted">{androidNote}</p>
          <div className={rowActions}>
            <a className={buttonPrimary} href="https://remote.tetramote.com">
              Open in a browser
            </a>
            <a className={buttonOnSurface} href={`${REPO}#build`}>
              Build instructions <Arrow />
            </a>
          </div>
        </li>
      </ul>
    </section>
  )
}

function Faq() {
  return (
    <section id="faq" className={`${section} max-w-[808px]`} aria-labelledby="faq-title">
      <h2 id="faq-title" className={h2}>
        Questions
      </h2>
      <div className={`${group} mt-10`}>
        {faq.map((item) => (
          <details key={item.q} className={`${groupItem} group`}>
            <summary className="flex min-h-15 cursor-pointer list-none items-center justify-between gap-6 px-5 py-4 text-lg font-semibold after:text-2xl after:leading-none after:font-normal after:text-muted after:content-['+'] group-open:after:content-['−'] [&::-webkit-details-marker]:hidden">
              {item.q}
            </summary>
            <p className="max-w-[40em] px-5 pb-5 text-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="mt-28 border-t border-border">
      <div
        className={`${wrap} flex flex-wrap items-center justify-between gap-x-8 gap-y-4 pt-8 pb-12 text-sm text-muted`}>
        <p>© 2026 Tetramo, Inc.</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1">
          {[
            [REPO, "GitHub"],
            [`${REPO}/releases`, "Releases"],
            [`${REPO}/blob/main/PROTOCOL.md`, "Protocol"],
            [`${REPO}/blob/main/LICENSE`, "License"],
            ["/privacy", "Privacy policy"],
            ["https://tetramo.com", "Tetramo"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="inline-block py-3 text-muted hover:text-foreground hover:opacity-100">
              {label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  )
}

export default function App() {
  const {links, platform, version} = useRelease()
  return (
    <>
      <a
        className="absolute -top-16 left-4 z-20 rounded-full bg-button px-4 py-2.5 font-semibold text-button-text no-underline focus:top-3"
        href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero links={links} platform={platform} version={version} />
        <Pairing />
        <Features />
        <Downloads links={links} version={version} />
        <Faq />
      </main>
      <Footer />
    </>
  )
}
