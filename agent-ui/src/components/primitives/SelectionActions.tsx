"use client"

import type { ReactNode } from "react"
import { useIsPresent } from "motion/react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Adapted from https://www.beautifului.dev/r/selection-actions.json.
// Keep the 36px pill and 28px controls; actions use the real message selection.
export default function SelectionActions({ actions, label, instant = false }: {
  actions: { id: string; label: string; icon: ReactNode; onSelect: () => void }[]
  label: string
  instant?: boolean
}) {
  const present = useIsPresent()
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-hidden={!present}
      inert={!present}
      className="flex h-9 w-fit max-w-[calc(100vw-16px)] items-center gap-0.5 rounded-full bg-popover p-1 font-sans text-popover-foreground shadow-modal ring-1 ring-foreground/10"
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"))
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === "ArrowRight" ? (index + 1) % buttons.length
          : event.key === "ArrowLeft" ? (index - 1 + buttons.length) % buttons.length
            : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null
        if (next !== null) {
          event.preventDefault()
          buttons[next]?.focus()
        }
      }}
    >
      {actions.map((action) => (
        <Button
          key={action.id}
          variant="ghost"
          size="xs"
          className={cn("h-7 gap-1 rounded-full px-2.5 text-xs font-normal [&_svg]:size-3.5", instant && "transition-none active:scale-100")}
          onClick={action.onSelect}
        >
          {action.icon}
          {action.label}
        </Button>
      ))}
    </div>
  )
}
