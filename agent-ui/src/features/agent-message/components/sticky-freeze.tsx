import * as React from "react"
import { cn } from "@/lib/utils"

export const StickyFreeze = React.forwardRef<
  HTMLDivElement,
  {
    children: React.ReactNode
    className?: string
    top?: number
  }
>(function StickyFreeze(
  {
    children,
    className,
    top = 0,
  },
  forwardedRef
) {
  return (
    <div
      ref={forwardedRef}
      data-slot="sticky-freeze"
      className={cn("sticky z-20 w-full min-w-0", className)}
      style={{ top }}
    >
      <div data-slot="sticky-freeze-content">{children}</div>
    </div>
  )
})
