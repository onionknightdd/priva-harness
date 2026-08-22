"use client"

import * as React from "react"
import { motion, type Transition } from "motion/react"

import { buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const actionTransition: Transition = {
  type: "spring",
  stiffness: 480,
  damping: 28,
}

const rowHoverActionsPositionClassName =
  "absolute top-1/2 right-1 z-[2] flex -translate-y-1/2 items-center gap-px"

const rowHoverActionsBaseClassName =
  "pointer-events-none opacity-0 transition-opacity duration-150 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100 motion-reduce:transition-none"

export const projectHoverActionsClassName = cn(
  rowHoverActionsPositionClassName,
  rowHoverActionsBaseClassName,
  "group-hover/menu-item:pointer-events-auto group-hover/menu-item:opacity-100 group-focus-within/menu-item:pointer-events-auto group-focus-within/menu-item:opacity-100"
)

export const sessionHoverRevealClassName = cn(
  rowHoverActionsBaseClassName,
  "group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100"
)

export const rowHoverActionButtonClassName = cn(
  buttonVariants({ variant: "ghost", size: "icon-xs" }),
  "size-5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
)

export function RowHoverAction({
  label,
  reduceMotion,
  className,
  children,
  onPointerDown,
  ...props
}: {
  label: string
  reduceMotion: boolean
  className?: string
  children: React.ReactNode
} & Omit<React.ComponentProps<typeof motion.button>, "children">) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <motion.button
            type="button"
            className={cn(rowHoverActionButtonClassName, className)}
            aria-label={label}
            whileTap={reduceMotion ? undefined : { scale: 0.8 }}
            transition={actionTransition}
            {...props}
            onPointerDown={(event) => {
              event.stopPropagation()
              onPointerDown?.(event)
            }}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
