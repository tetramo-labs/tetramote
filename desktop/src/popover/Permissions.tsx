import {api} from "@/ipc"
import {useAppStore} from "@/store"
import {Button, Group, GroupTitle, Row} from "@/ui/Kit"

/** Shown only until both grants are in place; there's nothing to do once they are. */
export function Permissions() {
  const host = useAppStore((s) => s.host)
  if (!host || (host.screenRecording && host.accessibility)) return null
  const rows = [
    {
      kind: "screenRecording" as const,
      title: "Screen Recording",
      detail: "Lets other devices see this screen.",
      granted: host.screenRecording,
    },
    {
      kind: "accessibility" as const,
      title: "Accessibility",
      detail: "Lets other devices move the pointer and type.",
      granted: host.accessibility,
    },
  ]
  return (
    <div>
      <GroupTitle>Permissions</GroupTitle>
      <Group>
        {rows.map((r) => (
          <Row key={r.kind}>
            <div className="min-w-0 flex-1">
              <div className="text-[13px]">{r.title}</div>
              <div className="text-[11px] text-muted">{r.detail}</div>
            </div>
            {r.granted ? (
              <span className="text-[12px] text-success">Allowed</span>
            ) : (
              <Button onClick={() => void api.requestPermission(r.kind)}>Allow</Button>
            )}
          </Row>
        ))}
      </Group>
    </div>
  )
}
