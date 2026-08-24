import * as React from "react"

import { getStrictContext } from "@/lib/get-strict-context"
import { resolveHarnessId } from "@/features/settings/agent-preferences"
import { useAgentPreferences } from "@/features/settings/agent-preferences-context"
import {
  toRunHarnessId,
  type HarnessId,
  type RunHarnessId,
} from "./harness-options"

type HarnessContextValue = {
  harnessId: HarnessId
  runHarnessId: RunHarnessId | null
  setHarnessId: (id: HarnessId) => void
}

const [HarnessContextProvider, useHarnessContext] =
  getStrictContext<HarnessContextValue>("Harness")

export function HarnessProvider({ children }: { children: React.ReactNode }) {
  const { defaultHarness, lastHarnessId, setLastHarnessId } =
    useAgentPreferences()
  const [harnessId, setHarnessIdState] = React.useState<HarnessId>(() =>
    resolveHarnessId(defaultHarness, lastHarnessId)
  )

  const setHarnessId = React.useCallback(
    (id: HarnessId) => {
      const runId = toRunHarnessId(id)
      setHarnessIdState(id)
      if (runId) {
        setLastHarnessId(runId)
      }
    },
    [setLastHarnessId]
  )

  React.useEffect(() => {
    if (defaultHarness === "last-used") {
      return
    }

    setHarnessIdState(defaultHarness)
  }, [defaultHarness])

  const value = React.useMemo<HarnessContextValue>(
    () => ({
      harnessId,
      runHarnessId: toRunHarnessId(harnessId),
      setHarnessId,
    }),
    [harnessId, setHarnessId]
  )

  return (
    <HarnessContextProvider value={value}>{children}</HarnessContextProvider>
  )
}

export function useHarness() {
  return useHarnessContext()
}
