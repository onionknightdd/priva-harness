"use client"

import { motion, useReducedMotion, type Transition } from "motion/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

const fillTransition: Transition = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1],
}

function WorkspaceStateIcon({ active }: { active: boolean }) {
  const shouldReduceMotion = useReducedMotion()
  const transition: Transition = shouldReduceMotion
    ? { duration: 0 }
    : fillTransition

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
      <motion.rect
        y="5"
        height="14"
        rx="0.75"
        fill="currentColor"
        stroke="none"
        initial={false}
        animate={{
          x: active ? 16 : 20,
          width: active ? 4 : 0,
          opacity: active ? 1 : 0,
        }}
        transition={transition}
      />
    </svg>
  )
}

export function WorkspaceToggle({
  className,
  hideWhenMobileOpen = false,
}: {
  className?: string
  hideWhenMobileOpen?: boolean
}) {
  const { isMobile, openMobile, state, toggleSidebar } = useSidebar()
  const { t } = useTranslation()
  const active = isMobile ? openMobile : state === "expanded"
  const label = active ? t("workspace.close") : t("workspace.open")

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              "shrink-0 border-0 bg-background/80 backdrop-blur-sm",
              hideWhenMobileOpen && isMobile && openMobile && "hidden",
              className
            )}
            aria-label={label}
            aria-controls="workspace-sidebar"
            aria-expanded={active}
            aria-pressed={active}
            onClick={toggleSidebar}
          />
        }
      >
        <WorkspaceStateIcon active={active} />
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
