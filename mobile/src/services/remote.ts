import {
  encodeInput,
  remote,
  type HostMessage,
  type InputEvent,
  type PhoneMessage,
  type RemoteState,
  type StreamPrefs,
} from "@tetramote/remote"
import * as Device from "expo-device"
import {Dimensions, PixelRatio} from "react-native"

import {translate, type TxKeyPath} from "@/i18n"
import {loadSecretKey} from "@/services/identity"
import type {PairingCode} from "@/services/pairingUrl"
import {useHostsStore, type PairedMac} from "@/stores/hosts"
import {useSessionStore} from "@/stores/session"
import {getSetting} from "@/stores/settings"

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

let started: Promise<void> | null = null
let subscribed = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0
let wantSession = false
let connectedOnce = false

function deviceName(): string {
  return getSetting("device_name").trim() || Device.deviceName || Device.modelName || "Phone"
}

function errorText(reason: string): string {
  const known: Record<string, TxKeyPath> = {
    notPaired: "errors:notPaired",
    badSecret: "errors:badSecret",
    version: "errors:version",
    badHello: "errors:badHello",
    timedOut: "errors:timedOut",
  }
  const key = known[reason]
  return key ? translate(key) : translate("errors:generic", {message: reason})
}

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

function subscribe() {
  if (subscribed) return
  subscribed = true
  remote.addListener("onState", ({json}) => {
    const state = parse<RemoteState>(json)
    if (state) handleState(state)
  })
  remote.addListener("onControl", ({json}) => {
    const message = parse<HostMessage>(json)
    if (message) useSessionStore.getState().applyHostMessage(message)
  })
  remote.addListener("onStats", (stats) => useSessionStore.getState().setStats(stats))
}

function handleState(state: RemoteState) {
  const session = useSessionStore.getState()
  switch (state.type) {
    case "connecting":
      if (session.phase !== "reconnecting") session.setPhase("connecting")
      break
    case "connected": {
      reconnectAttempt = 0
      connectedOnce = true
      const target = session.target
      if (target) {
        useHostsStore.getState().upsert({
          id: state.endpointId,
          name: state.hostName,
          ticket: target.ticket,
          ...(target.pairingSecret ? {secret: target.pairingSecret} : {}),
        })
        useHostsStore.getState().markConnected(state.endpointId, state.hostName)
        useSessionStore.setState({target: {...target, id: state.endpointId, name: state.hostName, pairingSecret: null}})
      }
      session.setPath(state.path, state.rttMs)
      session.setPhase("connected")
      send({t: "setAudio", enabled: session.audio})
      break
    }
    case "path":
      session.setPath(state.path, state.rttMs)
      break
    case "rejected":
      wantSession = false
      session.setPhase("failed", errorText(state.reason))
      break
    case "disconnected":
      if (state.reason === "local") break
      if (wantSession && connectedOnce && session.target?.id) scheduleReconnect()
      else session.setPhase("failed", errorText(state.reason))
      break
  }
}

function scheduleReconnect() {
  const session = useSessionStore.getState()
  session.setPhase("reconnecting")
  if (reconnectTimer) clearTimeout(reconnectTimer)
  const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
  reconnectAttempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    const target = useSessionStore.getState().target
    if (wantSession && target) dial(target.ticket, target.id, null)
  }, delay)
}

function streamPrefs(): StreamPrefs {
  const {width, height} = Dimensions.get("screen")
  const resolution = getSetting("stream_resolution")
  return {
    quality: getSetting("stream_quality"),
    maxLongEdge: Math.round(Math.max(width, height) * PixelRatio.get()),
    ...(resolution === "auto" ? {} : {resolution: Number(resolution)}),
  }
}

function dial(ticket: string, endpointId: string | null, pairingSecret: string | null) {
  remote.connect({
    ticket: ticket || null,
    endpointId: endpointId ?? "",
    pairingSecret,
    deviceName: deviceName(),
    stream: streamPrefs(),
  })
}

export function applyStreamQuality() {
  if (useSessionStore.getState().phase === "connected") send({t: "stream", ...streamPrefs()})
}

/** Binds the phone's iroh endpoint once per launch (again after `restart`). */
export function ensureStarted(): Promise<void> {
  subscribe()
  started ??= (async () => {
    const secretKey = await loadSecretKey()
    const relay = getSetting("relay_url").trim()
    await remote.start({secretKey, relayUrl: relay || null})
  })().catch((error: unknown) => {
    started = null
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(translate("errors:startFailed", {message}))
  })
  return started
}

export async function restart(): Promise<void> {
  disconnect()
  started = null
  await remote.stop()
  await ensureStarted()
}

/** Offers the saved secret too, so an imported computer pairs on first connect; one that trusts this phone ignores it. */
export async function connectTo(host: PairedMac): Promise<void> {
  await startSession({id: host.id, name: host.name, ticket: host.ticket, pairingSecret: host.secret ?? null})
}

export async function pair(code: PairingCode): Promise<void> {
  await startSession({id: code.endpointId, name: code.name, ticket: "", pairingSecret: code.secret})
}

async function startSession(target: {id: string | null; name: string; ticket: string; pairingSecret: string | null}) {
  wantSession = true
  connectedOnce = false
  reconnectAttempt = 0
  if (reconnectTimer) clearTimeout(reconnectTimer)
  const session = useSessionStore.getState()
  session.begin(target, getSetting("default_input_mode"), getSetting("start_full_screen"))
  session.setAudio(getSetting("play_audio"))
  remote.setAudioEnabled(getSetting("play_audio"))
  try {
    await ensureStarted()
  } catch (error) {
    session.setPhase("failed", error instanceof Error ? error.message : String(error))
    return
  }
  dial(target.ticket, target.id, target.pairingSecret)
}

export function retry() {
  const target = useSessionStore.getState().target
  if (!target) return
  wantSession = true
  useSessionStore.getState().setPhase("connecting")
  dial(target.ticket, target.id, target.pairingSecret)
}

export function disconnect() {
  wantSession = false
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  remote.disconnect()
  useSessionStore.getState().end()
}

export function send(message: PhoneMessage) {
  remote.sendControl(JSON.stringify(message))
}

export function sendInput(events: InputEvent[]) {
  if (events.length === 0) return
  remote.sendInput(encodeInput(events))
}

export function setAudio(enabled: boolean) {
  useSessionStore.getState().setAudio(enabled)
  remote.setAudioEnabled(enabled)
  send({t: "setAudio", enabled})
}
