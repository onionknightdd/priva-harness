import { useTranslation } from "react-i18next"
import { MessagesSquareIcon, SquareTerminalIcon } from "lucide-react"

import { Tabs, TabsList, TabsTrigger } from "@/components/assistant-ui/tabs"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { cn } from "@/lib/utils"
import { harnessSupportsTerminal, type SessionView } from "../session-view"
import { useSessionView } from "../session-view-context"

/**
 * Chat / Terminal segmented control in the session header. Rendered only for
 * harnesses whose runner exposes a terminal driver; the motion indicator and
 * reduced-motion handling come from the shared Tabs component.
 */
export function SessionViewToggle({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { runHarnessId } = useHarness()
  const { view, canOpenTerminal, setView } = useSessionView()
  if (!harnessSupportsTerminal(runHarnessId)) return null
  return (
    <Tabs
      value={view}
      onValueChange={(next) => {
        if (next === "chat" || next === "terminal") setView(next as SessionView)
      }}
      className={cn("shrink-0 gap-0", className)}
    >
      <TabsList
        aria-label={t("agentMessage.view.label")}
        variant="default"
        size="sm"
        className="h-[26px] gap-0.5 rounded-[8px] p-[3px] [&_[data-slot=tabs-active-indicator]]:inset-y-[3px] [&_[data-slot=tabs-active-indicator]]:rounded-[6px]"
      >
        <TabsTrigger
          value="chat"
          aria-label={t("agentMessage.view.chat")}
          className="h-full! rounded-[6px]! px-1! py-0! dark:data-active:text-white"
        >
          <MessagesSquareIcon aria-hidden="true" />
        </TabsTrigger>
        <TabsTrigger
          value="terminal"
          disabled={!canOpenTerminal}
          aria-label={t("agentMessage.view.terminal")}
          className="h-full! rounded-[6px]! px-1! py-0! dark:data-active:text-white data-disabled:pointer-events-none data-disabled:opacity-50"
        >
          <SquareTerminalIcon aria-hidden="true" />
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
