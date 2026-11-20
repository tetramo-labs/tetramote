import {
  ClipboardCopy,
  ClipboardPaste,
  Hand,
  Keyboard,
  Maximize,
  Minimize,
  Monitor,
  MousePointer2,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from "lucide-react"
import {useCallback, useEffect, useRef, useState} from "react"

import {AudioPipe} from "@/audio"
import {TouchGestures, type Geometry, type TouchMode} from "@/gestures"
import {
  codeForCharacter,
  contentRect,
  encodeRecords,
  FLAG_COMMAND,
  FLAG_CONTROL,
  FLAG_OPTION,
  FLAG_SHIFT,
  KEY_DELETE,
  KEY_DOWN,
  KEY_ESCAPE,
  KEY_LEFT,
  KEY_RETURN,
  KEY_RIGHT,
  KEY_TAB,
  KEY_UP,
  modifierFlags,
  normalized,
  protocolButton,
  scrollFromWheel,
  type InputEvent,
} from "@/input"
import type {Link} from "@/link"
import {deviceName, failureText} from "@/messages"
import {macKeyCode, Remote, type Display, type HostMessage, type RemoteState} from "@/remote"
import {parseFrame, VideoPipe} from "@/video"

type Phase = "connecting" | "connected" | "failed"

const TOUCH = window.matchMedia("(any-pointer: coarse)").matches || navigator.maxTouchPoints > 0
const NO_VIDEO = "This browser can't decode video. Open the link in a recent Chrome, Edge, Safari or Firefox."

const KEY_BAR: {label: string; title: string; flag?: number; keyCode?: number}[] = [
  {label: "esc", title: "Escape", keyCode: KEY_ESCAPE},
  {label: "tab", title: "Tab", keyCode: KEY_TAB},
  {label: "⌘", title: "Command", flag: FLAG_COMMAND},
  {label: "⌥", title: "Option", flag: FLAG_OPTION},
  {label: "⌃", title: "Control", flag: FLAG_CONTROL},
  {label: "⇧", title: "Shift", flag: FLAG_SHIFT},
  {label: "←", title: "Left arrow", keyCode: KEY_LEFT},
  {label: "↑", title: "Up arrow", keyCode: KEY_UP},
  {label: "↓", title: "Down arrow", keyCode: KEY_DOWN},
  {label: "→", title: "Right arrow", keyCode: KEY_RIGHT},
]

function BarButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`grid size-10 shrink-0 place-items-center rounded-full hover:bg-white/10 ${active ? "bg-white/15" : ""}`}>
      <Icon size={19} aria-hidden="true" />
    </button>
  )
}

/** A computer's screen in the browser. Mouse, keyboard and touch go to it; input is batched per animation frame. */
export function SessionView({link, onLeave}: {link: Link; onLeave: () => void}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const typing = useRef<HTMLTextAreaElement>(null)
  const remote = useRef<Remote | null>(null)
  const audio = useRef<AudioPipe | null>(null)
  const queue = useRef<InputEvent[]>([])
  const raf = useRef(0)
  const frames = useRef(0)
  const pictured = useRef(false)
  const stream = useRef<{pointWidth: number} | null>(null)
  const remoteClipboard = useRef<string | null>(null)
  const name = useRef(link.name)
  const soundOn = useRef(false)
  const latch = useRef(0)
  const gestures = useRef<TouchGestures | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [phase, setPhase] = useState<Phase>("connecting")
  const [failure, setFailure] = useState<string | null>(null)
  const [hostName, setHostName] = useState(link.name)
  const [rttMs, setRttMs] = useState<number | null>(null)
  const [fps, setFps] = useState(0)
  const [hasPicture, setHasPicture] = useState(false)
  const [decodeError, setDecodeError] = useState<string | null>(VideoPipe.supported() ? null : NO_VIDEO)
  const [status, setStatus] = useState<{screenRecording: boolean; accessibility: boolean} | null>(null)
  const [displays, setDisplays] = useState<Display[]>([])
  const [activeDisplay, setActiveDisplay] = useState<number | null>(null)
  const [sound, setSound] = useState(false)
  const [touchMode, setTouchMode] = useState<TouchMode>("trackpad")
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [latched, setLatched] = useState(0)
  const [fullScreen, setFullScreen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const say = useCallback((text: string) => {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  const send = useCallback((events: InputEvent[]) => {
    const q = queue.current
    for (const e of events) {
      const last = q[q.length - 1]
      if (e.kind === "moveTo" && last?.kind === "moveTo") q[q.length - 1] = e
      else if (e.kind === "move" && last?.kind === "move")
        q[q.length - 1] = {...e, dx: last.dx + e.dx, dy: last.dy + e.dy}
      else q.push(e)
    }
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      const batch = queue.current
      queue.current = []
      remote.current?.input(encodeRecords(batch))
    })
  }, [])

  const geometry = useCallback((): Geometry => {
    const c = canvas.current
    const rect = c
      ? contentRect(c.getBoundingClientRect(), c.width / Math.max(1, c.height))
      : {left: 0, top: 0, width: 1, height: 1}
    return {
      toScreen: (x, y) => normalized(x, y, rect),
      pointsPerPixel: stream.current ? stream.current.pointWidth / Math.max(1, rect.width) : 1,
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const counter = setInterval(() => {
      setFps(frames.current)
      frames.current = 0
    }, 1000)
    const video = VideoPipe.supported()
      ? new VideoPipe({
          draw: (frame) => {
            const c = canvas.current
            if (c) {
              if (c.width !== frame.displayWidth || c.height !== frame.displayHeight) {
                c.width = frame.displayWidth
                c.height = frame.displayHeight
              }
              c.getContext("2d")?.drawImage(frame, 0, 0)
              if (!pictured.current) {
                pictured.current = true
                setHasPicture(true)
              }
            }
            frame.close()
            frames.current++
          },
          needKeyframe: () => void remote.current?.send({t: "keyframe"}),
          onError: setDecodeError,
        })
      : null

    const onState = (state: RemoteState) => {
      switch (state.type) {
        case "connecting":
          setPhase("connecting")
          break
        case "connected":
          name.current = state.hostName || link.name
          setHostName(name.current)
          setRttMs(state.rttMs)
          setFailure(null)
          setPhase("connected")
          remote.current?.send({t: "setAudio", enabled: soundOn.current})
          remote.current?.send({t: "getClipboard"})
          break
        case "path":
          setRttMs(state.rttMs)
          break
        case "rejected":
        case "disconnected":
          if (state.type === "disconnected" && state.reason === "local") break
          pictured.current = false
          setHasPicture(false)
          setFailure(failureText(state.reason, name.current))
          setPhase("failed")
          break
      }
    }
    const onMessage = (message: HostMessage) => {
      switch (message.t) {
        case "status":
          setStatus({screenRecording: message.screenRecording, accessibility: message.accessibility})
          break
        case "displays":
          setDisplays(message.displays)
          setActiveDisplay(message.active)
          break
        case "video":
          stream.current = {pointWidth: message.pointWidth}
          break
        case "clipboard":
          remoteClipboard.current = message.text
          break
      }
    }

    Remote.start({
      onState,
      onMessage,
      onVideo: (buffer) => {
        const frame = parseFrame(buffer)
        if (frame) video?.push(frame)
      },
      onAudio: (buffer) => audio.current?.push(buffer),
    })
      .then((started) => {
        if (cancelled) {
          started.close()
          return
        }
        remote.current = started
        started.connect(link.endpointId, link.secret, deviceName(navigator.userAgent))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setFailure(
          `This browser couldn't start Tetramote's connection (${String(error)}). Reload the page to try again.`,
        )
        setPhase("failed")
      })

    return () => {
      cancelled = true
      clearInterval(counter)
      video?.close()
      remote.current?.close()
      remote.current = null
      audio.current?.close()
      audio.current = null
    }
  }, [link])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const touch = new TouchGestures(send, geometry)
    gestures.current = touch
    const point = (e: MouseEvent) =>
      normalized(e.clientX, e.clientY, contentRect(c.getBoundingClientRect(), c.width / Math.max(1, c.height)))
    const pointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return
      e.preventDefault()
      c.setPointerCapture(e.pointerId)
      touch.down(e.pointerId, e.clientX, e.clientY, e.timeStamp)
    }
    const pointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") touch.move(e.pointerId, e.clientX, e.clientY)
    }
    const pointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") touch.up(e.pointerId, e.timeStamp)
    }
    const pointerCancel = (e: PointerEvent) => {
      if (e.pointerType === "touch") touch.cancel()
    }
    const mouseMove = (e: MouseEvent) => send([{kind: "moveTo", ...point(e)}])
    const mouseButton = (down: boolean) => (e: MouseEvent) => {
      const button = protocolButton(e.button)
      if (button === null) return
      e.preventDefault()
      send([
        {kind: "moveTo", ...point(e)},
        {kind: "button", button, down, clicks: Math.max(1, Math.min(3, e.detail || 1))},
      ])
    }
    const mouseDown = mouseButton(true)
    const mouseUp = mouseButton(false)
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      send([scrollFromWheel(e)])
    }
    const noMenu = (e: Event) => e.preventDefault()
    const noMouseFromTouch = (e: TouchEvent) => e.preventDefault()
    c.addEventListener("touchstart", noMouseFromTouch, {passive: false})
    c.addEventListener("pointerdown", pointerDown)
    c.addEventListener("pointermove", pointerMove)
    c.addEventListener("pointerup", pointerUp)
    c.addEventListener("pointercancel", pointerCancel)
    c.addEventListener("mousemove", mouseMove)
    c.addEventListener("mousedown", mouseDown)
    c.addEventListener("mouseup", mouseUp)
    c.addEventListener("wheel", wheel, {passive: false})
    c.addEventListener("contextmenu", noMenu)
    return () => {
      c.removeEventListener("pointerdown", pointerDown)
      c.removeEventListener("pointermove", pointerMove)
      c.removeEventListener("pointerup", pointerUp)
      c.removeEventListener("pointercancel", pointerCancel)
      c.removeEventListener("mousemove", mouseMove)
      c.removeEventListener("mousedown", mouseDown)
      c.removeEventListener("mouseup", mouseUp)
      c.removeEventListener("wheel", wheel)
      c.removeEventListener("contextmenu", noMenu)
      c.removeEventListener("touchstart", noMouseFromTouch)
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [send, geometry])

  useEffect(() => {
    if (gestures.current) gestures.current.mode = touchMode
  }, [touchMode])

  useEffect(() => {
    if (phase !== "connected") return
    const held = new Map<string, number>()
    const key = (down: boolean) => (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return
      const keyCode = macKeyCode(e.code)
      if (keyCode === undefined) return
      e.preventDefault()
      if (down) held.set(e.code, keyCode)
      else held.delete(e.code)
      send([{kind: "key", keyCode, down, flags: modifierFlags(e)}])
    }
    const release = () => {
      send([...held.values()].map((keyCode) => ({kind: "key", keyCode, down: false, flags: 0}) as const))
      held.clear()
    }
    const onDown = key(true)
    const onUp = key(false)
    window.addEventListener("keydown", onDown)
    window.addEventListener("keyup", onUp)
    window.addEventListener("blur", release)
    return () => {
      window.removeEventListener("keydown", onDown)
      window.removeEventListener("keyup", onUp)
      window.removeEventListener("blur", release)
      release()
    }
  }, [phase, send])

  const pressKey = useCallback(
    (keyCode: number) => {
      const flags = latch.current
      latch.current = 0
      setLatched(0)
      send([
        {kind: "key", keyCode, down: true, flags},
        {kind: "key", keyCode, down: false, flags},
      ])
    },
    [send],
  )

  const typeText = useCallback(
    (text: string) => {
      const code = latch.current && text.length === 1 ? codeForCharacter(text) : null
      const keyCode = code ? macKeyCode(code) : undefined
      if (keyCode !== undefined) pressKey(keyCode)
      else if (text) send([{kind: "text", text}])
    },
    [pressKey, send],
  )

  useEffect(() => {
    const field = typing.current
    if (!field) return
    const beforeInput = (e: globalThis.InputEvent) => {
      if (e.inputType === "insertCompositionText") return
      e.preventDefault()
      if (e.inputType === "insertText" || e.inputType === "insertReplacementText") typeText(e.data ?? "")
      else if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") pressKey(KEY_RETURN)
      else if (e.inputType.startsWith("deleteContentBackward") || e.inputType.startsWith("deleteWordBackward"))
        pressKey(KEY_DELETE)
    }
    const compositionEnd = (e: CompositionEvent) => {
      typeText(e.data)
      field.value = ""
    }
    const keyDown = (e: KeyboardEvent) => {
      if (!["Escape", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return
      const keyCode = macKeyCode(e.code)
      if (keyCode === undefined) return
      e.preventDefault()
      pressKey(keyCode)
    }
    const focus = () => setKeyboardOpen(true)
    const blur = () => setKeyboardOpen(false)
    field.addEventListener("beforeinput", beforeInput)
    field.addEventListener("compositionend", compositionEnd)
    field.addEventListener("keydown", keyDown)
    field.addEventListener("focus", focus)
    field.addEventListener("blur", blur)
    return () => {
      field.removeEventListener("beforeinput", beforeInput)
      field.removeEventListener("compositionend", compositionEnd)
      field.removeEventListener("keydown", keyDown)
      field.removeEventListener("focus", focus)
      field.removeEventListener("blur", blur)
    }
  }, [pressKey, typeText])

  useEffect(() => {
    const change = () => setFullScreen(document.fullscreenElement !== null)
    document.addEventListener("fullscreenchange", change)
    return () => document.removeEventListener("fullscreenchange", change)
  }, [])

  const toggleSound = () => {
    if (sound) {
      remote.current?.send({t: "setAudio", enabled: false})
      audio.current?.close()
      audio.current = null
      soundOn.current = false
      setSound(false)
      return
    }
    if (!AudioPipe.supported()) {
      say("This browser can't play the computer's sound. Try a recent Chrome, Edge or Safari.")
      return
    }
    audio.current ??= new AudioPipe()
    audio.current.resume()
    remote.current?.send({t: "setAudio", enabled: true})
    soundOn.current = true
    setSound(true)
  }

  const sendClipboard = () => {
    navigator.clipboard
      ?.readText()
      .then((text) => {
        remote.current?.send({t: "clipboard", text})
        say(`Sent your clipboard to ${hostName}.`)
      })
      .catch(() => say("The browser didn't share its clipboard. Allow clipboard access, then try again."))
  }

  const copyClipboard = () => {
    const text = remoteClipboard.current
    remote.current?.send({t: "getClipboard"})
    if (text === null) {
      say(`Getting ${hostName}'s clipboard. Try again in a moment.`)
      return
    }
    navigator.clipboard
      ?.writeText(text)
      .then(() => say(`Copied ${hostName}'s clipboard.`))
      .catch(() => say("The browser didn't allow copying. Allow clipboard access, then try again."))
  }

  const toggleKeyboard = () => {
    const field = typing.current
    if (!field) return
    if (document.activeElement === field) field.blur()
    else field.focus()
  }

  const toggleFullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.()
  }

  const retry = () => {
    setFailure(null)
    setPhase("connecting")
    remote.current?.connect(link.endpointId, link.secret, deviceName(navigator.userAgent))
  }

  const leave = () => {
    remote.current?.disconnect()
    onLeave()
  }

  const blocked =
    status && !status.screenRecording
      ? `${hostName} hasn't allowed Screen Recording for Tetramote yet. Allow it in Tetramote's menu on that computer.`
      : status && !status.accessibility
        ? `${hostName} hasn't allowed Accessibility for Tetramote, so input won't work until it does.`
        : null
  const notice =
    phase === "failed"
      ? failure
      : (decodeError ??
        blocked ??
        (phase === "connected"
          ? hasPicture
            ? null
            : `Waiting for ${hostName}'s screen…`
          : `Connecting to ${hostName}…`))
  const connected = phase === "connected"

  return (
    <div className="flex h-full flex-col bg-black text-ink">
      <div className="flex shrink-0 items-center gap-1 bg-bar px-2 pt-[env(safe-area-inset-top)] sm:px-3">
        <div className="flex h-12 min-w-0 flex-1 items-center gap-2.5 pl-1">
          <span
            aria-hidden="true"
            className={`size-2 shrink-0 rounded-full ${connected ? "bg-[#4ade80]" : phase === "failed" ? "bg-danger" : "bg-accent"}`}
          />
          <span className="truncate text-[14px] font-medium">{hostName}</span>
          {connected && (
            <span className="hidden truncate text-[13px] text-faint sm:inline">
              {["Relay", rttMs !== null ? `${rttMs} ms` : null, `${fps} fps`].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
        {connected && displays.length > 1 && (
          <label
            title="Display"
            className="relative grid size-10 shrink-0 place-items-center rounded-full focus-within:outline-2 focus-within:outline-accent hover:bg-white/10">
            <Monitor size={19} aria-hidden="true" />
            <select
              aria-label="Display"
              value={activeDisplay ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value)
                setActiveDisplay(id)
                remote.current?.send({t: "selectDisplay", id})
              }}
              className="absolute inset-0 cursor-pointer opacity-0">
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {connected && TOUCH && (
          <BarButton
            icon={touchMode === "trackpad" ? MousePointer2 : Hand}
            label={touchMode === "trackpad" ? "Switch to direct touch" : "Switch to trackpad"}
            onClick={() => setTouchMode(touchMode === "trackpad" ? "direct" : "trackpad")}
          />
        )}
        {connected && TOUCH && (
          <BarButton icon={Keyboard} label="Keyboard" active={keyboardOpen} onClick={toggleKeyboard} />
        )}
        {connected && (
          <>
            <BarButton icon={ClipboardPaste} label="Send your clipboard to the computer" onClick={sendClipboard} />
            <BarButton icon={ClipboardCopy} label="Copy the computer's clipboard" onClick={copyClipboard} />
            <BarButton
              icon={sound ? Volume2 : VolumeX}
              label={sound ? "Sound on" : "Sound off"}
              onClick={toggleSound}
            />
          </>
        )}
        {document.fullscreenEnabled && (
          <BarButton
            icon={fullScreen ? Minimize : Maximize}
            label={fullScreen ? "Leave full screen" : "Full screen"}
            onClick={toggleFullScreen}
          />
        )}
        <BarButton icon={X} label="Disconnect" onClick={leave} />
      </div>
      {connected && keyboardOpen && (
        <div className="flex shrink-0 gap-1 overflow-x-auto bg-bar px-2 pb-2">
          {KEY_BAR.map((k) => (
            <button
              key={k.title}
              type="button"
              title={k.title}
              aria-label={k.title}
              aria-pressed={k.flag ? (latched & k.flag) !== 0 : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                if (k.keyCode !== undefined) {
                  pressKey(k.keyCode)
                  return
                }
                latch.current ^= k.flag ?? 0
                setLatched(latch.current)
              }}
              className={`h-10 min-w-11 shrink-0 rounded-lg px-2 text-[15px] ${
                k.flag && latched & k.flag ? "bg-accent text-midnight" : "bg-white/10"
              }`}>
              {k.label}
            </button>
          ))}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvas}
          width={16}
          height={10}
          tabIndex={0}
          aria-label={`${hostName}'s screen`}
          className={`h-full w-full touch-none object-contain outline-none select-none ${TOUCH ? "" : "cursor-none"}`}
        />
        {notice && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="pointer-events-auto flex max-w-[440px] flex-col items-center gap-4 rounded-3xl bg-panel px-6 py-5 text-center">
              <p className="text-[15px] leading-normal" role="status">
                {notice}
              </p>
              {phase === "failed" && (
                <div className="flex w-full flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={retry}
                    className="min-h-11 flex-1 rounded-full bg-accent px-5 font-medium text-midnight hover:bg-accent-hover">
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={leave}
                    className="min-h-11 flex-1 rounded-full border border-line px-5 font-medium hover:bg-white/5">
                    Open another link
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[max(24px,env(safe-area-inset-bottom))] flex justify-center px-6">
            <p role="status" className="max-w-[440px] rounded-2xl bg-panel px-4 py-2.5 text-center text-[14px]">
              {toast}
            </p>
          </div>
        )}
      </div>
      <textarea
        ref={typing}
        aria-label="Type on the computer"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="pointer-events-none fixed bottom-0 left-0 h-px w-px opacity-0"
      />
    </div>
  )
}
