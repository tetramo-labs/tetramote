import {NativeModule, requireNativeModule} from "expo-modules-core"

import type {ConnectRequest, StartConfig} from "./types"

type Events = {
  onState: (event: {json: string}) => void
  onControl: (event: {json: string}) => void
  onStats: (event: {fps: number; kbps: number; dropped: number}) => void
}

declare class TetraRemoteNative extends NativeModule<Events> {
  generateSecretKey(): string
  endpointId(secretKey: string): string | null
  start(config: StartConfig): Promise<void>
  stop(): Promise<void>
  connect(request: ConnectRequest): void
  disconnect(): void
  sendControl(json: string): void
  sendInput(records: Uint8Array): void
  setAudioEnabled(enabled: boolean): void
  launchPairingUrl(): string | null
}

export const remote = requireNativeModule<TetraRemoteNative>("TetraRemote")
