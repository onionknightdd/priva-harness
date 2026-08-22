"use client"

import * as React from "react"
import { Maximize2Icon, Minimize2Icon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react"
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
  duration: 0.12,
  ease: [0.22, 1, 0.36, 1],
}

const iconTransition: Transition = {
  duration: 0.1,
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

const panelButtonClassName =
  "shrink-0 border-0 bg-transparent shadow-none aria-expanded:bg-transparent aria-expanded:hover:bg-muted dark:aria-expanded:hover:bg-muted/50"

function WorkspacePanelButton({
  label,
  pressed,
  className,
  children,
  ...props
}: {
  label: string
  pressed?: boolean
  className?: string
  children: React.ReactNode
} & Omit<React.ComponentProps<typeof Button>, "children">) {
  const shouldReduceMotion = Boolean(useReducedMotion())

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(panelButtonClassName, className)}
            aria-label={label}
            aria-pressed={pressed}
            {...props}
          />
        }
      >
        <motion.span
          className="flex"
          whileTap={shouldReduceMotion ? undefined : { scale: 0.86 }}
          transition={iconTransition}
        >
          {children}
        </motion.span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
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
    <WorkspacePanelButton
      label={label}
      pressed={active}
      className={cn(
        hideWhenMobileOpen && isMobile && openMobile && "hidden",
        className
      )}
      aria-controls="workspace-sidebar"
      aria-expanded={active}
      onClick={toggleSidebar}
    >
      <WorkspaceStateIcon active={active} />
    </WorkspacePanelButton>
  )
}

export function WorkspaceExpandToggle({
  maximized,
  onToggle,
}: {
  maximized: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const label = maximized ? t("workspace.restore") : t("workspace.expand")

  return (
    <WorkspacePanelButton
      label={label}
      pressed={maximized}
      aria-controls="workspace-sidebar"
      aria-expanded={maximized}
      onClick={onToggle}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={maximized ? "restore" : "expand"}
          className="flex"
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.65 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.65 }}
          transition={shouldReduceMotion ? { duration: 0 } : iconTransition}
        >
          {maximized ? (
            <Minimize2Icon className="size-4" aria-hidden="true" />
          ) : (
            <Maximize2Icon className="size-4" aria-hidden="true" />
          )}
        </motion.span>
      </AnimatePresence>
    </WorkspacePanelButton>
  )
}

export function WorkspacePanelButtons({
  maximized,
  onMaximizedChange,
}: {
  maximized: boolean
  onMaximizedChange: (maximized: boolean) => void
}) {
  const { isMobile, openMobile, state } = useSidebar()
  const open = isMobile ? openMobile : state === "expanded"

  React.useEffect(() => {
    if (!open) {
      onMaximizedChange(false)
    }
  }, [open, onMaximizedChange])

  return (
    <div className="fixed top-1 right-4 z-40 flex items-center gap-1">
      {open && !isMobile ? (
        <WorkspaceExpandToggle
          maximized={maximized}
          onToggle={() => onMaximizedChange(!maximized)}
        />
      ) : null}
      <WorkspaceToggle hideWhenMobileOpen />
    </div>
  )
}
