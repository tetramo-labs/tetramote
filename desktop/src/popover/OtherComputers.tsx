import {useState} from "react"

import {api} from "@/ipc"
import {useAppStore} from "@/store"
import {Button, Dot, Group, GroupTitle, Row} from "@/ui/Kit"

/** Computers this one controls: paste a pairing link once, then connect with a click. */
export function OtherComputers() {
  const client = useAppStore((s) => s.client)
  const [link, setLink] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  if (!client) return null
  const status = client.status
  const activeName = status.kind === "idle" ? null : status.name

  const plural = (n: number) => (n === 1 ? "1 computer" : `${n} computers`)

  const transfer = async (run: () => Promise<number | null>, done: (n: number) => string) => {
    setError(null)
    setNotice(null)
    try {
      const n = await run()
      if (n !== null) setNotice(done(n))
    } catch (e) {
      setError(String(e))
    }
  }

  const connect = async (run: () => Promise<void>) => {
    setError(null)
    setNotice(null)
    try {
      await run()
      setLink("")
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div>
      <GroupTitle>Control another computer</GroupTitle>
      <Group>
        {status.kind !== "idle" && (
          <Row>
            <Dot
              tone={status.kind === "connected" ? "success" : status.kind === "failed" ? "destructive" : "primary"}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">{activeName}</div>
              <div className="text-[11px] text-muted">
                {status.kind === "connected"
                  ? "Connected"
                  : status.kind === "connecting"
                    ? "Connecting…"
                    : status.message}
              </div>
            </div>
            <Button kind="secondary" onClick={() => void api.clientDisconnect()}>
              {status.kind === "failed" ? "Dismiss" : "Disconnect"}
            </Button>
          </Row>
        )}
        {client.hosts
          .filter((h) => !(status.kind !== "idle" && h.name === activeName))
          .map((h) => (
            <Row key={h.id}>
              <div className="min-w-0 flex-1 truncate text-[13px]">{h.name}</div>
              <Button kind="secondary" onClick={() => void api.forget(h.id)}>
                Remove
              </Button>
              <Button onClick={() => void connect(() => api.connectSaved(h.id))}>Connect</Button>
            </Row>
          ))}
        <Row>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && link && void connect(() => api.connectLink(link))}
            placeholder="Paste a Tetramote link"
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-brand-secondary"
          />
          <Button disabled={!link} onClick={() => void connect(() => api.connectLink(link))}>
            Connect
          </Button>
        </Row>
        <Row>
          <div className="min-w-0 flex-1 text-[13px]">Pairing links</div>
          <Button
            kind="secondary"
            onClick={() =>
              void transfer(api.importLinks, (n) =>
                n === 0 ? "That file has no Tetramote links." : `Added ${plural(n)}.`,
              )
            }>
            Import
          </Button>
          <Button
            kind="secondary"
            onClick={() =>
              void transfer(api.exportLinks, (n) =>
                n === 0 ? "No computers to export yet. Connect with a link first." : `Exported ${plural(n)}.`,
              )
            }>
            Export
          </Button>
        </Row>
      </Group>
      {error && <div className="mt-1.5 px-1 text-[12px] text-destructive">{error}</div>}
      {notice && <div className="mt-1.5 px-1 text-[12px] text-muted">{notice}</div>}
    </div>
  )
}
