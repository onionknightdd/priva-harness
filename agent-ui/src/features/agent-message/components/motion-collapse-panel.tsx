import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function MotionCollapsePanel({
  open,
  children,
}: {
  open: boolean
  children: ReactNode
}) {
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "grid origin-top overflow-hidden [overflow-anchor:none]",
        "transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className="min-h-0 overflow-hidden [overflow-anchor:none]">
        {children}
      </div>
    </div>
  )
}
