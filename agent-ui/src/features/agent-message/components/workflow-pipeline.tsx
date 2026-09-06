import { workflowStatusColor } from "../workflow-data"
import { useEffect, useId, useRef, useState } from "react"
import { ArrowLeftIcon, BotIcon, ChevronDownIcon, Clock3Icon, LayersIcon, TerminalIcon, WorkflowIcon } from "lucide-react"
import { motion, useReducedMotionConfig } from "motion/react"
import { useTranslation } from "react-i18next"
import { AgentDisclosure } from "@/components/agents/agent-disclosure"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible"
import { EASE_OUT } from "@/lib/ease"
import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"
import { workflowDuration, workflowIsActive, workflowPhaseStatus, type WorkflowAgent, type WorkflowCard, type WorkflowPhase } from "../workflow-data"
import { WorkflowAgentDetailPanel, type LoadWorkflowAgent } from "./workflow-agent-detail"
import { WorkflowStatusMark } from "./workflow-status"

export function WorkflowPipeline({ workflow, loadDetail, initialAgentIndex }: { workflow: WorkflowCard; loadDetail: LoadWorkflowAgent; initialAgentIndex?: number }) {
  const { t } = useTranslation()
  const reduce = useReducedMotionConfig()
  const active = workflowIsActive(workflow.status)
  const [open, setOpen] = useState(initialAgentIndex !== undefined || active)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(initialAgentIndex ?? null)
  const [mobileDetail, setMobileDetail] = useState(initialAgentIndex !== undefined)
  const [collapsedPhases, setCollapsedPhases] = useState<Set<number>>(() => new Set())
  const backButton = useRef<HTMLButtonElement | null>(null)
  const [keyboard, setKeyboard] = useState(false)
  const wasActive = useRef(active)
  const selectedButton = useRef<HTMLButtonElement | null>(null)
  const detailId = useId()
  const boardId = useId()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active || !open) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active, open])
  const [everMounted, setEverMounted] = useState(false)
  useEffect(() => { setEverMounted(true) }, [])
  useEffect(() => {
    if (wasActive.current && !active) {
      // Keep an inspector the user is reading open when background work finishes.
      if (selectedIndex === null) setOpen(false)
    }
    wasActive.current = active
  }, [active, selectedIndex])

  useEffect(() => {
    if (mobileDetail && backButton.current?.getClientRects().length) backButton.current.focus({ preventScroll: true })
  }, [mobileDetail])

  const selected = workflow.agents.find((agent) => agent.index === selectedIndex)
    ?? workflow.agents.find((agent) => agent.state === "running")
    ?? workflow.agents[0]
  const completed = workflow.agents.filter((agent) => agent.state === "completed").length
  const running = workflow.agents.filter((agent) => agent.state === "running").length
  const total = workflow.agents.length
  const percentage = total ? Math.round(completed / total * 100) : 0
  const phases: WorkflowPhase[] = [...workflow.phases]
  const unassigned = workflow.agents.filter((agent) => !phases.some((phase) => phase.index === agent.phaseIndex))
  if (unassigned.length) phases.push({ index: 0, title: t("agentMessage.workflowUI.unassigned") })
  const animate = everMounted && !reduce && !keyboard
  const transition = { duration: animate ? 0.18 : 0, ease: EASE_OUT }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("@container my-2 w-full min-w-0", reduce && "[&_*]:transition-none [&_*]:animate-none [&_*]:scale-100")}
      onPointerDownCapture={() => setKeyboard(false)} onKeyDownCapture={() => setKeyboard(true)}>
      <Card data-testid="workflow-pipeline" className="gap-0 rounded-xl border border-border bg-background py-0 text-foreground shadow-none ring-0">
        <CollapsibleTrigger aria-controls={boardId} className={cn("flex w-full items-center gap-2 rounded-t-xl bg-muted/40 px-3 py-2 text-left transition-colors duration-150 hover:bg-muted/60 motion-reduce:transition-none", (reduce || keyboard) && "transition-none", focusRing)}>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium"><WorkflowIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{workflow.name ?? t("agentMessage.workflow")}</span></span>
              {workflow.summary ? <span className="min-w-0 flex-1 basis-40 truncate text-xs text-muted-foreground" title={workflow.summary}>{workflow.summary}</span> : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className={workflowStatusColor[workflow.status]}>{t(`agentMessage.workflowUI.status.${workflow.status}`)}</span>
              <span>{workflow.detailsUnavailable && !total ? t("agentMessage.workflowUI.noMetrics") : t("agentMessage.workflowUI.stats", { phases: workflow.phases.length, agents: total })}{total ? ` · ${percentage}%` : ""}</span>
              {workflow.durationMs !== undefined ? <span>{workflowDuration(workflow.durationMs)}</span> : null}
              {workflow.totalTokens !== undefined ? <span>{workflow.totalTokens.toLocaleString()} tokens</span> : null}
              {workflow.totalToolCalls !== undefined ? <span>{t("agentMessage.workflowUI.toolCalls", { count: workflow.totalToolCalls })}</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2.5 text-xs text-muted-foreground tabular-nums">
            {open && total > 0 ? <>
              <span className="hidden items-center gap-1 @min-[480px]:inline-flex"><WorkflowStatusMark status="completed" />{completed}</span>
              {running ? <span className="hidden items-center gap-1 @min-[480px]:inline-flex"><WorkflowStatusMark status="running" />{running}</span> : null}
            </> : <WorkflowStatusMark status={workflow.status} />}
            {total ? <span className="hidden @min-[480px]:inline">{completed}/{total}</span> : null}
            <ChevronDownIcon aria-hidden="true" className={cn("size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none", open && "rotate-180", (reduce || keyboard) && "transition-none")} />
          </div>
        </CollapsibleTrigger>
        <AgentDisclosure open={open} className={reduce || keyboard ? "transition-none" : undefined}>
          <div id={boardId}>
            {phases.length ? (
              <div className="grid min-w-0 border-t border-border @min-[640px]:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
                <div role="region" aria-label={t("agentMessage.workflowUI.stages")}
                  className={cn("min-w-0 max-h-96 overflow-y-auto overscroll-contain @min-[640px]:border-r @min-[640px]:border-border", mobileDetail && "hidden @min-[640px]:block")}>
                  {phases.map((phase) => {
                    const agents = phase.index === 0 ? unassigned : workflow.agents.filter((agent) => agent.phaseIndex === phase.index)
                    const status = workflowPhaseStatus(agents, workflow.status)
                    const expanded = !collapsedPhases.has(phase.index)
                    const phaseId = `${boardId}-phase-${phase.index}`
                    return (
                      <Collapsible key={phase.index} open={expanded} onOpenChange={(value) => setCollapsedPhases((previous) => {
                        const next = new Set(previous)
                        if (value) next.delete(phase.index)
                        else next.add(phase.index)
                        return next
                      })} className="border-b border-border last:border-b-0">
                        <CollapsibleTrigger aria-controls={phaseId} className={cn("flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-muted/40", focusRing, (reduce || keyboard) && "transition-none")}>
                          <LayersIcon aria-hidden="true" className={cn("size-3.5 shrink-0", workflowStatusColor[status])} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{phase.title}</span>
                            {phase.detail ? <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{phase.detail}</span> : null}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">{agents.length}</span>
                          <WorkflowStatusMark status={status} />
                          <ChevronDownIcon aria-hidden="true" className={cn("size-3 transition-transform duration-150 ease-out", !expanded && "-rotate-90", (reduce || keyboard) && "transition-none")} />
                        </CollapsibleTrigger>
                        <AgentDisclosure id={phaseId} open={expanded} className={reduce || keyboard ? "transition-none" : undefined}>
                          <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
                            {agents.map((agent) => (
                              <motion.div key={agent.index} initial={animate && active ? { opacity: 0, transform: "translateY(4px)" } : false}
                                animate={{ opacity: 1, transform: "translateY(0)" }} transition={transition}>
                                <Button ref={selected?.index === agent.index ? selectedButton : undefined} variant="ghost" aria-pressed={selected?.index === agent.index} aria-controls={detailId}
                                  onClick={(event) => {
                                    selectedButton.current = event.currentTarget
                                    setSelectedIndex(agent.index)
                                    setMobileDetail(true)
                                  }}
                                  className={cn("h-auto w-full items-start justify-start gap-2 rounded-md border px-2 py-1.5 text-left whitespace-normal font-normal active:scale-100 transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
                                    (keyboard || reduce) && "transition-none",
                                    selected?.index === agent.index ? "border-border bg-muted/50 shadow-xs hover:bg-muted/50" : "border-transparent",
                                    agent.state === "pending" && "text-muted-foreground/60")}>
                                  <AgentStepContent agent={agent} now={now} />
                                </Button>
                              </motion.div>
                            ))}
                            {!agents.length ? <p className="px-2 py-2 text-xs text-muted-foreground/70">{t(active ? "agentMessage.workflowUI.waiting" : "agentMessage.workflowUI.noAgents")}</p> : null}
                          </div>
                        </AgentDisclosure>
                      </Collapsible>
                    )
                  })}
                </div>
                <div id={detailId} className={cn("min-w-0 @min-[640px]:block", !mobileDetail && "hidden")}>
                  <div className="border-b border-border px-2 py-1.5 @min-[640px]:hidden">
                    <Button ref={backButton} variant="ghost" size="sm" onClick={() => {
                      setMobileDetail(false)
                      setCollapsedPhases((previous) => {
                        const next = new Set(previous)
                        next.delete(selected?.phaseIndex ?? 0)
                        return next
                      })
                      requestAnimationFrame(() => selectedButton.current?.focus({ preventScroll: true }))
                    }}><ArrowLeftIcon />{t("agentMessage.workflowUI.backToAgents")}</Button>
                  </div>
                  {selected ? <motion.div key={selected.index} initial={animate ? { opacity: 0, transform: "translateY(3px)" } : false}
                    animate={{ opacity: 1, transform: "translateY(0)" }} transition={transition}>
                    <WorkflowAgentDetailPanel agent={selected} now={now} loadDetail={loadDetail} enabled={open} />
                  </motion.div> : <div className="flex min-h-32 items-center justify-center px-4 text-xs text-muted-foreground" role="status">{t("agentMessage.workflowUI.waiting")}</div>}
                </div>
              </div>
            ) : <div className="border-t border-border px-3 py-3 text-xs text-muted-foreground" role="status">{t(workflow.detailsUnavailable || !active ? "agentMessage.workflowUI.unavailable" : "agentMessage.workflowUI.awaitingStages")}</div>}

          </div>
        </AgentDisclosure>
      </Card>
    </Collapsible>
  )
}

function AgentStepContent({ agent, now }: { agent: WorkflowAgent; now: number }) {
  const toolName = agent.lastToolName === "StructuredOutput" ? undefined : agent.lastToolName
  const duration = workflowDuration(agent.durationMs ?? (agent.state === "running" && agent.startedAt ? Math.max(0, now - agent.startedAt) : undefined))
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex items-start gap-1.5">
        <BotIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 break-words text-xs font-medium leading-snug">{agent.label}</span>
        <WorkflowStatusMark status={agent.state} />
      </span>
      <span className="line-clamp-1 break-words text-xs leading-snug text-muted-foreground">{agent.lastToolSummary ?? agent.promptPreview}</span>
      <span className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
        {toolName || agent.model ? <Badge variant="secondary" className="min-w-0 gap-1 rounded-md px-1.5 font-mono text-[0.65rem] font-normal">
          {toolName ? <TerminalIcon aria-hidden="true" className="size-3" /> : <BotIcon aria-hidden="true" className="size-3" />}
          <span className="truncate">{toolName ?? agent.model}</span>
        </Badge> : null}
        {duration ? <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-[0.65rem] tabular-nums"><Clock3Icon aria-hidden="true" className="size-3" />{duration}</span> : null}
      </span>
    </span>
  )
}
