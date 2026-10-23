"use client"

import * as React from "react"
import { PinnedList } from "@animate-ui/react/primitives/pinned-list"
import claudeIcon from "@lobehub/icons-static-svg/icons/claude-color.svg"
import { ChevronRightIcon, FolderIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react"
import { AnimatePresence, LayoutGroup, motion, useReducedMotion, type Transition } from "motion/react"
import { useTranslation } from "react-i18next"
import { DirectoryPickerDialog } from "@/features/project-directory/directory-picker-dialog"

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
import { useActiveSession, useSessionList } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"
import type { SessionInfo } from "@/lib/api/sandbox-sessions"
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease"
import { collapsePanel } from "@/lib/surfaces"

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
const SessionSectionHeading = motion.create(SidebarMenuSubItem)

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
  onRename,
  onSaveTags,
  onSetPinned,
  onSelect,
  onCreateSession,
  knownTags,
  activeSessionId,
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
  onRename: (session: SessionInfo, title: string) => Promise<void>
  onSaveTags: (sessionId: string, tags: string[]) => Promise<void>
  onSetPinned: (sessionId: string, pinned: boolean) => Promise<void>
  onSelect: (session: SessionInfo) => void
  onCreateSession: (cwd: string) => void
  knownTags: KnownSessionTag[]
  activeSessionId: string | null
}) {
  const { t } = useTranslation()
  const [visibleCount, setVisibleCount] = React.useState(SESSION_PAGE_SIZE)
  const pinLayoutId = React.useId()
  const listRef = React.useRef<HTMLUListElement>(null)
  const pinFocusRef = React.useRef<{ sessionId: string; index: number } | null>(null)
  const togglePinned = React.useCallback((sessionId: string) => {
    const session = sessions.find((item) => item.sessionId === sessionId)
    if (!session) return

    const focused = document.activeElement
    const focusedRow = focused?.closest<HTMLElement>("[data-session-id]")
    pinFocusRef.current = focusedRow?.dataset.sessionId === sessionId && listRef.current?.contains(focused)
      ? { sessionId, index: Array.from(listRef.current.querySelectorAll('[data-session-id]:not([data-exiting="true"])')).indexOf(focusedRow) }
      : null
    void onSetPinned(sessionId, !session.pinned)
  }, [onSetPinned, sessions])

  React.useEffect(() => {
    if (!open) {
      setVisibleCount(SESSION_PAGE_SIZE)
    }
  }, [open])

  const shownCount = paginate ? visibleCount : sessions.length
  const visibleSessions = sessions.slice(0, shownCount)
  const canShowMore = paginate && (sessions.length > shownCount || hasMore)
  const hasPinned = sessions.some((session) => session.pinned)

  React.useLayoutEffect(() => {
    const pending = pinFocusRef.current
    if (!pending) return
    pinFocusRef.current = null
    if (visibleSessions.some((session) => session.sessionId === pending.sessionId)) return

    // The old row becomes inert while exiting. Keep keyboard navigation in
    // this project when unpinning moves the focused session beyond the page.
    const next = visibleSessions[Math.min(pending.index, visibleSessions.length - 1)]
    const nextRow = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-session-id]") ?? [])
      .find((row) => row.dataset.sessionId === next?.sessionId)
    nextRow?.querySelector<HTMLButtonElement>('[data-slot="pinned-list-trigger"]')?.focus({ preventScroll: true })
  }, [visibleSessions])

  const sectionHeading = (section: "pinned" | "unpinned") => (
    <SessionSectionHeading
      key={`section:${section}`}
      data-session-section={section}
      className={section === "pinned" ? "px-2 pb-1" : "px-2 pt-1 pb-1"}
      layout={!reduceMotion}
      initial={{ opacity: reduceMotion ? 1 : 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT, layout: SPRING_LAYOUT }}
    >
      <h4 data-session-section-title className="text-xs leading-4 font-normal text-muted-foreground/60">
        {t(section === "pinned" ? "sidebar.projects.pinnedSection" : "sidebar.projects.unpinnedSection")}
      </h4>
    </SessionSectionHeading>
  )

  // Keep sections and rows as siblings so pinning preserves each row's DOM,
  // focus, and layout animation while it crosses a section heading.
  const sessionItems: React.ReactNode[] = []
  let unpinnedHeadingAdded = false
  if (hasPinned) sessionItems.push(sectionHeading("pinned"))
  for (const session of visibleSessions) {
    if (hasPinned && !session.pinned && !unpinnedHeadingAdded) {
      sessionItems.push(sectionHeading("unpinned"))
      unpinnedHeadingAdded = true
    }
    sessionItems.push(
      <ProjectSessionItem
        key={session.sessionId}
        session={session}
        isMobile={isMobile}
        untitled={untitled}
        onRename={onRename}
        onSaveTags={onSaveTags}
        onSelect={onSelect}
        knownTags={knownTags}
        isActive={session.sessionId === activeSessionId}
      />
    )
  }
  if (hasPinned && !unpinnedHeadingAdded) sessionItems.push(sectionHeading("unpinned"))

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
              className="pr-12"
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
      <CollapsibleContent className={collapsePanel}>
        <LayoutGroup id={pinLayoutId}>
          <PinnedList onPinnedChange={togglePinned}>
            <SidebarMenuSub ref={listRef} className="relative ml-3.5 mr-0 pr-0">
              <AnimatePresence initial={false} mode="popLayout">
                {sessionItems}
              </AnimatePresence>
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
          </PinnedList>
        </LayoutGroup>
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
  const [directoryPickerOpen, setDirectoryPickerOpen] = React.useState(false)
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
    setTags,
    setPinned,
    rename,
  } = useSessionList()
  const { highlightedSessionId } = useActiveSession()

  React.useEffect(() => {
    setCollapsedCwds(new Set())
    setSelectedTags([])
    setDirectoryPickerOpen(false)
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
  // Stable so memoized session rows do not re-render with the list.
  const renameSession = React.useCallback(
    (session: SessionInfo, title: string) => rename(session.sessionId, title),
    [rename]
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
        onRename={renameSession}
        onSaveTags={setTags}
        onSetPinned={setPinned}
        onSelect={onSelectSession}
        onCreateSession={onCreateSession}
        knownTags={knownTags}
        activeSessionId={highlightedSessionId}
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
          onAddProject={() => setDirectoryPickerOpen(true)}
          addingDisabled={!runHarnessId}
          refreshing={refreshing && status === "ready"}
        />
        <CollapsibleContent id={projectListId} className={collapsePanel}>
          <SidebarMenu aria-busy={status === "loading" || refreshing}>
            {listBody}
          </SidebarMenu>
        </CollapsibleContent>
      </Collapsible>
      <DirectoryPickerDialog
        key={runHarnessId}
        open={directoryPickerOpen}
        initialPath={activeCwd}
        onOpenChange={setDirectoryPickerOpen}
        onConfirm={(cwd) => {
          setProjectQuery("")
          setSelectedTags([])
          setProjectsOpen(true)
          setGroupOpen(cwd, true)
          onCreateSession(cwd)
        }}
      />
    </SidebarGroup>
  )
}
