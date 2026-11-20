import init, {enable_logs, mac_key_code, Session} from "@/core/tetra_web"

const EVENT_STATE = 1
const EVENT_CONTROL = 2
const EVENT_VIDEO = 4
const EVENT_AUDIO = 5

export type RemoteState =
  | {type: "connecting"}
  | {type: "connected"; hostName: string; endpointId: string; path: string; rttMs: number | null}
  | {type: "path"; path: string; rttMs: number | null}
  | {type: "rejected"; reason: string}
  | {type: "disconnected"; reason: string}

export interface Display {
  id: number
  name: string
  width: number
  height: number
  main: boolean
}

export type HostMessage =
  | {t: "welcome"; hostName: string}
  | {t: "status"; screenRecording: boolean; accessibility: boolean}
  | {t: "displays"; displays: Display[]; active: number}
  | {t: "video"; width: number; height: number; pointWidth: number; pointHeight: number; displayId: number}
  | {t: "audio"; sampleRate: number; channels: number}
  | {t: "clipboard"; text: string}

export interface Handlers {
  onState: (state: RemoteState) => void
  onMessage: (message: HostMessage) => void
  onVideo: (buffer: Uint8Array) => void
  onAudio: (buffer: Uint8Array) => void
}

let ready: Promise<unknown> | null = null

/** Loads the wasm module once per page; `?debug` in the URL sends iroh's logs to the console. */
export function loadCore(): Promise<unknown> {
  ready ??= init().then(() => {
    if (new URLSearchParams(window.location.search).has("debug")) enable_logs("debug")
  })
  return ready
}

export function macKeyCode(code: string): number | undefined {
  return mac_key_code(code)
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/** One browser endpoint for the page; `connect` dials the computer in a link as a guest. */
export class Remote {
  private constructor(private readonly session: Session) {}

  static async start(handlers: Handlers): Promise<Remote> {
    await loadCore()
    const session = await Session.start((event: Uint8Array) => {
      const body = event.subarray(1)
      switch (event[0]) {
        case EVENT_STATE:
          handlers.onState(JSON.parse(decoder.decode(body)) as RemoteState)
          break
        case EVENT_CONTROL:
          handlers.onMessage(JSON.parse(decoder.decode(body)) as HostMessage)
          break
        case EVENT_VIDEO:
          handlers.onVideo(body)
          break
        case EVENT_AUDIO:
          handlers.onAudio(body)
          break
      }
    })
    return new Remote(session)
  }

  connect(endpointId: string, secret: string, deviceName: string) {
    this.session.connect(endpointId, secret, deviceName)
  }

  send(message: Record<string, unknown>): boolean {
    return this.session.send_control(encoder.encode(JSON.stringify(message)))
  }

  input(records: Uint8Array): boolean {
    return records.length > 0 && this.session.send_input(records)
  }

  disconnect() {
    this.session.disconnect()
  }

  /** Ends the session and frees this page's endpoint; the object can't be used afterwards. */
  close() {
    this.session.close()
    this.session.free()
  }
}
