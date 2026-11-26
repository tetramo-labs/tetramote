export type PathKind = "direct" | "relay"

export type RejectReason = "notPaired" | "badSecret" | "version" | "badHello"

export type RemoteState =
  | {type: "connecting"}
  | {
      type: "connected"
      hostName: string
      paired: boolean
      endpointId: string
      path: PathKind | null
      rttMs: number | null
    }
  | {type: "path"; path: PathKind; rttMs: number}
  | {type: "rejected"; reason: RejectReason}
  | {type: "disconnected"; reason: string}

export interface MacDisplay {
  id: number
  name: string
  width: number
  height: number
  main: boolean
}

export type HostMessage =
  | {t: "welcome"; v: number; hostName: string; paired: boolean}
  | {t: "status"; screenRecording: boolean; accessibility: boolean}
  | {t: "displays"; displays: MacDisplay[]; active: number}
  | {
      t: "video"
      codec: "h264"
      width: number
      height: number
      pointWidth: number
      pointHeight: number
      displayId: number
    }
  | {t: "audio"; codec: "opus"; sampleRate: number; channels: number; frameMs: number}
  | {t: "clipboard"; text: string}

export type PhoneMessage =
  | ({t: "stream"} & StreamPrefs)
  | {t: "clipboard"; text: string}
  | {t: "getClipboard"}
  | {t: "selectDisplay"; id: number}
  | {t: "setAudio"; enabled: boolean}
  | {t: "cursor"; shown: boolean}
  | {t: "keyframe"}

export interface StreamStats {
  fps: number
  kbps: number
  dropped: number
}

export interface StartConfig {
  secretKey: string
  relayUrl: string | null
}

export interface StreamPrefs {
  maxLongEdge: number
  resolution?: number
  bitrate?: number
  fps?: number
  cursor?: boolean
}

export interface ConnectRequest {
  ticket: string | null
  endpointId: string
  pairingSecret: string | null
  deviceName: string
  stream?: StreamPrefs
}

/** A hardware keyboard key: a HID usage on iOS, or an Android key code with the character the layout makes of it. */
export interface HardwareKeyEvent {
  usage?: number
  code?: number
  unicode?: number
  down: boolean
}
