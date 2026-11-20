import {useEffect, useState} from "react"

import {LATEST, REPO, detectPlatform, fallbackLinks, latestRelease} from "./downloads.js"

const PLATFORM_NAMES = {mac: "macOS", windows: "Windows", linux: "Linux"}

export const lede =
  "Tetramote shows your Mac, Windows or Linux screen on your phone, with its sound, and sends your taps and typing back. Scan the computer's code with the app, or open its link in any browser. There's no account to make and no Tetramote server in between."

export const phoneNote =
  "The phone app isn't in the App Store or Google Play yet. Until it is, open the computer's link in your phone's browser, or build the app from the source on GitHub."

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
    body: "The screen streams as H.264 from the computer's hardware encoder where it has one, and system audio streams as Opus. A status pill shows whether the connection is direct and how long a round trip takes.",
  },
  {
    title: "Trackpad or direct touch",
    body: "Drag to move the pointer, tap to click, tap with two fingers to right-click, and drag two fingers to scroll. Tap then drag to drag a window. Or switch to direct touch and tap the screen itself, pinching to zoom in.",
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

export const privacy = [
  "The link carries a 128-bit secret after the #, which browsers never send to a web server. Make a new link and the old one stops working.",
  "Each computer keeps its key in the system keychain.",
  "Remove a device in the computer's menu and its session ends right away.",
  "The apps and the protocol are open source under the MIT license.",
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
    a: phoneNote,
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

function Header() {
  return (
    <header className="masthead">
      <div className="wrap masthead-row">
        <a className="brand" href="/" aria-label="Tetramote home">
          <Mark />
          <span>Tetramote</span>
        </a>
        <nav aria-label="Sections">
          <a href="#pairing">How it works</a>
          <a href="#features">Features</a>
          <a href="#privacy">Privacy</a>
          <a href="#faq">FAQ</a>
          <a href={REPO}>GitHub</a>
        </nav>
        <a className="button button-small button-primary" href="#download">
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
    <section className="hero wrap">
      <div className="hero-copy">
        <h1>Control your computer from your phone.</h1>
        <p className="lede">{lede}</p>
        <div className="actions">
          {platform === "phone" ? (
            <a className="button button-primary" href="#download">
              Get it for your computer
            </a>
          ) : (
            <a className="button button-primary" href={primary.href}>
              {primary.label}
            </a>
          )}
          <a className="button" href="#download">
            All downloads <Arrow />
          </a>
        </div>
        <p className="fineprint">
          Free and open source{version ? ` · Version ${version}` : ""} · Also for{" "}
          {others.map((id, i) => (
            <span key={id}>
              {i > 0 ? " and " : ""}
              <a href="#download">{PLATFORM_NAMES[id]}</a>
            </span>
          ))}
        </p>
      </div>
      <figure className="hero-shot">
        <img
          src="/screenshots/laptop.webp"
          width="760"
          height="1005"
          alt="Tetramote on a half-open iPhone Duo: the computer's screen on the top half, a trackpad and a row of controls on the bottom half."
        />
      </figure>
    </section>
  )
}

function Pairing() {
  return (
    <section id="pairing" className="section wrap" aria-labelledby="pairing-title">
      <h2 id="pairing-title">Pair once, then connect from anywhere.</h2>
      <ol className="steps">
        {steps.map((step, i) => (
          <li key={step.title}>
            <span className="step-number">{i + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Features() {
  return (
    <section id="features" className="section wrap" aria-labelledby="features-title">
      <h2 id="features-title">What it does</h2>
      <div className="feature-grid">
        {features.map((feature) => (
          <article key={feature.title}>
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </article>
        ))}
      </div>
      <div className="duo">
        <div className="duo-copy">
          <h3>Made for the iPhone Duo</h3>
          <p>
            Half open, the session works like a laptop, with the screen on the top half and a trackpad on the bottom.
            When the phone is folded, the Back and Close buttons and the session controls move into the status rail,
            which leaves the whole display for the screen. Other phones show the screen above the trackpad too.
          </p>
        </div>
        <figure className="duo-shot">
          <img
            src="/screenshots/folded.webp"
            width="560"
            height="815"
            alt="Tetramote on the folded iPhone Duo: the computer's screen above a trackpad, with the session controls in the status rail."
          />
        </figure>
      </div>
    </section>
  )
}

function Privacy() {
  return (
    <section id="privacy" className="section wrap" aria-labelledby="privacy-title">
      <div className="panel privacy">
        <div>
          <h2 id="privacy-title">There's no account and no Tetramote server.</h2>
          <p>
            Tetramote connects your devices with <a href="https://iroh.computer">iroh</a>. Every connection is
            end-to-end encrypted QUIC and goes direct whenever the networks allow it. When they don't, traffic passes
            through n0's public relays, or a relay you run yourself, which see only encrypted packets.
          </p>
          <a className="button" href={`${REPO}/blob/main/PROTOCOL.md`}>
            Read the protocol <Arrow />
          </a>
        </div>
        <ul className="facts">
          {privacy.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Downloads({links, version}) {
  return (
    <section id="download" className="section wrap" aria-labelledby="download-title">
      <div className="section-head">
        <h2 id="download-title">Download</h2>
        <a className="button" href={LATEST}>
          {version ? `Release notes for ${version}` : "Release notes"} <Arrow />
        </a>
      </div>
      <ul className="downloads">
        {downloads.map((platform) => (
          <li key={platform.id}>
            <h3>{platform.name}</h3>
            <p>{platform.details}</p>
            <div className="actions">
              {platform.files.map((file, i) => (
                <a key={file.key} className={`button${i === 0 ? " button-primary" : ""}`} href={links[file.key]}>
                  {file.label}
                </a>
              ))}
            </div>
          </li>
        ))}
        <li>
          <h3>iPhone and Android</h3>
          <p>{phoneNote}</p>
          <div className="actions">
            <a className="button button-primary" href="https://remote.tetramote.com">
              Open in a browser
            </a>
            <a className="button" href={`${REPO}#build`}>
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
    <section id="faq" className="section wrap narrow" aria-labelledby="faq-title">
      <h2 id="faq-title">Questions</h2>
      <div className="faq">
        {faq.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-row">
        <p>© 2026 Tetramo, Inc.</p>
        <nav aria-label="Footer">
          <a href={REPO}>GitHub</a>
          <a href={`${REPO}/releases`}>Releases</a>
          <a href={`${REPO}/blob/main/PROTOCOL.md`}>Protocol</a>
          <a href={`${REPO}/blob/main/LICENSE`}>License</a>
          <a href="https://tetramo.com">Tetramo</a>
        </nav>
      </div>
    </footer>
  )
}

export default function App() {
  const {links, platform, version} = useRelease()
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero links={links} platform={platform} version={version} />
        <Pairing />
        <Features />
        <Privacy />
        <Downloads links={links} version={version} />
        <Faq />
      </main>
      <Footer />
    </>
  )
}
