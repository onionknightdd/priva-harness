"use client"

import { useHarness } from "../header/harness-context"
import { useBackgroundTasks, taskIsActive } from "@/features/agent-message/background-task-store"
import * as React from "react"
import { PinnedListItem, PinnedListTrigger } from "@animate-ui/react/primitives/pinned-list"
import { MoreHorizontalIcon, PinIcon, TagIcon } from "lucide-react"
import { motion, useIsPresent, useReducedMotionConfig } from "motion/react"
import { useTranslation } from "react-i18next"

import { StatusDot } from "@/components/kibo-ui/status"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarInput,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { SessionMenuItems, useLiveSessionStatus } from "@/features/chat-session"
import type { SessionInfo } from "@/lib/api/sandbox-sessions"

import {
  rowHoverActionButtonClassName,
  sessionHoverRevealClassName,
} from "./row-hover-action"
import { sessionDisplayTitle, type KnownSessionTag } from "./session-projects"
import { SessionTagPopover, sessionTagTriggerClassName } from "./session-tag-popover"
import { TooltipHint } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { EASE_OUT } from "@/lib/ease"

const renameTransition = {
  type: "spring" as const,
  stiffness: 420,
  damping: 34,
  mass: 0.75,
}

function SessionLiveStatus({
  sessionId,
  runningLabel,
  warmLabel,
}: {
  sessionId: string
  runningLabel: string
  warmLabel: string
}) {
  const { runningSessionIds, warmSessionIds } = useLiveSessionStatus()
  const { runHarnessId } = useHarness()
  const { t } = useTranslation()
  const tasks = useBackgroundTasks(`${runHarnessId}:${sessionId}`)
  const count = tasks.filter(taskIsActive).length
  if (count) return <span className="shrink-0 text-[10px] text-muted-foreground" title={t("backgroundTasks.count", { count })}>{t("backgroundTasks.count", { count })}</span>

  if (runningSessionIds.has(sessionId)) {
    return <StatusDot status="running" label={runningLabel} />
  }

  if (warmSessionIds.has(sessionId)) {
    return <StatusDot status="warm" label={warmLabel} />
  }

  return null
}

// Memoized: a list of sessions re-renders on selection and refresh, and each
// row carries a tag popover, a menu and several tooltips, so only rows whose
// session or active flag changed should render.
export const ProjectSessionItem = React.memo(function ProjectSessionItem({
  ref,
  session,
  isMobile,
  untitled,
  onRename,
  onSaveTags,
  onSelect,
  knownTags,
  isActive = false,
}: {
  ref?: React.Ref<HTMLLIElement>
  session: SessionInfo
  isMobile: boolean
  untitled: string
  onRename: (session: SessionInfo, title: string) => Promise<void>
  onSaveTags: (sessionId: string, tags: string[]) => Promise<void>
  onSelect: (session: SessionInfo) => void
  knownTags: KnownSessionTag[]
  isActive?: boolean
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotionConfig())
  const isPresent = useIsPresent()
  const title = sessionDisplayTitle(session, untitled)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(title)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const skipBlurCommitRef = React.useRef(false)
  const tagged = session.tags.length > 0
  const pinLabel = t(session.pinned ? "sidebar.projects.unpin" : "sidebar.projects.pin")
  // The tag popover and the "more" menu are Base UI roots with a dozen fibers
  // each; a long session list pays for them on every row. Mount them once the
  // pointer or keyboard focus reaches the row, which precedes any click on
  // them. Until then, look-alike buttons keep the layout and hover reveal.
  const [armed, setArmed] = React.useState(false)
  const arm = () => setArmed(true)

  React.useEffect(() => {
    if (!editing) {
      setDraft(title)
    }
  }, [editing, title])

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
    const nextTitle = draft.trim()
    skipBlurCommitRef.current = true
    setEditing(false)

    if (!commit || !nextTitle || nextTitle === title) {
      setDraft(title)
      return
    }

    void onRename(session, nextTitle)
  }

  const pinAction = (
    <div className={session.pinned ? undefined : sessionHoverRevealClassName}>
      <TooltipHint content={pinLabel}>
        <PinnedListTrigger
          type="button"
          className={rowHoverActionButtonClassName}
          aria-label={pinLabel}
          aria-pressed={session.pinned}
          whileTap={undefined}
          style={shouldReduceMotion ? { scale: 1 } : undefined}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <PinIcon className={cn("size-3.5", session.pinned && "fill-current")} aria-hidden="true" />
        </PinnedListTrigger>
      </TooltipHint>
    </div>
  )

  // Rows stay in one list. Ordinary layout lets reduced motion skip projection
  // completely, including the first frame of a shared-layout animation.
  return (
    <PinnedListItem
      asChild
      customTrigger
      id={session.sessionId}
      layoutId={undefined}
      layout={!shouldReduceMotion}
      data-slot="sidebar-menu-sub-item"
      initial={false}
      animate={{ opacity: 1, transform: "translateY(0%)" }}
      exit={{
        opacity: 0,
        transform: shouldReduceMotion ? "translateY(0%)" : "translateY(100%)",
        transition: { duration: shouldReduceMotion ? 0 : 0.18, ease: EASE_OUT },
      }}
    >
      <SidebarMenuSubItem
        ref={ref}
        className="rounded-md bg-sidebar"
        data-session-id={session.sessionId}
        data-exiting={!isPresent || undefined}
        inert={!isPresent}
        aria-hidden={!isPresent || undefined}
        onPointerEnter={arm}
        onFocusCapture={arm}
      >
        {editing ? (
          <motion.div
            initial={
              shouldReduceMotion ? false : { opacity: 0, scaleX: 0.96 }
            }
            animate={{ opacity: 1, scaleX: 1 }}
            transition={shouldReduceMotion ? { duration: 0 } : renameTransition}
          >
            <SidebarInput
              ref={inputRef}
              value={draft}
              aria-label={t("sidebar.projects.renameSession")}
              className="h-7 border-0 bg-[color-mix(in_oklch,var(--sidebar-accent),black_6%)] px-2 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-[color-mix(in_oklch,var(--sidebar-accent),black_12%)]"
              onChange={(event) => setDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
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
          <TooltipHint content={title}>
            <SidebarMenuSubButton
              render={<button type="button" />}
              className="w-full pr-[69px] text-left"
              isActive={isActive}
              onClick={() => onSelect(session)}
              onDoubleClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                skipBlurCommitRef.current = false
                setDraft(title)
                setEditing(true)
              }}
            >
              <SessionLiveStatus
                sessionId={session.sessionId}
                runningLabel={t("sidebar.projects.sessionRunning")}
                warmLabel={t("sidebar.projects.sessionWarm")}
              />
              <span>{title}</span>
            </SidebarMenuSubButton>
          </TooltipHint>
        )}
        {editing ? null : !armed ? (
          <div className="absolute top-1/2 right-1 z-[2] flex -translate-y-1/2 items-center gap-px">
            <div className={tagged ? undefined : sessionHoverRevealClassName}>
              <button
                type="button"
                className={sessionTagTriggerClassName(tagged)}
                aria-label={t("sidebar.projects.tag")}
                aria-pressed={tagged}
              >
                <TagIcon className={cn("size-3.5", tagged && "fill-current")} aria-hidden="true" />
              </button>
            </div>
            {pinAction}
            <div className={sessionHoverRevealClassName}>
              <button
                type="button"
                className={rowHoverActionButtonClassName}
                aria-label={t("common.more")}
              >
                <MoreHorizontalIcon className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <div className="absolute top-1/2 right-1 z-[2] flex -translate-y-1/2 items-center gap-px">
            <div className={tagged ? undefined : sessionHoverRevealClassName}>
              <SessionTagPopover
                session={session}
                knownTags={knownTags}
                isMobile={isMobile}
                reduceMotion={shouldReduceMotion}
                tagged={tagged}
                onSave={onSaveTags}
              />
            </div>
            {pinAction}
            <div className={sessionHoverRevealClassName}>
              <DropdownMenu>
                {/* No press scale here: Base UI opens the menu on pointerdown and
                    anchors to this button, so shrinking it would drag the popup
                    along and back (the "jitter" on open). */}
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className={rowHoverActionButtonClassName}
                      aria-label={t("common.more")}
                      onPointerDown={(event) => event.stopPropagation()}
                    />
                  }
                >
                  <MoreHorizontalIcon className="size-3.5" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-fit"
                  side={isMobile ? "bottom" : "right"}
                  align={isMobile ? "end" : "start"}
                >
                  <SessionMenuItems session={session} showPin={false} />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
      </SidebarMenuSubItem>
    </PinnedListItem>
  )
})
