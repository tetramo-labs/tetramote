import type {HostMessage, MacDisplay, PathKind, StreamStats} from "@tetramote/remote"
import {create} from "zustand"

import type {InputMode} from "@/stores/settings"

export type SessionPhase = "idle" | "connecting" | "connected" | "reconnecting" | "failed"

export interface SessionTarget {
  id: string | null
  name: string
  ticket: string
  pairingSecret: string | null
}

export interface VideoInfo {
  width: number
  height: number
  pointWidth: number
  pointHeight: number
  displayId: number
}

/** The Mac pointer's current image as a data URI, with its size and hotspot in Mac display points. */
export interface PointerShape {
  uri: string
  width: number
  height: number
  hotX: number
  hotY: number
}

interface SessionState {
  phase: SessionPhase
  target: SessionTarget | null
  path: PathKind | null
  rttMs: number | null
  error: string | null
  screenRecording: boolean | null
  accessibility: boolean | null
  displays: MacDisplay[]
  activeDisplay: number | null
  video: VideoInfo | null
  pointerShape: PointerShape | null
  audio: boolean
  macClipboard: string | null
  stats: StreamStats | null
  inputMode: InputMode
  fullScreen: boolean
  setPhase: (phase: SessionPhase, error?: string | null) => void
  begin: (target: SessionTarget, inputMode: InputMode, fullScreen: boolean) => void
  setPath: (path: PathKind | null, rttMs: number | null) => void
  applyHostMessage: (message: HostMessage) => void
  setStats: (stats: StreamStats) => void
  setInputMode: (mode: InputMode) => void
  setFullScreen: (fullScreen: boolean) => void
  setAudio: (enabled: boolean) => void
  end: () => void
}

const empty = {
  phase: "idle" as SessionPhase,
  target: null,
  path: null,
  rttMs: null,
  error: null,
  screenRecording: null,
  accessibility: null,
  displays: [],
  activeDisplay: null,
  video: null,
  pointerShape: null,
  macClipboard: null,
  stats: null,
}

export const useSessionStore = create<SessionState>()((set) => ({
  ...empty,
  audio: true,
  inputMode: "trackpad",
  fullScreen: false,
  setPhase: (phase, error = null) => set({phase, error}),
  begin: (target, inputMode, fullScreen) => set({...empty, phase: "connecting", target, inputMode, fullScreen}),
  setPath: (path, rttMs) => set({path, rttMs}),
  applyHostMessage: (message) => {
    switch (message.t) {
      case "status":
        set({screenRecording: message.screenRecording, accessibility: message.accessibility})
        break
      case "displays":
        set({displays: message.displays, activeDisplay: message.active})
        break
      case "video":
        set({
          video: {
            width: message.width,
            height: message.height,
            pointWidth: message.pointWidth || message.width,
            pointHeight: message.pointHeight || message.height,
            displayId: message.displayId,
          },
          activeDisplay: message.displayId,
        })
        break
      case "clipboard":
        set({macClipboard: message.text})
        break
      case "pointer":
        set({
          pointerShape: {
            uri: `data:image/png;base64,${message.png}`,
            width: message.width,
            height: message.height,
            hotX: message.hotX,
            hotY: message.hotY,
          },
        })
        break
      case "welcome":
      case "audio":
        break
    }
  },
  setStats: (stats) => set({stats}),
  setInputMode: (inputMode) => set({inputMode}),
  setFullScreen: (fullScreen) => set({fullScreen}),
  setAudio: (audio) => set({audio}),
  end: () => set({...empty}),
}))
