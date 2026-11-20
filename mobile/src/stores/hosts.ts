import {create} from "zustand"

import type {PairingCode} from "@/services/pairingUrl"
import {load, save} from "@/utils/storage"

export interface PairedMac {
  id: string
  name: string
  ticket: string
  secret?: string
  pairedAt: number
  lastConnectedAt: number | null
}

const STORAGE_KEY = "hosts"

interface HostsState {
  hosts: PairedMac[]
  upsert: (host: Omit<PairedMac, "pairedAt" | "lastConnectedAt">) => void
  markConnected: (id: string, name: string) => void
  forget: (id: string) => void
  importCodes: (codes: PairingCode[]) => void
  forgetAll: () => void
}

function persist(hosts: PairedMac[]) {
  save(STORAGE_KEY, hosts)
  return {hosts}
}

export const useHostsStore = create<HostsState>()((set, get) => ({
  hosts: load<PairedMac[]>(STORAGE_KEY).value_or([]),
  upsert: (host) => {
    const existing = get().hosts.find((h) => h.id === host.id)
    const merged: PairedMac = existing ? {...existing, ...host} : {...host, pairedAt: Date.now(), lastConnectedAt: null}
    set(persist([merged, ...get().hosts.filter((h) => h.id !== host.id)]))
  },
  markConnected: (id, name) => {
    set(persist(get().hosts.map((h) => (h.id === id ? {...h, name, lastConnectedAt: Date.now()} : h))))
  },
  forget: (id) => set(persist(get().hosts.filter((h) => h.id !== id))),
  importCodes: (codes) => {
    for (const code of codes) get().upsert({id: code.endpointId, name: code.name, ticket: "", secret: code.secret})
  },
  forgetAll: () => set(persist([])),
}))
