import { useEffect, useState } from "react"

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
          if (!request.signal.aborted) setState({ cwd, status, error: null })
        },
        (error: unknown) => {
          if (!request.signal.aborted) setState({ cwd, status: null, error: error instanceof Error ? error.message : String(error) })
        }
      )
    }
    refresh()
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      controller?.abort()
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [cwd, sessionId, isStreaming, enabled, revision])

  // Do not show the previous project's branch while the next request loads.
  const current = state?.cwd === cwd ? state : null
  return {
    status: current?.status ?? null,
    error: current?.error ?? null,
    retry: () => setRevision((value) => value + 1),
  }
}
