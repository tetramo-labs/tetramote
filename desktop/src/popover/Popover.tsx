import {getCurrentWindow, LogicalSize} from "@tauri-apps/api/window"
import {useEffect, useLayoutEffect, useRef} from "react"

import {OtherComputers} from "@/popover/OtherComputers"
import {Pairing} from "@/popover/Pairing"
import {Permissions} from "@/popover/Permissions"
import {Settings} from "@/popover/Settings"
import {SharedDevices} from "@/popover/SharedDevices"
import {StatusHeader} from "@/popover/StatusHeader"
import {useAppStore} from "@/store"
import {Button} from "@/ui/Kit"
import {api} from "@/ipc"
import {scheduleUpdateChecks} from "@/updates"

const WIDTH = 360
const MAX_HEIGHT = 720

/** The menu bar popover. The window follows the content's height up to a cap, then scrolls. */
export function Popover() {
  const ref = useRef<HTMLDivElement>(null)
  const load = useAppStore((s) => s.load)

  useEffect(() => {
    void load()
    scheduleUpdateChecks(() => {
      const {host, client} = useAppStore.getState()
      return host?.status.kind === "connected" || (client !== null && client.status.kind !== "idle")
    })
  }, [load])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const resize = () => {
      const height = Math.min(MAX_HEIGHT, Math.ceil(el.scrollHeight))
      void getCurrentWindow().setSize(new LogicalSize(WIDTH, height))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    resize()
    return () => observer.disconnect()
  }, [])

  return (
    <div className="max-h-[720px] overflow-y-auto">
      <div ref={ref} className="flex flex-col gap-3 p-4">
        <StatusHeader />
        <Pairing />
        <Permissions />
        <SharedDevices />
        <OtherComputers />
        <Settings />
        <div className="flex justify-end">
          <Button kind="secondary" onClick={() => void api.quit()}>
            Quit Tetramote
          </Button>
        </div>
      </div>
    </div>
  )
}
