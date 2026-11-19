import {useAppStore} from "@/store"
import {Dot} from "@/ui/Kit"

export function StatusHeader() {
  const host = useAppStore((s) => s.host)
  const status = host?.status
  const tone =
    status?.kind === "connected"
      ? "success"
      : status?.kind === "failed"
        ? "destructive"
        : status?.kind === "waiting"
          ? "primary"
          : "muted"
  const text =
    status?.kind === "connected"
      ? `${status.name} is controlling this computer`
      : status?.kind === "waiting"
        ? "Ready to share this computer"
        : status?.kind === "failed"
          ? status.message
          : "Starting…"
  return (
    <div className="flex items-center gap-2.5">
      <Dot tone={tone} />
      <div className="min-w-0">
        <div className="text-[16px] font-semibold">Tetratop</div>
        <div className="text-[12px] text-muted">{text}</div>
      </div>
    </div>
  )
}
