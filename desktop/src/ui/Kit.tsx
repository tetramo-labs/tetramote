import type {ButtonHTMLAttributes, ReactNode} from "react"

type Kind = "default" | "secondary" | "destructive"

const kinds: Record<Kind, string> = {
  default: "bg-foreground text-background",
  secondary: "bg-surface text-foreground border border-border",
  destructive: "bg-destructive text-white",
}

/** Pill button; the default is inverted (text color as the fill), as in the Glassly App. */
export function Button({
  kind = "default",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {kind?: Kind}) {
  return (
    <button
      {...rest}
      className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-opacity active:opacity-75 disabled:opacity-40 ${kinds[kind]} ${className}`}
    />
  )
}

export function GroupTitle({children}: {children: ReactNode}) {
  return <div className="mt-1 mb-1.5 px-1 text-[13px] text-muted">{children}</div>
}

/** iOS-style grouped stack: 16 px outer corners, 4 px where rows meet. */
export function Group({children}: {children: ReactNode}) {
  return (
    <div className="flex flex-col gap-1 [&>*:first-child]:rounded-t-2xl [&>*:last-child]:rounded-b-2xl">{children}</div>
  )
}

export function Row({children, className = ""}: {children: ReactNode; className?: string}) {
  return <div className={`flex items-center gap-3 rounded-[4px] bg-surface px-3.5 py-2.5 ${className}`}>{children}</div>
}

export function Toggle({checked, onChange, label}: {checked: boolean; onChange: (v: boolean) => void; label: string}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${checked ? "bg-brand-secondary" : "bg-border"}`}>
      <span
        className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-background shadow transition-[left] ${checked ? "left-[18px]" : "left-[2px]"}`}
      />
    </button>
  )
}

export function Dot({tone}: {tone: "success" | "warning" | "primary" | "muted" | "destructive"}) {
  const tones = {
    success: "bg-success",
    warning: "bg-warning",
    primary: "bg-primary",
    muted: "bg-muted",
    destructive: "bg-destructive",
  }
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${tones[tone]}`} />
}
