import type { ComponentProps, HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

export type StatusTone = "idle" | "running" | "warm"

export type StatusProps = HTMLAttributes<HTMLSpanElement> & {
  status: StatusTone
}

export const Status = ({ className, status, ...props }: StatusProps) => (
  <span
    data-slot="status"
    className={cn("group relative inline-flex size-2 shrink-0", status, className)}
    {...props}
  />
)

export type StatusIndicatorProps = HTMLAttributes<HTMLSpanElement>

export const StatusIndicator = ({
  className,
  ...props
}: StatusIndicatorProps) => (
  <span className={cn("relative flex size-2", className)} aria-hidden="true" {...props}>
    <span
      className={cn(
        "absolute inline-flex size-full rounded-full opacity-75",
        "hidden motion-safe:group-[.running]:inline-flex motion-safe:group-[.running]:animate-ping",
        "bg-status-running"
      )}
    />
    <span
      className={cn(
        "relative inline-flex size-2 rounded-full",
        "bg-status-idle group-[.running]:bg-status-running group-[.warm]:bg-status-warm"
      )}
    />
  </span>
)

export type StatusDotProps = ComponentProps<typeof Status> & {
  label: string
}

export function StatusDot({
  status,
  label,
  className,
  ...props
}: StatusDotProps) {
  return (
    <Status
      status={status}
      aria-label={label}
      title={label}
      className={className}
      {...props}
    >
      <StatusIndicator />
    </Status>
  )
}
