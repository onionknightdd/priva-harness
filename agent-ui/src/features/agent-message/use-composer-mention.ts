import * as React from "react"

import { useActiveSession } from "@/features/chat-session"
import {
  listDirectory,
  type FileSystemEntry,
} from "@/lib/api/sandbox-files"

import {
  filterMentionEntries,
  mentionListPath,
  type MentionTrigger,
  visibleMentionEntries,
} from "./composer-mention"

export function useComposerMentionListing(trigger: MentionTrigger | null) {
  const { runCwd } = useActiveSession()
  const cwd = runCwd.trim()
  const [entries, setEntries] = React.useState<readonly FileSystemEntry[]>([])
  const [status, setStatus] = React.useState<
    "idle" | "loading" | "ready" | "error"
  >("idle")
  const [error, setError] = React.useState<string | null>(null)
  const directory = trigger?.directory ?? null

  React.useEffect(() => {
    if (directory === null) {
      setEntries([])
      setStatus("idle")
      setError(null)
      return
    }

    if (cwd === "") {
      setEntries([])
      setStatus("ready")
      setError(null)
      return
    }

    const abort = new AbortController()
    setStatus("loading")
    setEntries([])
    setError(null)

    void listDirectory(mentionListPath(cwd, directory), abort.signal)
      .then((listing) => {
        if (abort.signal.aborted) {
          return
        }
        setEntries(listing.entries)
        setStatus("ready")
      })
      .catch((caught) => {
        if (abort.signal.aborted) {
          return
        }
        setEntries([])
        setError(caught instanceof Error ? caught.message : String(caught))
        setStatus("error")
      })

    return () => abort.abort()
  }, [cwd, directory])

  const filtered = React.useMemo(
    () =>
      trigger
        ? visibleMentionEntries(filterMentionEntries(entries, trigger.filter))
        : [],
    [entries, trigger]
  )

  return { entries: filtered, status, error }
}
