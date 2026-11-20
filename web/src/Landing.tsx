import jsQR from "jsqr"
import {QrCode, X} from "lucide-react"
import {useEffect, useRef, useState, type FormEvent} from "react"

import {fragmentFor, parseLink} from "@/link"

const NOT_A_LINK = "That isn't a Tetramote link. Copy it again from Tetramote on the computer, then paste it here."

function open(text: string): boolean {
  const link = parseLink(text)
  if (!link) return false
  window.location.hash = fragmentFor(link)
  return true
}

function Mark() {
  return (
    <svg width="32" height="32" viewBox="0 0 1024 1024" aria-hidden="true">
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

/** Reads QR codes from the camera until one holds a Tetramote link. */
function Scanner({onClose}: {onClose: () => void}) {
  const video = useRef<HTMLVideoElement>(null)
  const [message, setMessage] = useState(() =>
    navigator.mediaDevices
      ? "Point the camera at the code in Tetramote's menu on the computer."
      : "This browser can't use the camera on this page. Paste the link instead.",
  )

  useEffect(() => {
    if (!navigator.mediaDevices) return
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d", {willReadFrequently: true})
    const scan = () => {
      raf = requestAnimationFrame(scan)
      const v = video.current
      if (!v || !context || v.readyState < v.HAVE_ENOUGH_DATA) return
      const scale = Math.min(1, 640 / v.videoWidth)
      canvas.width = Math.round(v.videoWidth * scale)
      canvas.height = Math.round(v.videoHeight * scale)
      context.drawImage(v, 0, 0, canvas.width, canvas.height)
      const code = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, {
        inversionAttempts: "dontInvert",
      })
      if (!code) return
      if (open(code.data)) cancelAnimationFrame(raf)
      else setMessage("That code isn't a Tetramote link. Scan the code in Tetramote's menu on the computer.")
    }
    navigator.mediaDevices
      .getUserMedia({video: {facingMode: "environment"}, audio: false})
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        const v = video.current
        if (!v) return
        v.srcObject = s
        void v.play()
        raf = requestAnimationFrame(scan)
      })
      .catch(() =>
        setMessage("The camera isn't available. Allow camera access for this site, or paste the link instead."),
      )
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-black">
        <video ref={video} className="h-full w-full object-cover" playsInline muted />
        <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80" />
      </div>
      <p className="text-[15px] text-muted" role="status">
        {message}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-line px-5 font-medium hover:bg-white/5">
        <X size={18} aria-hidden="true" /> Cancel
      </button>
    </div>
  )
}

export function Landing() {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!open(text)) setError(NOT_A_LINK)
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-[560px] items-center gap-2.5 px-6 pt-8">
        <Mark />
        <span className="text-[18px] font-medium tracking-[-0.02em]">Tetramote</span>
      </header>
      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-6 py-12">
        <h1 className="text-[clamp(34px,7vw,48px)] leading-[1.05] font-medium tracking-[-0.035em] text-balance">
          Open a Tetramote link
        </h1>
        <p className="mt-4 text-[17px] text-muted">
          Paste the link from Tetramote on the computer you want to control, or scan its code. The computer opens in
          this tab.
        </p>
        <div className="mt-8">
          {scanning ? (
            <Scanner onClose={() => setScanning(false)} />
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <label htmlFor="link" className="text-[14px] text-muted">
                Link
              </label>
              <input
                id="link"
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setError(null)
                }}
                placeholder="https://remote.tetramote.com/#id=…"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={error !== null}
                aria-describedby={error ? "link-error" : undefined}
                className="min-h-12 rounded-2xl border border-line bg-panel px-4 text-[16px] text-ink placeholder:text-faint"
              />
              {error && (
                <p id="link-error" className="text-[15px] text-danger">
                  {error}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-accent px-6 font-medium text-midnight hover:bg-accent-hover">
                  Connect
                </button>
                <button
                  type="button"
                  onClick={() => setScanning(true)}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-line px-6 font-medium hover:bg-white/5">
                  <QrCode size={18} aria-hidden="true" /> Scan a code
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
      <footer className="mx-auto w-full max-w-[560px] px-6 pb-10 text-[14px] text-faint">
        Your browser reaches the computer through an encrypted iroh relay that can't read the session. Nothing is stored
        on a server.{" "}
        <a href="https://tetramote.com" className="text-accent underline underline-offset-2">
          About Tetramote
        </a>
      </footer>
    </div>
  )
}
