import * as React from "react"

import {
  listSlashCommands,
  type SlashCommand,
} from "@/lib/api/slash-commands"
import { useChatSession } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"

export function useSlashCommandCatalog() {
  const { runHarnessId } = useHarness()
  const { runCwd } = useChatSession()
  const [commands, setCommands] = React.useState<readonly SlashCommand[]>([])

  React.useEffect(() => {
    if (!runHarnessId || runCwd.trim() === "") {
      setCommands([])
      return
    }

    const abort = new AbortController()
    void listSlashCommands(runHarnessId, runCwd, abort.signal)
      .then((next) => {
        if (!abort.signal.aborted) {
          setCommands(next)
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setCommands([])
        }
      })

    return () => abort.abort()
  }, [runCwd, runHarnessId])

  return commands
}
