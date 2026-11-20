import {useState} from "react"

import {api} from "@/ipc"
import {useAppStore} from "@/store"
import {Button} from "@/ui/Kit"

function pathText(path: string | null, rttMs: number | null) {
  const kind = path === "relay" ? "Relay" : path === "direct" ? "Direct" : "Connecting"
  return rttMs === null ? kind : `${kind} · ${rttMs} ms`
}

/** The QR code and link that open this computer in a phone app, another computer or a browser, or the live session. */
export function Pairing() {
  const host = useAppStore((s) => s.host)
  const [copied, setCopied] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  if (!host) return null

  if (host.status.kind === "connected") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl bg-surface p-3.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium">{host.status.name}</div>
            <div className="text-[12px] text-muted">
              {pathText(host.status.path, host.status.rttMs)}
              {host.encoder ? ` · ${host.encoder}` : ""}
            </div>
          </div>
          <Button kind="destructive" onClick={() => void api.hostDisconnect()}>
            Disconnect
          </Button>
        </div>
        {host.streamError && <div className="text-[12px] text-destructive">{host.streamError}</div>}
      </div>
    )
  }

  const copy = async () => {
    if (!host.pairingUrl) return
    await navigator.clipboard.writeText(host.pairingUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col items-center gap-2.5 rounded-2xl bg-surface p-3.5">
      <div className="rounded-xl bg-white p-2.5">
        {host.qrSvg ? (
          <div
            className="h-[184px] w-[184px] [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{__html: host.qrSvg}}
          />
        ) : (
          <div className="h-[184px] w-[184px] animate-pulse rounded-lg bg-neutral-200" />
        )}
      </div>
      {linkError && <div className="text-center text-[12px] text-destructive">{linkError}</div>}
      <div className="flex gap-2">
        <Button
          kind="secondary"
          onClick={() => {
            setLinkError(null)
            api.hostNewLink().catch((error: unknown) => setLinkError(String(error)))
          }}>
          New link
        </Button>
        <Button kind="secondary" disabled={!host.pairingUrl} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  )
}
