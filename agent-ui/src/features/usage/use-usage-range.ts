import * as React from "react"

import {
  browserTimeZone,
  fetchUsageRange,
  type LocalDateRange,
  type UsageRangeSummary,
} from "./usage-api"

export type UsageRangeState = {
  // The last summary that arrived, kept on screen while the next range loads
  // so switching presets re-flows numbers instead of flashing a skeleton.
  data: UsageRangeSummary | null
  loading: boolean
  error: string | null
  retry: () => void
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useUsageRange(range: LocalDateRange): UsageRangeState {
  const [revision, retry] = React.useReducer((value: number) => value + 1, 0)
  const key = `${range.from}:${range.to}:${revision}`
  const [state, setState] = React.useState<{
    key: string
    data: UsageRangeSummary | null
    error: string | null
  }>({ key: "", data: null, error: null })

  React.useEffect(() => {
    const controller = new AbortController()
    fetchUsageRange(
      { timeZone: browserTimeZone(), from: range.from, to: range.to },
      { signal: controller.signal }
    ).then(
      (data) => {
        if (controller.signal.aborted) return
        React.startTransition(() => setState({ key, data, error: null }))
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState((current) => ({ key, data: current.data, error: errorMessage(error) }))
      }
    )
    return () => controller.abort()
  }, [key, range.from, range.to])

  const settled = state.key === key
  return {
    data: state.data,
    loading: !settled,
    error: settled ? state.error : null,
    retry,
  }
}
