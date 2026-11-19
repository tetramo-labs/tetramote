import {create} from "zustand"

import {api, onClientState, onHostState, type ClientState, type HostState, type SettingsView} from "@/ipc"

interface AppStore {
  host: HostState | null
  client: ClientState | null
  settings: SettingsView | null
  load: () => Promise<void>
}

/** Both services' state, kept current by the backend's events. */
export const useAppStore = create<AppStore>()((set) => ({
  host: null,
  client: null,
  settings: null,
  load: async () => {
    await onHostState((host) => set({host}))
    await onClientState((client) => set({client}))
    const [host, client, settings] = await Promise.all([api.hostState(), api.clientState(), api.settings()])
    set({host, client, settings})
  },
}))
