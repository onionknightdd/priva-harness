import { useEffect, useRef, useState } from "react"

import { dispatchGitUpdated, GIT_UPDATED_EVENT, type GitUpdatedDetail } from "@/lib/api/git-repository"
import { readGitStatus, type GitStatus } from "@/lib/api/git-status"

export type ProjectGitStatusOptions = {
  cwd: string
  sessionId: string | null
  isStreaming: boolean
  enabled?: boolean
}

type State = {
  cwd: string
  status: GitStatus | null
  error: string | null
}

export function useProjectGitStatus({ cwd, sessionId, isStreaming, enabled = true }: ProjectGitStatusOptions) {
  const [state, setState] = useState<State | null>(null)
  const [revision, setRevision] = useState(0)
  const rootRef = useRef<{ cwd: string; root: string | null } | null>(null)
  const notifyingRef = useRef(false)
  const previousScopeRef = useRef<ProjectGitStatusOptions | null>(null)

  useEffect(() => {
    if (!enabled || !cwd) return
    let controller: AbortController | undefined
    const refresh = () => {
      if (document.visibilityState === "hidden") return
      controller?.abort()
      const request = new AbortController()
      controller = request
      void readGitStatus(cwd, request.signal).then(
        (status) => {
          if (!request.signal.aborted) {
            rootRef.current = { cwd, root: status.root }
            setState({ cwd, status, error: null })
          }
        },
        (error: unknown) => {
          if (!request.signal.aborted) setState({ cwd, status: null, error: error instanceof Error ? error.message : String(error) })
        }
      )
    }
    const gitUpdated = (event: Event) => {
      if (notifyingRef.current) return
      const detail = (event as CustomEvent<GitUpdatedDetail>).detail
      if (!detail || detail.cwd === cwd || (detail.root && (cwd === detail.root || cwd.startsWith(`${detail.root.replace(/\/$/, "")}/`)))) refresh()
    }
    refresh()
    window.addEventListener("focus", refresh)
    window.addEventListener(GIT_UPDATED_EVENT, gitUpdated)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      controller?.abort()
      window.removeEventListener("focus", refresh)
      window.removeEventListener(GIT_UPDATED_EVENT, gitUpdated)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [cwd, sessionId, isStreaming, enabled, revision])

  useEffect(() => {
    const previous = previousScopeRef.current
    previousScopeRef.current = { cwd, sessionId, isStreaming, enabled }
    if (!enabled || !cwd || !previous) return
    if (previous.cwd === cwd && previous.sessionId === sessionId && previous.isStreaming === isStreaming && previous.enabled === enabled) return
    // Agent runs can change files or branches outside the Git panel. Notify the
    // other views only on lifecycle transitions, never in response to a read.
    notifyingRef.current = true
    try {
      dispatchGitUpdated({ cwd, root: rootRef.current?.cwd === cwd ? rootRef.current.root : null })
    } finally {
      notifyingRef.current = false
    }
  }, [cwd, sessionId, isStreaming, enabled])

  // Do not show the previous project's branch while the next request loads.
  const current = state?.cwd === cwd ? state : null
  return {
    status: current?.status ?? null,
    error: current?.error ?? null,
    retry: () => setRevision((value) => value + 1),
  }
}
