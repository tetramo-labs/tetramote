import {Channel} from "@tauri-apps/api/core"
import {getCurrentWindow} from "@tauri-apps/api/window"
import {useEffect, useRef, useState} from "react"

import {api, type ViewerInput} from "@/ipc"
import {useAppStore} from "@/store"
import {Button, Dot} from "@/ui/Kit"
import {RemoteDecoder} from "@/viewer/decoder"
import {parseFrame} from "@/viewer/frames"
import {contentRect, modifierFlags, normalized, protocolButton, scrollFromWheel} from "@/viewer/input"

const BAR = "bg-[#1f1f1f] text-[#fafafa]"

/**
 * Another computer's screen. Mouse and keyboard go to it while this window is
 * focused; input is batched per animation frame.
 */
export function Viewer() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const queue = useRef<ViewerInput[]>([])
  const load = useAppStore((s) => s.load)
  const client = useAppStore((s) => s.client)
  const [fps, setFps] = useState(0)
  const [decodeError, setDecodeError] = useState<string | null>(
    RemoteDecoder.supported()
      ? null
      : "This system's web view can't decode video. Update it (WebKitGTK 2.46 or later on Linux).",
  )
  const [hasPicture, setHasPicture] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!RemoteDecoder.supported()) return
    let frames = 0
    const counter = setInterval(() => {
      setFps(frames)
      frames = 0
    }, 1000)
    const decoder = new RemoteDecoder({
      draw: (frame) => {
        const c = canvas.current
        if (c) {
          if (c.width !== frame.displayWidth || c.height !== frame.displayHeight) {
            c.width = frame.displayWidth
            c.height = frame.displayHeight
          }
          c.getContext("2d")?.drawImage(frame, 0, 0)
          setHasPicture(true)
        }
        frame.close()
        frames++
      },
      needKeyframe: () => void api.keyframe(),
      onError: setDecodeError,
    })
    const channel = new Channel<ArrayBuffer>()
    channel.onmessage = (buffer) => {
      const frame = parseFrame(buffer)
      if (frame) decoder.push(frame)
    }
    void api.attach(channel)
    return () => {
      clearInterval(counter)
      decoder.close()
    }
  }, [])

  useEffect(() => {
    let raf = 0
    const flush = () => {
      raf = 0
      const events = queue.current
      if (events.length === 0) return
      queue.current = []
      void api.input(events)
    }
    const send = (event: ViewerInput) => {
      const q = queue.current
      if (event.kind === "moveTo" && q.length > 0 && q[q.length - 1].kind === "moveTo") q[q.length - 1] = event
      else q.push(event)
      if (!raf) raf = requestAnimationFrame(flush)
    }
    const c = canvas.current
    if (!c) return
    const point = (e: MouseEvent) =>
      normalized(e.clientX, e.clientY, contentRect(c.getBoundingClientRect(), c.width / Math.max(1, c.height)))
    const move = (e: MouseEvent) => send({kind: "moveTo", ...point(e)})
    const button = (down: boolean) => (e: MouseEvent) => {
      const b = protocolButton(e.button)
      if (b === null) return
      e.preventDefault()
      send({kind: "moveTo", ...point(e)})
      send({kind: "button", button: b, down, clicks: Math.max(1, Math.min(3, e.detail || 1))})
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      send(scrollFromWheel(e))
    }
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "SELECT") return
      e.preventDefault()
      send({kind: "key", code: e.code, down, flags: modifierFlags(e)})
    }
    const onDown = button(true)
    const onUp = button(false)
    const onKeyDown = key(true)
    const onKeyUp = key(false)
    const noMenu = (e: Event) => e.preventDefault()
    c.addEventListener("mousemove", move)
    c.addEventListener("mousedown", onDown)
    c.addEventListener("mouseup", onUp)
    c.addEventListener("wheel", wheel, {passive: false})
    c.addEventListener("contextmenu", noMenu)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      c.removeEventListener("mousemove", move)
      c.removeEventListener("mousedown", onDown)
      c.removeEventListener("mouseup", onUp)
      c.removeEventListener("wheel", wheel)
      c.removeEventListener("contextmenu", noMenu)
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  const status = client?.status
  const connected = status?.kind === "connected"
  const name = status && status.kind !== "idle" ? status.name : ""
  const path = status?.kind === "connected" ? (status.path === "relay" ? "Relay" : "Direct") : null
  const rtt = status?.kind === "connected" && status.rttMs !== null ? `${status.rttMs} ms` : null
  const blocked =
    client?.remoteStatus && !client.remoteStatus.screenRecording
      ? `${name} hasn't allowed Screen Recording for Tetratop yet. Allow it in Tetratop's menu on that computer.`
      : client?.remoteStatus && !client.remoteStatus.accessibility
        ? `${name} hasn't allowed Accessibility for Tetratop, so input won't work until it does.`
        : null

  return (
    <div className="flex h-screen flex-col bg-black">
      <div className={`flex h-10 shrink-0 items-center gap-3 px-3 text-[12px] ${BAR}`}>
        <Dot
          tone={
            connected
              ? path === "Relay"
                ? "warning"
                : "success"
              : status?.kind === "failed"
                ? "destructive"
                : "primary"
          }
        />
        <span className="font-medium">{name}</span>
        <span className="text-[#a3a3a3]">
          {[path, rtt, connected ? `${fps} fps` : null].filter(Boolean).join(" · ")}
        </span>
        <div className="flex-1" />
        {client && client.displays.length > 1 && (
          <select
            value={client.activeDisplay ?? ""}
            onChange={(e) => void api.selectDisplay(Number(e.target.value))}
            className="rounded-md bg-[#2e2e2e] px-2 py-1 text-[12px] outline-none">
            {client.displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        {client && (
          <Button
            kind="secondary"
            className="!border-[#525252] !bg-[#2e2e2e] !text-[#fafafa]"
            onClick={() => void api.setAudio(!client.playAudio)}>
            {client.playAudio ? "Sound on" : "Sound off"}
          </Button>
        )}
        <Button
          kind="destructive"
          onClick={() => {
            void api.clientDisconnect()
            void getCurrentWindow().close()
          }}>
          Disconnect
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <canvas ref={canvas} className="h-full w-full cursor-none object-contain" width={16} height={10} />
        {(!connected || !hasPicture || decodeError || blocked) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
            <div className="max-w-[420px] rounded-3xl bg-[#2e2e2e] px-6 py-5 text-center text-[13px] text-[#fafafa]">
              {status?.kind === "failed"
                ? status.message
                : (decodeError ?? blocked ?? (connected ? "Waiting for the screen…" : `Connecting to ${name}…`))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
