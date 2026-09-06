import { useId, useRef, useState } from "react"
import { ArrowLeftIcon, ChevronDownIcon, BotIcon, LayersIcon, SquareArrowOutUpRightIcon, WorkflowIcon } from "lucide-react"
import { motion, useReducedMotionConfig } from "motion/react"
import { useTranslation } from "react-i18next"
import { AgentDisclosure } from "@/components/agents/agent-disclosure"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { EASE_OUT } from "@/lib/ease"
import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"
import { workflowDuration, workflowIsActive, workflowPhaseStatus, workflowStatusColor, type WorkflowCard } from "../workflow-data"
import { WorkflowStatusMark, WorkflowStatusPill } from "./workflow-status"

export function WorkflowOverview({ workflow, onOpenAgent }: { workflow: WorkflowCard; onOpenAgent: (index: number) => void }) {
  const { t } = useTranslation()
  const reduce = useReducedMotionConfig()
  const [open, setOpen] = useState(workflowIsActive(workflow.status))
  const [selectedPhase, setSelectedPhase] = useState<number | null>(null)
  const [showAgents, setShowAgents] = useState(false)
  const [keyboard, setKeyboard] = useState(false)
  const phaseButton = useRef<HTMLButtonElement | null>(null)
  const backButton = useRef<HTMLButtonElement | null>(null)
  const regionId = useId()
  const phases = [...workflow.phases]
  const unassigned = workflow.agents.filter((agent) => !phases.some((phase) => phase.index === agent.phaseIndex))
  if (unassigned.length) phases.push({ index: -1, title: t("agentMessage.workflowUI.unassigned") })
  const phase = phases.find((item) => item.index === selectedPhase)
    ?? phases.find((item) => workflow.agents.some((agent) => agent.phaseIndex === item.index && agent.state === "running")) ?? phases[0]
  const agentsFor = (index: number) => index === -1 ? unassigned : workflow.agents.filter((agent) => agent.phaseIndex === index)
  const completed = workflow.agents.filter((agent) => agent.state === "completed").length
  const animate = !reduce && !keyboard
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("@container my-2 min-w-0", reduce && "[&_*]:transition-none [&_*]:animate-none")}
      onPointerDownCapture={() => setKeyboard(false)} onKeyDownCapture={() => setKeyboard(true)}>
      <Card data-testid="workflow-overview" className="gap-0 rounded-xl border border-border bg-background py-0 shadow-none ring-0">
        <CollapsibleTrigger className={cn("flex w-full items-center gap-2 rounded-t-xl bg-muted/40 px-3 py-2 text-left transition-colors duration-150 hover:bg-muted/60", focusRing)}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium"><WorkflowIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{workflow.name ?? t("agentMessage.workflow")}</span></span>
              {workflow.summary ? <span className="min-w-0 flex-1 basis-40 truncate text-xs text-muted-foreground" title={workflow.summary}>{workflow.summary}</span> : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className={workflowStatusColor[workflow.status]}>{t(`agentMessage.workflowUI.status.${workflow.status}`)}</span>
              <span>{workflow.detailsUnavailable && !workflow.agents.length ? t("agentMessage.workflowUI.noMetrics") : t("agentMessage.workflowUI.stats", { phases: workflow.phases.length, agents: workflow.agents.length })}</span>
              {workflow.agents.length ? <span>{Math.round(completed / workflow.agents.length * 100)}%</span> : null}
              {workflow.durationMs !== undefined ? <span>{workflowDuration(workflow.durationMs)}</span> : null}
              {workflow.totalTokens !== undefined ? <span>{workflow.totalTokens.toLocaleString()} tokens</span> : null}
              {workflow.totalToolCalls !== undefined ? <span>{t("agentMessage.workflowUI.toolCalls", { count: workflow.totalToolCalls })}</span> : null}
            </div>
          </div>
          <ChevronDownIcon aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform duration-150 ease-out", open && "rotate-180", !animate && "transition-none")} />
        </CollapsibleTrigger>
        <AgentDisclosure open={open} className={!animate ? "transition-none" : undefined}>
          {phase ? <div className="grid min-w-0 border-t border-border @min-[640px]:grid-cols-[minmax(120px,1fr)_minmax(0,2fr)]">
            <nav aria-label={t("agentMessage.workflowUI.stages")} className={cn("max-h-72 overflow-y-auto p-1.5 @min-[640px]:border-r @min-[640px]:border-border", showAgents && "hidden @min-[640px]:block")}>
              {phases.map((item) => <Button key={item.index} ref={phase.index === item.index ? phaseButton : undefined} variant="ghost" aria-pressed={phase.index === item.index} aria-controls={regionId}
                className={cn("mb-0.5 h-auto min-h-9 w-full justify-start gap-2 whitespace-normal px-2 py-2 text-left text-xs font-normal active:scale-100", phase.index === item.index && "bg-muted/60", !animate && "transition-none")}
                onClick={() => {
                  setSelectedPhase(item.index)
                  setShowAgents(true)
                  requestAnimationFrame(() => { if (backButton.current?.getClientRects().length) backButton.current.focus({ preventScroll: true }) })
                }}>
                <LayersIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 break-words">{item.title}</span>
                <span className="text-muted-foreground tabular-nums">{agentsFor(item.index).length}</span>
                <WorkflowStatusMark status={workflowPhaseStatus(agentsFor(item.index), workflow.status)} />
              </Button>)}
            </nav>
            <div id={regionId} className={cn("min-w-0 @min-[640px]:block", !showAgents && "hidden")}>
              <div className="border-b border-border p-1 @min-[640px]:hidden"><Button ref={backButton} variant="ghost" size="sm" onClick={() => {
                setShowAgents(false)
                requestAnimationFrame(() => phaseButton.current?.focus({ preventScroll: true }))
              }}><ArrowLeftIcon />{t("agentMessage.workflowUI.backToPhases")}</Button></div>
              <motion.div key={phase.index} initial={animate ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: animate ? 0.15 : 0, ease: EASE_OUT }}
                className="max-h-72 overflow-y-auto overscroll-contain p-1.5" role="region" aria-label={phase.title}>
                {agentsFor(phase.index).map((agent) => <div key={agent.index} className="flex items-start gap-2 border-b border-border/60 px-2 py-2 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <span className="flex min-w-0 items-start gap-1.5 text-xs font-medium"><BotIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{agent.label}</span></span>
                      <WorkflowStatusPill status={agent.state} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground">
                      {agent.model ? <span>{agent.model}</span> : null}
                      {agent.durationMs !== undefined ? <span>{workflowDuration(agent.durationMs)}</span> : null}
                      {agent.tokens !== undefined ? <span>{agent.tokens.toLocaleString()} tokens</span> : null}
                      {agent.toolCalls !== undefined ? <span>{t("agentMessage.workflowUI.toolCalls", { count: agent.toolCalls })}</span> : null}
                      {agent.lastToolName && agent.lastToolName !== "StructuredOutput" ? <span>{agent.lastToolName}</span> : null}
                    </div>
                  </div>
                  <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("agentMessage.workflowUI.openAgent", { agent: agent.label })} onClick={() => onOpenAgent(agent.index)}><SquareArrowOutUpRightIcon aria-hidden="true" /></Button>} />
                    <TooltipContent>{t("agentMessage.workflowUI.openInWorkspace")}</TooltipContent>
                  </Tooltip>
                </div>)}
                {!agentsFor(phase.index).length ? <p className="p-3 text-xs text-muted-foreground">{t("agentMessage.workflowUI.noAgents")}</p> : null}
              </motion.div>
            </div>
          </div> : <p className="border-t border-border p-3 text-xs text-muted-foreground">{t(workflow.detailsUnavailable || !workflowIsActive(workflow.status) ? "agentMessage.workflowUI.unavailable" : "agentMessage.workflowUI.awaitingStages")}</p>}
        </AgentDisclosure>
      </Card>
    </Collapsible>
  )
}
