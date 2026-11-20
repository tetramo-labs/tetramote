import {relaunch} from "@tauri-apps/plugin-process"
import {check, type Update} from "@tauri-apps/plugin-updater"
import {create} from "zustand"

const AUTO_KEY = "tetramote.autoUpdate"
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

type Phase = "idle" | "checking" | "upToDate" | "available" | "installing" | "failed"

interface UpdateStore {
  auto: boolean
  phase: Phase
  version: string | null
  error: string | null
  setAuto: (auto: boolean) => void
  check: (opts?: {install?: boolean; busy?: boolean}) => Promise<void>
  install: () => Promise<void>
}

let pending: Update | null = null

/**
 * Checks GitHub Releases for a newer signed build. With automatic updates on,
 * a found update installs and relaunches only while nothing is connected, so
 * it never cuts a session off.
 */
export const useUpdates = create<UpdateStore>()((set, get) => ({
  auto: localStorage.getItem(AUTO_KEY) !== "false",
  phase: "idle",
  version: null,
  error: null,
  setAuto: (auto) => {
    localStorage.setItem(AUTO_KEY, String(auto))
    set({auto})
  },
  check: async ({install = false, busy = false} = {}) => {
    set({phase: "checking", error: null})
    try {
      pending = await check()
      if (!pending) {
        set({phase: "upToDate", version: null})
        return
      }
      set({phase: "available", version: pending.version})
      if (install && !busy) await get().install()
    } catch (error) {
      set({phase: "failed", error: `Checking for updates failed: ${String(error)}. Try again later.`})
    }
  },
  install: async () => {
    if (!pending) return
    set({phase: "installing"})
    try {
      await pending.downloadAndInstall()
      await relaunch()
    } catch (error) {
      set({
        phase: "failed",
        error: `Installing the update failed: ${String(error)}. Try again, or download it from GitHub.`,
      })
    }
  },
}))

export function scheduleUpdateChecks(isBusy: () => boolean) {
  const run = () => {
    const {auto} = useUpdates.getState()
    void useUpdates.getState().check({install: auto, busy: isBusy()})
  }
  setTimeout(run, 10_000)
  setInterval(run, CHECK_EVERY_MS)
}
