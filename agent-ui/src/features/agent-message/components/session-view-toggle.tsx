import { useTranslation } from "react-i18next"
import { MessageSquareIcon, SquareTerminalIcon } from "lucide-react"

import { Tabs, TabsList, TabsTrigger } from "@/components/assistant-ui/tabs"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { harnessSupportsTerminal, type SessionView } from "../session-view"
import { useSessionView } from "../session-view-context"

/**
 * Chat / Terminal segmented control in the session header. Rendered only for
 * harnesses whose runner exposes a terminal driver; the motion indicator and
 * reduced-motion handling come from the shared Tabs component.
 */
export function SessionViewToggle() {
  const { t } = useTranslation()
  const { runHarnessId } = useHarness()
  const { view, setView } = useSessionView()
  if (!harnessSupportsTerminal(runHarnessId)) return null
  return (
    <Tabs
      value={view}
      onValueChange={(next) => {
        if (next === "chat" || next === "terminal") setView(next as SessionView)
      }}
      className="shrink-0 gap-0"
    >
      <TabsList aria-label={t("agentMessage.view.label")} variant="text" size="sm" className="h-7">
        <TabsTrigger value="chat" className="h-6 gap-1.5 px-2 text-xs">
          <MessageSquareIcon aria-hidden="true" className="size-3.5" />
          <span className="hidden sm:inline">{t("agentMessage.view.chat")}</span>
        </TabsTrigger>
        <TabsTrigger value="terminal" className="h-6 gap-1.5 px-2 text-xs">
          <SquareTerminalIcon aria-hidden="true" className="size-3.5" />
          <span className="hidden sm:inline">{t("agentMessage.view.terminal")}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
