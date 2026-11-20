import {Channel, invoke} from "@tauri-apps/api/core"
import {listen, type UnlistenFn} from "@tauri-apps/api/event"

export type HostStatus =
  | {kind: "starting"}
  | {kind: "waiting"}
  | {kind: "connected"; name: string; path: string | null; rttMs: number | null}
  | {kind: "failed"; message: string}

export interface PairedDevice {
  id: string
  name: string
  pairedAt: number
}

export interface HostState {
  status: HostStatus
  pairingUrl: string | null
  qrSvg: string | null
  trusted: PairedDevice[]
  screenRecording: boolean
  accessibility: boolean
  streamError: string | null
  endpointId: string | null
  encoder: string | null
}

export type ClientStatus =
  | {kind: "idle"}
  | {kind: "connecting"; name: string}
  | {kind: "connected"; name: string; path: string | null; rttMs: number | null}
  | {kind: "failed"; name: string; message: string}

export interface SavedHost {
  id: string
  name: string
  ticket: string
  lastConnectedAt: number | null
}

export interface RemoteDisplay {
  id: number
  name: string
  width: number
  height: number
  main: boolean
}

export interface ClientState {
  status: ClientStatus
  hosts: SavedHost[]
  displays: RemoteDisplay[]
  activeDisplay: number | null
  video: {width: number; height: number; displayId: number} | null
  remoteStatus: {screenRecording: boolean; accessibility: boolean} | null
  playAudio: boolean
  hideLocalPointer: boolean
}

export interface SettingsView {
  relayUrl: string
  version: string
  os: string
}

export type ViewerInput =
  | {kind: "moveTo"; x: number; y: number}
  | {kind: "button"; button: number; down: boolean; clicks: number}
  | {kind: "scroll"; dx: number; dy: number}
  | {kind: "key"; code: string; down: boolean; flags: number}

export const api = {
  hostState: () => invoke<HostState>("host_state"),
  hostNewLink: () => invoke<void>("host_new_link"),
  loginWindowGet: () => invoke<boolean>("login_window_get"),
  loginWindowSet: (enabled: boolean) => invoke<boolean>("login_window_set", {enabled}),
  hostRemove: (id: string) => invoke<void>("host_remove", {id}),
  hostDisconnect: () => invoke<void>("host_disconnect"),
  requestPermission: (kind: "screenRecording" | "accessibility") => invoke<void>("request_permission", {kind}),
  settings: () => invoke<SettingsView>("settings_get"),
  setRelay: (url: string) => invoke<void>("set_relay", {url}),
  clientState: () => invoke<ClientState>("client_state"),
  connectLink: (link: string) => invoke<void>("client_connect_link", {link}),
  connectSaved: (id: string) => invoke<void>("client_connect_saved", {id}),
  forget: (id: string) => invoke<void>("client_forget", {id}),
  clientDisconnect: () => invoke<void>("client_disconnect"),
  attach: (frames: Channel<ArrayBuffer>) => invoke<void>("viewer_attach", {frames}),
  input: (events: ViewerInput[]) => invoke<void>("viewer_input", {events}),
  selectDisplay: (id: number) => invoke<void>("viewer_select_display", {id}),
  setAudio: (enabled: boolean) => invoke<void>("viewer_set_audio", {enabled}),
  setHideLocalPointer: (hide: boolean) => invoke<void>("viewer_set_hide_local_pointer", {hide}),
  keyframe: () => invoke<void>("viewer_keyframe"),
  quit: () => invoke<void>("app_quit"),
}

export function onHostState(cb: (s: HostState) => void): Promise<UnlistenFn> {
  return listen<HostState>("host-state", (e) => cb(e.payload))
}

export function onClientState(cb: (s: ClientState) => void): Promise<UnlistenFn> {
  return listen<ClientState>("client-state", (e) => cb(e.payload))
}
