import * as React from "react"

import {
  checkFileExists,
  invalidateFileExists,
  peekFileExists,
} from "./file-existence"

/**
 * Whether `path` exists: `undefined` while the first check is pending, so
 * callers can render a placeholder with the final geometry instead of
 * flipping between two layouts. A `revision` change rechecks but keeps the
 * last answer until the new one arrives.
 */
export function useFileExists(path: string | undefined, revision?: string) {
  const [exists, setExists] = React.useState<boolean | undefined>(() =>
    path ? peekFileExists(path) : false
  )

  React.useEffect(() => {
    if (!path) {
      setExists(false)
      return
    }

    if (revision !== undefined) {
      invalidateFileExists(path)
    }

    const cached = peekFileExists(path)
    if (cached !== undefined && revision === undefined) {
      setExists(cached)
      return
    }

    let cancelled = false
    void checkFileExists(path).then((value) => {
      if (!cancelled) {
        setExists(value)
      }
    })

    return () => {
      cancelled = true
    }
  }, [path, revision])

  return exists
}
