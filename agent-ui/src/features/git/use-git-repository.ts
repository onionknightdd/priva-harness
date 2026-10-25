import { useCallback, useEffect, useRef, useState } from "react"

import {
  dispatchGitUpdated,
  GIT_UPDATED_EVENT,
  performGitAction,
  readGitRepository,
  type GitAction,
  type GitActionOptions,
  type GitRepository,
  type GitUpdatedDetail,
} from "@/lib/api/git-repository"

export type GitRepositoryOptions = {
  cwd: string | null
  active: boolean
  onMutation?: () => void
}

type RepositoryState = {
  cwd: string | null
  repository: GitRepository | null
  loading: boolean
  error: string | null
}

type ActionState = { cwd: string | null; error: string | null; message: string | null }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useGitRepository({ cwd, active, onMutation }: GitRepositoryOptions) {
  const [state, setState] = useState<RepositoryState>({ cwd: null, repository: null, loading: false, error: null })
  const [actionState, setActionState] = useState<ActionState>({ cwd: null, error: null, message: null })
  const [busy, setBusy] = useState<GitAction | null>(null)
  const scopeRef = useRef(0)
  const mountedRef = useRef(false)
  const readRef = useRef<(() => void) | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const mutationRef = useRef<symbol | null>(null)
  const onMutationRef = useRef(onMutation)
  onMutationRef.current = onMutation

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const scope = ++scopeRef.current
    if (!cwd || !active) return

    const refresh = () => {
      if (document.visibilityState === "hidden" || mutationRef.current) return
      abortRef.current?.abort()
      const request = new AbortController()
      abortRef.current = request
      setState((previous) => ({
        cwd,
        repository: previous.cwd === cwd ? previous.repository : null,
        loading: true,
        error: null,
      }))
      void readGitRepository(cwd, request.signal).then(
        (repository) => {
          if (!request.signal.aborted && scopeRef.current === scope) {
            setState({ cwd, repository, loading: false, error: null })
          }
        },
        (error: unknown) => {
          if (!request.signal.aborted && scopeRef.current === scope) {
            setState({ cwd, repository: null, loading: false, error: errorMessage(error) })
          }
        }
      )
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        abortRef.current?.abort()
        setState((previous) => previous.cwd === cwd ? { ...previous, loading: false } : previous)
      } else refresh()
    }
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<GitUpdatedDetail>).detail
      // Cwd may be a nested directory of the repository updated by another view.
      if (!detail || detail.cwd === cwd || (detail.root && (cwd === detail.root || cwd.startsWith(`${detail.root.replace(/\/$/, "")}/`)))) refresh()
    }
    readRef.current = refresh
    refresh()
    window.addEventListener("focus", refresh)
    window.addEventListener(GIT_UPDATED_EVENT, onUpdated)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      scopeRef.current = scope + 1
      readRef.current = null
      abortRef.current?.abort()
      window.removeEventListener("focus", refresh)
      window.removeEventListener(GIT_UPDATED_EVENT, onUpdated)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [cwd, active])

  const refresh = useCallback(() => { readRef.current?.() }, [])
  // Hide previous-directory data during the render before effect cleanup runs.
  const current = state.cwd === cwd ? state : null
  const repository = current?.repository ?? null

  const perform = useCallback(async (options: GitActionOptions) => {
    if (!cwd || !active || !repository?.root || mutationRef.current) return false
    const scope = scopeRef.current
    const mutation = Symbol(options.action)
    mutationRef.current = mutation
    abortRef.current?.abort()
    setBusy(options.action)
    setState((previous) => ({ ...previous, loading: false }))
    setActionState({ cwd, error: null, message: null })
    let succeeded = false
    try {
      const result = await performGitAction({
        ...options,
        cwd,
        expectedBranch: repository.branch,
        expectedCommit: repository.commit,
      })
      succeeded = true
      if (mountedRef.current && scopeRef.current === scope) {
        setState({ cwd, repository: result.repository, loading: false, error: null })
        setActionState({ cwd, error: null, message: result.message })
      }
    } catch (error) {
      if (mountedRef.current && scopeRef.current === scope) {
        setActionState({ cwd, error: errorMessage(error), message: null })
      }
    } finally {
      if (mutationRef.current === mutation) mutationRef.current = null
      // Failed commands can still change Git state (for example a pull conflict),
      // so every outcome refreshes all views. A navigated-away write still finishes.
      dispatchGitUpdated({ cwd, root: repository.root })
      if (mountedRef.current) {
        setBusy(null)
        if (scopeRef.current !== scope) readRef.current?.()
        else onMutationRef.current?.()
      }
    }
    return succeeded
  }, [cwd, active, repository])

  return {
    repository,
    loading: active && Boolean(cwd) && (current?.loading ?? true),
    error: current?.error ?? null,
    refresh,
    busy,
    actionError: actionState.cwd === cwd ? actionState.error : null,
    actionMessage: actionState.cwd === cwd ? actionState.message : null,
    perform,
  }
}

export type GitRepositoryController = ReturnType<typeof useGitRepository>
