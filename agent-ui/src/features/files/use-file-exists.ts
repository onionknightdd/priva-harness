import * as React from "react"

import {
  checkFileExists,
  invalidateFileExists,
  peekFileExists,
} from "./file-existence"

export function useFileExists(path: string | undefined, revision?: string) {
  const [exists, setExists] = React.useState<boolean>(() => {
    if (!path) {
      return false
    }
    return peekFileExists(path) === true
  })

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
