import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import { MESSAGE_SELECTABLE_ATTR } from "../quote-selection"
import type { MessageSelection } from "../message-select-action"

export function QuoteSelectable({
  className,
  children,
  messageRole = "assistant",
}: {
  className?: string
  children: ReactNode
  messageRole?: MessageSelection["messageRole"]
}) {
  return (
    <div
      {...{ [MESSAGE_SELECTABLE_ATTR]: messageRole }}
      className={cn("min-w-0", className)}
    >
      {children}
    </div>
  )
}
