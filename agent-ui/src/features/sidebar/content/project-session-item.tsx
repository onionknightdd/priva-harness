"use client"

import * as React from "react"
import {
  ArchiveIcon,
  MoreHorizontalIcon,
  PinIcon,
  Trash2Icon,
} from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarInput,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import type { SessionInfo } from "@/lib/api/sandbox-sessions"

import {
  rowHoverActionButtonClassName,
  sessionHoverRevealClassName,
} from "./row-hover-action"
import { sessionDisplayTitle, type KnownSessionTag } from "./session-projects"
import { SessionTagPopover } from "./session-tag-popover"

const renameTransition = {
  type: "spring" as const,
  stiffness: 420,
  damping: 34,
  mass: 0.75,
}

export function ProjectSessionItem({
  session,
  isMobile,
  untitled,
  onArchive,
  onDelete,
  onRename,
  onSaveTags,
  knownTags,
}: {
  session: SessionInfo
  isMobile: boolean
  untitled: string
  onArchive: (session: SessionInfo) => void
  onDelete: (session: SessionInfo) => void
  onRename: (session: SessionInfo, title: string) => Promise<void>
  onSaveTags: (sessionId: string, tags: string[]) => Promise<void>
  knownTags: KnownSessionTag[]
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const title = sessionDisplayTitle(session, untitled)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(title)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const skipBlurCommitRef = React.useRef(false)
  const tagged = session.tags.length > 0

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

  return (
    <SidebarMenuSubItem>
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
        <SidebarMenuSubButton
          render={<button type="button" />}
          className="w-full pr-12 text-left"
          title={title}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            skipBlurCommitRef.current = false
            setDraft(title)
            setEditing(true)
          }}
        >
          {session.pinned ? (
            <PinIcon
              className="size-3.5 shrink-0 fill-current"
              aria-hidden="true"
            />
          ) : null}
          <span>{title}</span>
        </SidebarMenuSubButton>
      )}
      {editing ? null : (
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
          <div className={sessionHoverRevealClassName}>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <motion.button
                    type="button"
                    className={rowHoverActionButtonClassName}
                    aria-label={t("common.more")}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.8 }}
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
                <DropdownMenuItem onClick={() => onArchive(session)}>
                  <ArchiveIcon />
                  <span>{t("sidebar.projects.archive")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(session)}
                >
                  <Trash2Icon />
                  <span>{t("sidebar.projects.delete")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </SidebarMenuSubItem>
  )
}
