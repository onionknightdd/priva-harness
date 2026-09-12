import * as React from "react"

import {
  browserTimeZone,
  fetchUsageOverview,
  type UsageOverview,
} from "./usage-api"

export type UsageOverviewState = {
  data: UsageOverview | null
  loading: boolean
  error: string | null
  retry: () => void
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useUsageOverview(days: number): UsageOverviewState {
  const [revision, retry] = React.useReducer((value: number) => value + 1, 0)
  const [state, setState] = React.useState<{
    key: string
    data: UsageOverview | null
    loading: boolean
    error: string | null
  } | null>(null)
  const key = `${days}:${revision}`

  React.useEffect(() => {
    const controller = new AbortController()
    fetchUsageOverview(
      { timeZone: browserTimeZone(), days },
      { signal: controller.signal }
    ).then(
      (data) => {
        if (controller.signal.aborted) return
        React.startTransition(() => setState({ key, data, loading: false, error: null }))
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState({ key, data: null, loading: false, error: errorMessage(error) })
      }
    )
    return () => controller.abort()
  }, [key, days])

  // A stale result must not flash while a retry or a range change is in flight.
  if (state?.key !== key) return { data: null, loading: true, error: null, retry }
  return { data: state.data, loading: state.loading, error: state.error, retry }
}
