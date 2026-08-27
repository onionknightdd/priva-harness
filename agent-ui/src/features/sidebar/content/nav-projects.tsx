"use client"

import * as React from "react"
import claudeIcon from "@lobehub/icons-static-svg/icons/claude-color.svg"
import { ChevronRightIcon, FolderIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react"
import { motion, useReducedMotion, type Transition } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useChatSession } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"
import type { SessionInfo } from "@/lib/api/sandbox-sessions"

import { ProjectHeader } from "./project-header"
import { ProjectSessionItem } from "./project-session-item"
import { RowHoverAction, projectHoverActionsClassName } from "./row-hover-action"
import {
  collectKnownTags,
  filterGroupSessions,
  groupMatchesQuery,
  projectDisplayName,
  type KnownSessionTag,
} from "./session-projects"

const SESSION_PAGE_SIZE = 5

const emptyStateTransition: Transition = {
  type: "spring",
  stiffness: 360,
  damping: 30,
}

function ProjectFolderIcon() {
  const { runHarnessId } = useHarness()
  const showClaudeMark = runHarnessId === "claude"

  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
      <FolderIcon className="size-4" />
      {showClaudeMark ? (
        <img
          src={claudeIcon}
          alt=""
          className="pointer-events-none absolute size-1.5 object-contain"
        />
      ) : null}
    </span>
  )
}

function ProjectMenuItem({
  cwd,
  name,
  sessions,
  hasMore,
  open,
  onOpenChange,
  paginate,
  isMobile,
  reduceMotion,
  untitled,
  onLoadMore,
  onArchive,
  onDelete,
  onRename,
  onSaveTags,
  onSelect,
  onCreateSession,
  knownTags,
  activeSessionId,
  runningSessionIds,
  warmSessionIds,
}: {
  cwd: string
  name: string
  sessions: SessionInfo[]
  hasMore: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  paginate: boolean
  isMobile: boolean
  reduceMotion: boolean
  untitled: string
  onLoadMore: (cwd: string) => Promise<void>
  onArchive: (session: SessionInfo) => void
  onDelete: (session: SessionInfo) => void
  onRename: (session: SessionInfo, title: string) => Promise<void>
  onSaveTags: (sessionId: string, tags: string[]) => Promise<void>
  onSelect: (session: SessionInfo) => void
  onCreateSession: (cwd: string) => void
  knownTags: KnownSessionTag[]
  activeSessionId: string | null
  runningSessionIds: ReadonlySet<string>
  warmSessionIds: ReadonlySet<string>
}) {
  const { t } = useTranslation()
  const [visibleCount, setVisibleCount] = React.useState(SESSION_PAGE_SIZE)

  React.useEffect(() => {
    if (!open) {
      setVisibleCount(SESSION_PAGE_SIZE)
    }
  }, [open])

  const shownCount = paginate ? visibleCount : sessions.length
  const visibleSessions = sessions.slice(0, shownCount)
  const canShowMore = paginate && (sessions.length > shownCount || hasMore)

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="group/collapsible"
      render={<SidebarMenuItem />}
    >
      <div className="relative flex min-w-0 items-center">
        <CollapsibleTrigger
          render={
            <SidebarMenuButton
              tooltip={cwd || name}
              className="pr-12 text-base"
            />
          }
        >
          <ProjectFolderIcon />
          <span className="min-w-0 truncate">{name}</span>
          <ChevronRightIcon
            className="size-3.5 shrink-0 transition-transform duration-200 group-data-open/collapsible:rotate-90 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <div className={projectHoverActionsClassName}>
          <RowHoverAction
            label={t("common.more")}
            reduceMotion={reduceMotion}
          >
            <MoreHorizontalIcon className="size-3.5" aria-hidden="true" />
          </RowHoverAction>
          <RowHoverAction
            label={t("sidebar.projects.createSession")}
            reduceMotion={reduceMotion}
            onClick={() => onCreateSession(cwd)}
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
          </RowHoverAction>
        </div>
      </div>
      <CollapsibleContent className="overflow-hidden data-closed:hidden">
        <SidebarMenuSub className="ml-3.5 mr-0 pr-0">
          {visibleSessions.map((session) => (
            <ProjectSessionItem
              key={session.sessionId}
              session={session}
              isMobile={isMobile}
              untitled={untitled}
              onArchive={onArchive}
              onDelete={onDelete}
              onRename={onRename}
              onSaveTags={onSaveTags}
              onSelect={onSelect}
              knownTags={knownTags}
              isActive={session.sessionId === activeSessionId}
              isRunning={runningSessionIds.has(session.sessionId)}
              isWarm={warmSessionIds.has(session.sessionId)}
            />
          ))}
          {sessions.length === 0 && (
            <SidebarMenuSubItem>
              <span className="flex h-7 items-center px-2 text-sm text-sidebar-foreground/60">
                {t("sidebar.projects.noSessions")}
              </span>
            </SidebarMenuSubItem>
          )}
          {canShowMore && (
            <SidebarMenuSubItem>
              <button
                type="button"
                className="flex h-7 w-full items-center px-2 text-sm text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground"
                onClick={() => {
                  const nextCount = shownCount + SESSION_PAGE_SIZE
                  if (nextCount > sessions.length && hasMore) {
                    void onLoadMore(cwd).catch(() => undefined)
                  }
                  setVisibleCount(nextCount)
                }}
              >
                {t("sidebar.projects.moreSessions")}
              </button>
            </SidebarMenuSubItem>
          )}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}

function StatusMessage({
  children,
  reduceMotion,
}: {
  children: React.ReactNode
  reduceMotion: boolean
}) {
  return (
    <SidebarMenuItem>
      <motion.p
        role="status"
        className="flex h-8 items-center px-2 text-sm text-sidebar-foreground/60"
        initial={reduceMotion ? false : { opacity: 0, y: -3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : emptyStateTransition}
      >
        {children}
      </motion.p>
    </SidebarMenuItem>
  )
}

export function NavProjects({
  onSelectSession,
  onCreateSession,
}: {
  onSelectSession: (session: SessionInfo) => void
  onCreateSession: (cwd: string) => void
}) {
  const { isMobile } = useSidebar()
  const { t } = useTranslation()
  const { runHarnessId } = useHarness()
  const [projectQuery, setProjectQuery] = React.useState("")
  const [selectedTags, setSelectedTags] = React.useState<string[]>([])
  const [projectsOpen, setProjectsOpen] = React.useState(true)
  const [collapsedCwds, setCollapsedCwds] = React.useState<Set<string>>(
    () => new Set()
  )
  const projectListId = React.useId()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const untitled = t("sidebar.projects.untitledSession")
  const unknownProject = t("sidebar.projects.unknownProject")
  const {
    groups,
    activeCwd,
    status,
    error,
    refreshing,
    refresh,
    loadMore,
    archive,
    setTags,
    rename,
    remove,
    highlightedSessionId,
    runningSessionIds,
    warmSessionIds,
  } = useChatSession()

  React.useEffect(() => {
    setCollapsedCwds(new Set())
    setSelectedTags([])
  }, [runHarnessId])

  const displayGroups = React.useMemo(() => {
    if (groups.length > 0) {
      return groups
    }

    if (status === "ready" && activeCwd) {
      return [
        {
          cwd: activeCwd,
          pinned: false,
          sessions: [],
          hasMore: false,
        },
      ]
    }

    return groups
  }, [activeCwd, groups, status])

  const normalizedQuery = projectQuery.trim().toLocaleLowerCase()
  const hasSessionFilters =
    normalizedQuery.length > 0 || selectedTags.length > 0
  const filteredGroups = React.useMemo(
    () =>
      displayGroups
        .filter((group) =>
          groupMatchesQuery(
            group,
            normalizedQuery,
            untitled,
            unknownProject,
            selectedTags
          )
        )
        .map((group) => ({
          ...group,
          sessions: filterGroupSessions(
            group,
            normalizedQuery,
            untitled,
            unknownProject,
            selectedTags
          ),
        })),
    [displayGroups, normalizedQuery, selectedTags, untitled, unknownProject]
  )

  const knownTags = React.useMemo(
    () => collectKnownTags(displayGroups),
    [displayGroups]
  )

  const allSessionsExpanded =
    filteredGroups.length > 0 &&
    filteredGroups.every((group) => !collapsedCwds.has(group.cwd))

  const toggleAllSessions = () => {
    setCollapsedCwds((current) => {
      if (
        filteredGroups.length > 0 &&
        filteredGroups.every((group) => !current.has(group.cwd))
      ) {
        return new Set(filteredGroups.map((group) => group.cwd))
      }

      return new Set()
    })
  }

  const setGroupOpen = (cwd: string, open: boolean) => {
    setCollapsedCwds((current) => {
      const next = new Set(current)
      if (open) {
        next.delete(cwd)
      } else {
        next.add(cwd)
      }
      return next
    })
  }

  let listBody: React.ReactNode

  if (status === "loading") {
    listBody = Array.from({ length: 3 }, (_, index) => (
      <SidebarMenuItem key={index}>
        <Skeleton className="h-8 w-full" />
      </SidebarMenuItem>
    ))
  } else if (status === "error") {
    listBody = (
      <StatusMessage reduceMotion={shouldReduceMotion}>
        {error ?? t("sidebar.projects.loadFailed")}
      </StatusMessage>
    )
  } else if (status === "unsupported") {
    listBody = (
      <StatusMessage reduceMotion={shouldReduceMotion}>
        {t("sidebar.projects.unsupportedHarness")}
      </StatusMessage>
    )
  } else if (filteredGroups.length === 0) {
    listBody = (
      <StatusMessage reduceMotion={shouldReduceMotion}>
        {t(
          groups.length === 0 && !hasSessionFilters
            ? "sidebar.projects.empty"
            : "sidebar.projects.noResults"
        )}
      </StatusMessage>
    )
  } else {
    listBody = filteredGroups.map((group) => (
      <ProjectMenuItem
        key={group.cwd || "unknown"}
        cwd={group.cwd}
        name={projectDisplayName(group.cwd, unknownProject)}
        sessions={group.sessions}
        hasMore={group.hasMore && !hasSessionFilters}
        open={!collapsedCwds.has(group.cwd)}
        onOpenChange={(open) => setGroupOpen(group.cwd, open)}
        paginate={!hasSessionFilters}
        isMobile={isMobile}
        reduceMotion={shouldReduceMotion}
        untitled={untitled}
        onLoadMore={loadMore}
        onArchive={(session) => {
          void archive(session.sessionId)
        }}
        onDelete={(session) => {
          void remove(session.sessionId)
        }}
        onRename={(session, title) => rename(session.sessionId, title)}
        onSaveTags={setTags}
        onSelect={onSelectSession}
        onCreateSession={onCreateSession}
        knownTags={knownTags}
        activeSessionId={highlightedSessionId}
        runningSessionIds={runningSessionIds}
        warmSessionIds={warmSessionIds}
      />
    ))
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <Collapsible
        open={projectsOpen}
        onOpenChange={setProjectsOpen}
        className="w-full"
      >
        <ProjectHeader
          query={projectQuery}
          onQueryChange={setProjectQuery}
          selectedTags={selectedTags}
          onSelectedTagsChange={setSelectedTags}
          knownTags={knownTags}
          projectsOpen={projectsOpen}
          onProjectsOpenChange={setProjectsOpen}
          projectListId={projectListId}
          allSessionsExpanded={allSessionsExpanded}
          onToggleAllSessions={toggleAllSessions}
          onRefresh={refresh}
          refreshing={refreshing && status === "ready"}
        />
        <CollapsibleContent
          id={projectListId}
          className="overflow-hidden data-closed:hidden"
        >
          <SidebarMenu aria-busy={status === "loading" || refreshing}>
            {listBody}
          </SidebarMenu>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  )
}
