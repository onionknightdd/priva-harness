import * as React from "react"

import { getStrictContext } from "@/lib/get-strict-context"
import type { RunHarnessId } from "@/features/sidebar/header/harness-options"

import {
  getAgentProfile,
  updateAgentProfileQueueBehavior,
} from "./agent-profile-api"
import {
  readStoredAgentPreferences,
  storeAgentPreferences,
  type AgentPreferences,
  type DefaultHarnessPreference,
  type QueueBehavior,
  type SessionModelPreference,
} from "./agent-preferences"

export type QueueBehaviorSyncError = "load" | "save"

type AgentPreferencesContextValue = AgentPreferences & {
  queueBehaviorBusy: boolean
  queueBehaviorError: QueueBehaviorSyncError | null
  setDefaultHarness: (value: DefaultHarnessPreference) => void
  setLastHarnessId: (value: RunHarnessId) => void
  setSessionModel: (value: SessionModelPreference) => void
  setLastModelReference: (value: string | null) => void
  setQueueBehavior: (value: QueueBehavior) => void
  setInputSuggestions: (value: boolean) => void
}

const [AgentPreferencesContextProvider, useAgentPreferencesContext] =
  getStrictContext<AgentPreferencesContextValue>("AgentPreferences")

export function AgentPreferencesProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [preferences, setPreferences] = React.useState<AgentPreferences>(
    readStoredAgentPreferences
  )
  const [queueBehaviorBusy, setQueueBehaviorBusy] = React.useState(true)
  const [queueBehaviorError, setQueueBehaviorError] =
    React.useState<QueueBehaviorSyncError | null>(null)
  const committedQueueBehaviorRef = React.useRef(preferences.queueBehavior)
  const saveGenerationRef = React.useRef(0)

  React.useEffect(() => {
    const abort = new AbortController()
    void getAgentProfile(abort.signal)
      .then((profile) => {
        committedQueueBehaviorRef.current = profile.queueBehavior
        setPreferences((current) => ({
          ...current,
          queueBehavior: profile.queueBehavior,
        }))
        setQueueBehaviorError(null)
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || isAbortError(error)) {
          return
        }
        setQueueBehaviorError("load")
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          setQueueBehaviorBusy(false)
        }
      })

    return () => abort.abort()
  }, [])

  const update = React.useCallback((patch: Partial<AgentPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch }
      storeAgentPreferences(next)
      return next
    })
  }, [])

  const setQueueBehavior = React.useCallback((queueBehavior: QueueBehavior) => {
    const generation = ++saveGenerationRef.current
    setPreferences((current) => ({ ...current, queueBehavior }))
    setQueueBehaviorBusy(true)
    setQueueBehaviorError(null)
    void updateAgentProfileQueueBehavior(queueBehavior)
      .then((saved) => {
        if (generation !== saveGenerationRef.current) {
          return
        }
        committedQueueBehaviorRef.current = saved.queueBehavior
        setPreferences((current) => ({
          ...current,
          queueBehavior: saved.queueBehavior,
        }))
      })
      .catch(() => {
        if (generation !== saveGenerationRef.current) {
          return
        }
        setPreferences((current) => ({
          ...current,
          queueBehavior: committedQueueBehaviorRef.current,
        }))
        setQueueBehaviorError("save")
      })
      .finally(() => {
        if (generation === saveGenerationRef.current) {
          setQueueBehaviorBusy(false)
        }
      })
  }, [])

  const value = React.useMemo<AgentPreferencesContextValue>(
    () => ({
      ...preferences,
      queueBehaviorBusy,
      queueBehaviorError,
      setDefaultHarness: (defaultHarness) => update({ defaultHarness }),
      setLastHarnessId: (lastHarnessId) => update({ lastHarnessId }),
      setSessionModel: (sessionModel) => update({ sessionModel }),
      setLastModelReference: (lastModelReference) =>
        update({ lastModelReference }),
      setQueueBehavior,
      setInputSuggestions: (inputSuggestions) => update({ inputSuggestions }),
    }),
    [preferences, queueBehaviorBusy, queueBehaviorError, setQueueBehavior, update]
  )

  return (
    <AgentPreferencesContextProvider value={value}>
      {children}
    </AgentPreferencesContextProvider>
  )
}

export function useAgentPreferences() {
  return useAgentPreferencesContext()
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}
