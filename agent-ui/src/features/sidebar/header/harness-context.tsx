import * as React from "react"

import { getStrictContext } from "@/lib/get-strict-context"

import {
  DEFAULT_HARNESS_ID,
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
  const [harnessId, setHarnessId] =
    React.useState<HarnessId>(DEFAULT_HARNESS_ID)

  const value = React.useMemo<HarnessContextValue>(
    () => ({
      harnessId,
      runHarnessId: toRunHarnessId(harnessId),
      setHarnessId,
    }),
    [harnessId]
  )

  return (
    <HarnessContextProvider value={value}>{children}</HarnessContextProvider>
  )
}

export function useHarness() {
  return useHarnessContext()
}
