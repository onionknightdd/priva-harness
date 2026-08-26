import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import { ASSISTANT_SELECTABLE_ATTR } from "../quote-selection"

export function QuoteSelectable({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      {...{ [ASSISTANT_SELECTABLE_ATTR]: "" }}
      className={cn("min-w-0", className)}
    >
      {children}
    </div>
  )
}
