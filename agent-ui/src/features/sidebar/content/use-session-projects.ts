import * as React from "react"
import { useTranslation } from "react-i18next"

import {
  archiveSession,
  deleteSession,
  listGroupedSessions,
  listRunningSessions,
  listSessionsForCwd,
  pinSession,
  renameSession,
  tagSession,
  type AgentRunHarness,
  type SessionInfo,
  type SessionProjectGroup,
} from "@/lib/api/sandbox-sessions"

export type SessionProjectsStatus =
  | "loading"
  | "ready"
  | "error"
  | "unsupported"

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function useSessionProjects(harness: AgentRunHarness | null) {
  const { t } = useTranslation()
  const loadFailed = t("sidebar.projects.loadFailed")
  const [groups, setGroups] = React.useState<SessionProjectGroup[]>([])
  const [activeCwd, setActiveCwd] = React.useState("")
  const [status, setStatus] = React.useState<SessionProjectsStatus>(
    harness ? "loading" : "unsupported"
  )
  const [error, setError] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [refreshIndex, setRefreshIndex] = React.useState(0)
  const [runningSessionIds, setRunningSessionIds] = React.useState<
    ReadonlySet<string>
  >(() => new Set())

  const refresh = React.useCallback(() => {
    setRefreshIndex((current) => current + 1)
  }, [])

  React.useEffect(() => {
    if (!harness) {
      setGroups([])
      setActiveCwd("")
      setError(null)
      setRefreshing(false)
      setRunningSessionIds(new Set())
      setStatus("unsupported")
      return
    }

    let cancelled = false
    setStatus((current) => (current === "ready" ? "ready" : "loading"))
    setRefreshing(true)
    setError(null)

    void listGroupedSessions(harness)
      .then((payload) => {
        if (cancelled) {
          return
        }
        setGroups(payload.groups)
        setActiveCwd(payload.activeCwd)
        setStatus("ready")
        setRefreshing(false)
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return
        }
        setGroups([])
        setStatus("error")
        setRefreshing(false)
        setError(errorMessage(caught, loadFailed))
      })

    return () => {
      cancelled = true
    }
  }, [harness, loadFailed, refreshIndex])

  React.useEffect(() => {
    if (!harness) {
      return
    }

    let cancelled = false

    const pull = async () => {
      try {
        const running = await listRunningSessions(harness)
        if (cancelled) {
          return
        }
        setRunningSessionIds(
          new Set(
            running.flatMap((item) =>
              item.sessionId ? [item.sessionId] : []
            )
          )
        )
      } catch {
        // Keep the last known live set if a poll fails.
      }
    }

    void pull()
    const timer = window.setInterval(() => {
      void pull()
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [harness, refreshIndex])

  const replaceSession = React.useCallback(
    (sessionId: string, patch: Partial<SessionInfo>) => {
      setGroups((current) =>
        current.map((group) => ({
          ...group,
          sessions: group.sessions.map((session) =>
            session.sessionId === sessionId ? { ...session, ...patch } : session
          ),
        }))
      )
    },
    []
  )

  const loadMore = React.useCallback(
    async (cwd: string) => {
      if (!harness) {
        return
      }

      const payload = await listSessionsForCwd(harness, cwd, { limit: 100 })
      setGroups((current) =>
        current.map((group) =>
          group.cwd === cwd
            ? {
                ...group,
                sessions: payload.sessions,
                hasMore: payload.sessions.length < payload.total,
              }
            : group
        )
      )
    },
    [harness]
  )

  const setPinned = React.useCallback(
    async (sessionId: string, pinned: boolean) => {
      if (!harness) {
        return
      }
      replaceSession(sessionId, { pinned })
      try {
        await pinSession(harness, sessionId, pinned)
        refresh()
      } catch {
        refresh()
      }
    },
    [harness, refresh, replaceSession]
  )

  const archive = React.useCallback(
    async (sessionId: string) => {
      if (!harness) {
        return
      }
      setGroups((current) =>
        current.map((group) => ({
          ...group,
          sessions: group.sessions.filter(
            (session) => session.sessionId !== sessionId
          ),
        }))
      )
      try {
        await archiveSession(harness, sessionId, true)
        refresh()
      } catch {
        refresh()
      }
    },
    [harness, refresh]
  )

  const setTags = React.useCallback(
    async (sessionId: string, tags: string[]) => {
      if (!harness) {
        return
      }
      const result = await tagSession(harness, sessionId, tags)
      replaceSession(sessionId, {
        tags: result.tags,
        tag: result.tags[0] ?? null,
        tagColors: result.tag_colors,
      })
    },
    [harness, replaceSession]
  )

  const rename = React.useCallback(
    async (sessionId: string, title: string) => {
      if (!harness) {
        return
      }
      replaceSession(sessionId, { customTitle: title, summary: title })
      try {
        await renameSession(harness, sessionId, title)
      } catch {
        refresh()
      }
    },
    [harness, refresh, replaceSession]
  )

  const remove = React.useCallback(
    async (sessionId: string) => {
      if (!harness) {
        return
      }
      setGroups((current) =>
        current.map((group) => ({
          ...group,
          sessions: group.sessions.filter(
            (session) => session.sessionId !== sessionId
          ),
        }))
      )
      try {
        await deleteSession(harness, sessionId)
        refresh()
      } catch {
        refresh()
      }
    },
    [harness, refresh]
  )

  const prependSession = React.useCallback((session: SessionInfo) => {
    const cwd = session.cwd ?? ""
    setGroups((current) => {
      const existingIndex = current.findIndex((group) => group.cwd === cwd)
      if (existingIndex < 0) {
        return [
          {
            cwd,
            pinned: false,
            hasMore: false,
            sessions: [session],
          },
          ...current,
        ]
      }

      return current.map((group, index) => {
        if (index !== existingIndex) {
          return group
        }

        if (group.sessions.some((item) => item.sessionId === session.sessionId)) {
          return {
            ...group,
            sessions: group.sessions.map((item) =>
              item.sessionId === session.sessionId ? session : item
            ),
          }
        }

        return {
          ...group,
          sessions: [session, ...group.sessions],
        }
      })
    })
  }, [])

  return {
    groups,
    activeCwd,
    status,
    error,
    refreshing,
    refresh,
    loadMore,
    setPinned,
    archive,
    setTags,
    rename,
    remove,
    prependSession,
    runningSessionIds,
  }
}
