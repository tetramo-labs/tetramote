import {disable, enable, isEnabled} from "@tauri-apps/plugin-autostart"
import {useEffect, useState} from "react"

import {api} from "@/ipc"
import {useAppStore} from "@/store"
import {Button, Group, GroupTitle, Row, Toggle} from "@/ui/Kit"
import {useUpdates} from "@/updates"

export function Settings() {
  const settings = useAppStore((s) => s.settings)
  const hidePointer = useAppStore((s) => s.client?.hideLocalPointer ?? false)
  const [draft, setRelay] = useState<string | null>(null)
  const relay = draft ?? settings?.relayUrl ?? ""
  const [relayError, setRelayError] = useState<string | null>(null)
  const [login, setLogin] = useState(false)
  const [loginWindow, setLoginWindow] = useState(false)
  const [loginWindowBusy, setLoginWindowBusy] = useState(false)
  const [loginWindowError, setLoginWindowError] = useState<string | null>(null)
  const updates = useUpdates()
  const mac = settings?.os === "macos"

  useEffect(() => {
    isEnabled()
      .then(setLogin)
      .catch(() => setLogin(false))
    api
      .loginWindowGet()
      .then(setLoginWindow)
      .catch(() => setLoginWindow(false))
  }, [])

  const applyRelay = async () => {
    setRelayError(null)
    try {
      await api.setRelay(relay)
    } catch (e) {
      setRelayError(String(e))
    }
  }

  const toggleLogin = async (on: boolean) => {
    await (on ? enable() : disable())
    setLogin(await isEnabled())
  }

  const toggleLoginWindow = async (on: boolean) => {
    setLoginWindowError(null)
    setLoginWindowBusy(true)
    try {
      setLoginWindow(await api.loginWindowSet(on))
      if (on && !(await isEnabled())) await toggleLogin(true)
    } catch (e) {
      setLoginWindowError(String(e))
      setLoginWindow(await api.loginWindowGet().catch(() => false))
    } finally {
      setLoginWindowBusy(false)
    }
  }

  const updateText =
    updates.phase === "checking"
      ? "Checking…"
      : updates.phase === "upToDate"
        ? "Up to date"
        : updates.phase === "available"
          ? `Version ${updates.version} is ready`
          : updates.phase === "installing"
            ? "Installing…"
            : null

  return (
    <div>
      <GroupTitle>Settings</GroupTitle>
      <Group>
        <Row className="flex-col !items-stretch gap-1.5">
          <div className="text-[13px]">Relay</div>
          <div className="flex gap-2">
            <input
              value={relay}
              onChange={(e) => setRelay(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void applyRelay()}
              placeholder="Public n0 relays"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-brand-secondary"
            />
            <Button kind="secondary" disabled={relay === settings?.relayUrl} onClick={() => void applyRelay()}>
              Apply
            </Button>
          </div>
          <div className="text-[11px] text-muted">
            Used when devices can't reach each other directly. Leave empty for n0's public relays.
          </div>
          {relayError && <div className="text-[11px] text-destructive">{relayError}</div>}
        </Row>
        <Row>
          <div className="flex-1 text-[13px]">Show local pointer</div>
          <Toggle
            label="Show local pointer"
            checked={!hidePointer}
            onChange={(v) => void api.setHideLocalPointer(!v)}
          />
        </Row>
        <Row>
          <div className="flex-1 text-[13px]">Open at login</div>
          <Toggle label="Open at login" checked={login} onChange={(v) => void toggleLogin(v)} />
        </Row>
        {mac && (
          <Row className="flex-col !items-stretch gap-1">
            <div className="flex items-center">
              <div className="flex-1 text-[13px]">Open at boot</div>
              <Toggle
                label="Open at boot"
                checked={loginWindow}
                disabled={loginWindowBusy}
                onChange={(v) => void toggleLoginWindow(v)}
              />
            </div>
            <div className="text-[11px] text-muted">
              Runs at the login screen after a restart or log out, so paired devices can connect and log in. Turning it
              on asks for an administrator password.
            </div>
            {loginWindowError && <div className="text-[11px] text-destructive">{loginWindowError}</div>}
          </Row>
        )}
        <Row className="flex-col !items-stretch gap-2">
          <div className="flex items-center">
            <div className="flex-1 text-[13px]">Check for and install updates automatically</div>
            <Toggle
              label="Check for and install updates automatically"
              checked={updates.auto}
              onChange={updates.setAuto}
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 text-[11px] text-muted">
              Version {settings?.version}
              {updateText ? ` · ${updateText}` : ""}
            </div>
            {updates.phase === "available" ? (
              <Button onClick={() => void updates.install()}>Install</Button>
            ) : (
              <Button kind="secondary" disabled={updates.phase === "checking"} onClick={() => void updates.check()}>
                Check for updates
              </Button>
            )}
          </div>
          {updates.error && <div className="text-[11px] text-destructive">{updates.error}</div>}
        </Row>
      </Group>
    </div>
  )
}
