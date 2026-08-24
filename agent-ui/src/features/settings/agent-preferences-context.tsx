import * as React from "react"

import { getStrictContext } from "@/lib/get-strict-context"
import type { RunHarnessId } from "@/features/sidebar/header/harness-options"

import {
  readStoredAgentPreferences,
  storeAgentPreferences,
  type AgentPreferences,
  type DefaultHarnessPreference,
  type QueueBehavior,
  type SessionModelPreference,
} from "./agent-preferences"

type AgentPreferencesContextValue = AgentPreferences & {
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

  const update = React.useCallback(
    (patch: Partial<AgentPreferences>) => {
      setPreferences((current) => {
        const next = { ...current, ...patch }
        storeAgentPreferences(next)
        return next
      })
    },
    []
  )

  const value = React.useMemo<AgentPreferencesContextValue>(
    () => ({
      ...preferences,
      setDefaultHarness: (defaultHarness) => update({ defaultHarness }),
      setLastHarnessId: (lastHarnessId) => update({ lastHarnessId }),
      setSessionModel: (sessionModel) => update({ sessionModel }),
      setLastModelReference: (lastModelReference) =>
        update({ lastModelReference }),
      setQueueBehavior: (queueBehavior) => update({ queueBehavior }),
      setInputSuggestions: (inputSuggestions) => update({ inputSuggestions }),
    }),
    [preferences, update]
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
