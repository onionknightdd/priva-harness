import { workflowDuration } from "../workflow-data"
import { BotIcon, SquareArrowOutUpRightIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Card } from "@/components/ui/card"
import { WorkflowStatusPill } from "./workflow-status"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useChatSession } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { useWorkspaceWorkflow } from "@/features/workspace/use-workspace-workflow"
import type { AgentToolView } from "../agent-tool-data"

export function AgentToolItem({ agent, agents }: { agent: AgentToolView; agents: AgentToolView[] }) {
  const { activeSession, runSessionId } = useChatSession()
  const { runHarnessId } = useHarness()
  const { openAgent } = useWorkspaceWorkflow()
  return <AgentToolSummary agent={agent} onOpen={() => openAgent(`${runHarnessId}:${activeSession?.sessionId ?? runSessionId}`, agents, agent.id)} />
}

export function AgentToolSummary({ agent, onOpen }: { agent: AgentToolView; onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <Card className="flex min-w-0 flex-row items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 shadow-none ring-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-ui leading-5 text-muted-foreground">
            <BotIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="min-w-0 break-words">{agent.label}</span>
          </span>
          <WorkflowStatusPill status={agent.state} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 pl-5 text-xs text-muted-foreground">
          {agent.type ? <span>{agent.type}</span> : null}
          {agent.tokens !== undefined ? <span>{agent.tokens.toLocaleString()} tokens</span> : null}
          {agent.durationMs !== undefined ? <span>{workflowDuration(agent.durationMs)}</span> : null}
          {agent.model ? <span>{agent.model}</span> : null}
          <span>{t("agentMessage.workflowUI.toolCalls", { count: agent.toolCount })}</span>
        </div>
      </div>
      <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm"
        aria-label={t("agentMessage.workflowUI.openAgent", { agent: agent.label })}
        onClick={onOpen}>
        <SquareArrowOutUpRightIcon aria-hidden="true" />
      </Button>} /><TooltipContent>{t("agentMessage.workflowUI.openInWorkspace")}</TooltipContent></Tooltip>
    </Card>
  )
}
