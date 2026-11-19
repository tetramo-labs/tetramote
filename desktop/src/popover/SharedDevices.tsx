import {api} from "@/ipc"
import {useAppStore} from "@/store"
import {Button, Group, GroupTitle, Row} from "@/ui/Kit"

/** Devices allowed to control this computer without a new code. */
export function SharedDevices() {
  const trusted = useAppStore((s) => s.host?.trusted)
  if (!trusted || trusted.length === 0) return null
  return (
    <div>
      <GroupTitle>Can control this computer</GroupTitle>
      <Group>
        {trusted.map((d) => (
          <Row key={d.id}>
            <div className="min-w-0 flex-1 truncate text-[13px]">{d.name}</div>
            <Button kind="secondary" onClick={() => void api.hostRemove(d.id)}>
              Remove
            </Button>
          </Row>
        ))}
      </Group>
    </div>
  )
}
