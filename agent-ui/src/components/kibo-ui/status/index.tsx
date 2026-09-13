import type { ComponentProps, HTMLAttributes } from "react"

import { cn } from "@/lib/utils"
import { TooltipHint } from "@/components/ui/tooltip"

export type StatusTone = "idle" | "running" | "warm" | "success" | "warning" | "error"

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
  <span className={cn("relative flex size-full", className)} aria-hidden="true" {...props}>
    <span
      className={cn(
        "absolute inline-flex size-full rounded-full opacity-75",
        "hidden motion-safe:group-[.running]:inline-flex motion-safe:group-[.running]:animate-ping",
        "motion-safe:group-[.warm]:inline-flex motion-safe:group-[.warm]:animate-ping",
        "motion-safe:group-[.success]:inline-flex motion-safe:group-[.success]:animate-ping",
        "motion-safe:group-[.warning]:inline-flex motion-safe:group-[.warning]:animate-ping",
        "motion-safe:group-[.error]:inline-flex motion-safe:group-[.error]:animate-ping",
        "bg-status-running group-[.warm]:bg-status-warm group-[.success]:bg-status-success group-[.warning]:bg-status-warning group-[.error]:bg-status-error"
      )}
    />
    <span
      className={cn(
        "relative inline-flex size-full rounded-full",
        "bg-status-idle group-[.running]:bg-status-running group-[.warm]:bg-status-warm group-[.success]:bg-status-success group-[.warning]:bg-status-warning group-[.error]:bg-status-error"
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
    <TooltipHint content={label}>
      <Status
        status={status}
        aria-label={label}
        className={className}
        {...props}
      >
        <StatusIndicator />
      </Status>
    </TooltipHint>
  )
}
