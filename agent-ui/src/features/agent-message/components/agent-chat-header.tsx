"use client"

import * as React from "react"
import gsap from "gsap"
import {
  CheckIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PinIcon,
} from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useChatSession } from "@/features/chat-session"
import { sessionDisplayTitle } from "@/features/sidebar/content/session-projects"
import { writeClipboardText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

const renameTransition = {
  type: "spring" as const,
  stiffness: 420,
  damping: 34,
  mass: 0.75,
}

function animateControl(control: HTMLButtonElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return
  }

  const target = control.querySelector("svg") ?? control

  gsap.fromTo(
    target,
    { scale: 0.78 },
    {
      scale: 1,
      duration: 0.28,
      ease: "back.out(2.5)",
      clearProps: "transform",
    }
  )
}

function SessionIdCopyButton({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const [copyState, setCopyState] = React.useState<
    "idle" | "copied" | "failed"
  >("idle")
  const resetTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  const tooltip =
    copyState === "copied"
      ? t("agentMessage.copied")
      : copyState === "failed"
        ? t("agentMessage.copyFailed")
        : t("agentMessage.copySessionId")

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            aria-label={tooltip}
            onClick={(event) => {
              animateControl(event.currentTarget)
              void writeClipboardText(sessionId)
                .then(() => {
                  setCopyState("copied")
                })
                .catch(() => {
                  setCopyState("failed")
                })
                .finally(() => {
                  if (resetTimerRef.current !== null) {
                    window.clearTimeout(resetTimerRef.current)
                  }

                  resetTimerRef.current = window.setTimeout(() => {
                    setCopyState("idle")
                    resetTimerRef.current = null
                  }, 1600)
                })
            }}
          />
        }
      >
        {copyState === "copied" ? (
          <CheckIcon className="size-3.5" aria-hidden="true" />
        ) : (
          <CopyIcon className="size-3.5" aria-hidden="true" />
        )}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export function AgentChatHeader() {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const { activeSession, rename, setPinned } = useChatSession()
  const untitled = t("sidebar.projects.untitledSession")
  const title = activeSession
    ? sessionDisplayTitle(activeSession, untitled)
    : t("agentMessage.testSessionTitle")
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(title)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const skipBlurCommitRef = React.useRef(false)

  React.useEffect(() => {
    setEditing(false)
    setDraft(title)
  }, [activeSession?.sessionId, title])

  React.useEffect(() => {
    if (!editing) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [editing])

  const stopEditing = (commit: boolean) => {
    if (!activeSession) {
      setEditing(false)
      return
    }

    const nextTitle = draft.trim()
    skipBlurCommitRef.current = true
    setEditing(false)

    if (!commit || !nextTitle || nextTitle === title) {
      setDraft(title)
      return
    }

    void rename(activeSession.sessionId, nextTitle)
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {editing && activeSession ? (
        <motion.div
          className="grid w-fit max-w-full min-w-0 items-center"
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={shouldReduceMotion ? { duration: 0 } : renameTransition}
        >
          <span
            aria-hidden="true"
            className="invisible col-start-1 row-start-1 whitespace-pre px-2 text-sm font-medium"
          >
            {draft || " "}
          </span>
          <Input
            ref={inputRef}
            value={draft}
            aria-label={t("sidebar.projects.renameSession")}
            className="col-start-1 row-start-1 h-7 min-w-8 border-0 bg-muted px-2 text-sm font-medium shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-muted"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false
                return
              }

              stopEditing(true)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                stopEditing(true)
              }
              if (event.key === "Escape") {
                event.preventDefault()
                stopEditing(false)
              }
            }}
          />
        </motion.div>
      ) : (
        <h1
          className={cn(
            "min-w-0 truncate text-sm font-medium",
            activeSession && "cursor-text"
          )}
          title={title}
          onDoubleClick={() => {
            if (!activeSession) {
              return
            }

            skipBlurCommitRef.current = false
            setDraft(title)
            setEditing(true)
          }}
        >
          {title}
        </h1>
      )}
      {activeSession && !editing ? (
        <div className="flex shrink-0 items-center">
          <SessionIdCopyButton sessionId={activeSession.sessionId} />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("common.more")}
                />
              }
            >
              <MoreHorizontalIcon className="size-3.5" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="bottom"
              className="min-w-28 w-fit p-0.5 text-xs"
            >
              <DropdownMenuItem
                className="gap-1.5 px-1.5 py-1 text-xs [&_svg:not([class*='size-'])]:size-3.5"
                onClick={() => {
                  void setPinned(
                    activeSession.sessionId,
                    !activeSession.pinned
                  )
                }}
              >
                <PinIcon
                  className={
                    activeSession.pinned ? "fill-current" : undefined
                  }
                />
                {activeSession.pinned
                  ? t("sidebar.projects.unpin")
                  : t("sidebar.projects.pin")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  )
}
