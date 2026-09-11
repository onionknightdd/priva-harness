import { workflowDuration } from "@/features/agent-message/workflow-data"
import { useLayoutEffect, useRef, useState } from "react"
import { ArrowLeftIcon, BotIcon, ListChecksIcon, MessageSquareIcon, TextAlignStartIcon } from "lucide-react"
import { motion, useReducedMotionConfig } from "motion/react"
import { useTranslation } from "react-i18next"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/assistant-ui/tabs"
import { TabsTriggerContent } from "@/components/assistant-ui/tabs-trigger-content"
import { MessageResponse } from "@/components/ai-elements/message"
import { Button } from "@/components/ui/button"
import { WorkflowStatusPill } from "@/features/agent-message/components/workflow-status"
import { AgentToolSummary } from "@/features/agent-message/components/agent-tool-item"
import { TextItem, ThinkingItem, ToolItem, ImageItem } from "@/features/agent-message/components/assistant-process"
import { isAgentTool } from "@/features/agent-message/agent-tool-data"
import type { AgentToolView } from "@/features/agent-message/agent-tool-data"
import type { WorkspaceAgentTarget } from "../use-workspace-workflow"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

export function WorkspaceAgentView({ target }: { target: WorkspaceAgentTarget }) {
  const { t } = useTranslation()
  const reduce = useReducedMotionConfig()
  const [selectedId, setSelectedId] = useState(target.selectedId)
  const [showDetail, setShowDetail] = useState(true)
  const [keyboard, setKeyboard] = useState(false)
  const selectedButton = useRef<HTMLButtonElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const agent = target.agents.find((item) => item.id === selectedId) ?? target.agents[0]
  const select = (id: string) => {
    setSelectedId(id)
    setShowDetail(true)
    requestAnimationFrame(() => { if (backButton.current?.getClientRects().length) backButton.current.focus({ preventScroll: true }) })
  }
  if (!agent) return <p className="p-3 text-xs text-muted-foreground">{t("agentMessage.workflowUI.unavailable")}</p>
  return (
    <div className="@container min-w-0 p-1" onKeyDownCapture={() => setKeyboard(true)} onPointerDownCapture={() => setKeyboard(false)}>
      <div className="grid overflow-hidden rounded-lg border border-border @min-[640px]:grid-cols-[minmax(160px,1fr)_minmax(0,2fr)]">
        <nav aria-label={t("agentMessage.agentUI.agents")} className={cn("max-h-96 overflow-y-auto p-1 @min-[640px]:border-r", showDetail && "hidden @min-[640px]:block")}>
          {target.agents.map((item) => <Button key={item.id} ref={item.id === agent.id ? selectedButton : undefined} variant="ghost"
            aria-pressed={item.id === agent.id} onClick={() => select(item.id)}
            className={cn("h-auto w-full justify-start gap-1.5 whitespace-normal px-2 py-2 text-left text-xs", item.id === agent.id && "bg-muted/60")}>
            <BotIcon className="size-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 break-words">{item.label}</span><WorkflowStatusPill status={item.state} />
          </Button>)}
        </nav>
        <div className={cn("min-w-0 @min-[640px]:block", !showDetail && "hidden")}>
          <div className="border-b p-1 @min-[640px]:hidden"><Button ref={backButton} variant="ghost" size="sm" onClick={() => {
            setShowDetail(false)
            requestAnimationFrame(() => selectedButton.current?.focus({ preventScroll: true }))
          }}><ArrowLeftIcon />{t("agentMessage.agentUI.agents")}</Button></div>
          <motion.div key={agent.id} initial={reduce || keyboard ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, ease: EASE_OUT }}>
            <AgentDetail agent={agent} onSelectAgent={select} agents={target.agents}
              initialTab={target.tab} notificationId={agent.id === target.selectedId ? target.notificationId : undefined} />
          </motion.div>
        </div>
      </div>
    </div>
  )
}

function AgentDetail({ agent, agents, onSelectAgent, initialTab, notificationId }: { agent: AgentToolView; agents: AgentToolView[]; onSelectAgent: (id: string) => void; initialTab?: string; notificationId?: string }) {
  const { t } = useTranslation()
  const reduce = useReducedMotionConfig()
  const [tab, setTab] = useState(initialTab ?? "process")
  const viewport = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useLayoutEffect(() => {
    if (tab === "process" && follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }, [agent.blocks, agent.inbox, tab])
  const notification = agent.notifications.find((item) => item.id === notificationId)
  const output = notification ? notification.task.result : agent.output ?? (!agent.backgroundTask && agent.state === "completed" ? agent.blocks.filter((block) => block.type === "text").at(-1)?.text : undefined)
  const blocks = agent.blocks.filter((block) => block.type !== "tool_use" || block.name.toLowerCase() !== "structuredoutput")
  const timeline = agent.blocks.flatMap((block, index) => [
    ...agent.inbox.filter((item) => item.afterBlockCount === index).map((item, messageIndex) => ({ key: `message-${index}-${messageIndex}`, item, block: undefined })),
    { key: block.blockId, block, item: undefined },
  ])
  const trailing = agent.inbox.filter((item) => item.afterBlockCount === undefined || item.afterBlockCount >= agent.blocks.length)
  return (
    <section aria-label={agent.label} className="min-w-0">
      <header className="bg-muted/40 px-3 py-2">
        <div className="flex items-start gap-2"><h3 className="flex min-w-0 items-start gap-1.5 text-sm font-medium"><BotIcon className="mt-0.5 size-4 shrink-0" /><span className="break-words">{agent.label}</span></h3><WorkflowStatusPill status={agent.state} /></div>
        <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">{agent.type ? <span>{agent.type}</span> : null}{agent.model ? <span>{agent.model}</span> : null}<span>{t("agentMessage.workflowUI.toolCalls", { count: agent.toolCount })}</span>{agent.tokens !== undefined ? <span>{agent.tokens.toLocaleString()} tokens</span> : null}{agent.durationMs !== undefined ? <span>{workflowDuration(agent.durationMs)}</span> : null}</div>
      </header>
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="gap-0 border-t">
        <TabsList variant="default" size="sm" className="mx-2 mt-2 max-w-[calc(100%-1rem)] overflow-hidden" aria-label={t("agentMessage.workflowUI.agentDetails")}>
          {[
            { value: "prompt", icon: MessageSquareIcon, label: t("agentMessage.workflowUI.prompt") },
            { value: "process", icon: ListChecksIcon, label: t("agentMessage.workflowUI.process") },
            { value: "result", icon: TextAlignStartIcon, label: t("agentMessage.workflowUI.output") },
          ].map(({ value, icon, label }) => (
            <TabsTrigger key={value} value={value} aria-label={label}
              className="group-data-[size=sm]/tabs-list:px-1 @min-[360px]:group-data-[size=sm]/tabs-list:px-2 [&_svg:not([class*='size-'])]:size-3.5 dark:data-active:text-white">
              <TabsTriggerContent active={tab === value} icon={icon} label={label} reduceMotion={Boolean(reduce)} />
            </TabsTrigger>
          ))}
        </TabsList>
        {["prompt", "process", "result"].map((value) => <TabsContent value={value} key={value}>
          <div ref={tab === value ? viewport : undefined} tabIndex={0} aria-label={t(`agentMessage.workflowUI.${value === "result" ? "output" : value}`)}
            className="h-72 overflow-y-auto overscroll-contain px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
            onScroll={(event) => { if (value === "process") { const area = event.currentTarget; follow.current = area.scrollHeight - area.scrollTop - area.clientHeight < 24 } }}>
            {value === "process" ? <div className="space-y-2">
              {timeline.map(({ key, block, item }) => {
                if (item) return <Delivery key={key} body={item.body} sender={item.senderName} />
                if (!block || !blocks.includes(block)) return null
                if (block.type === "text") return <TextItem key={key} text={block.text} />
                if (block.type === "thinking") return <ThinkingItem key={key} text={block.text} durationMs={block.durationMs} startedAt={block.startedAt} running={agent.state === "running" && block.durationMs === undefined && agent.blocks.at(-1)?.blockId === block.blockId} defaultOpen={true} />
                if (block.type === "image") return <ImageItem key={key} block={block} defaultOpen={true} />
                if (block.type === "tool_use") {
                  const child = isAgentTool(block.name) ? agents.find((item) => item.id === block.id) : undefined
                  return child ? <AgentToolSummary key={key} agent={child} onOpen={() => onSelectAgent(child.id)} /> : <ToolItem key={key} block={block} />
                }
                return null
              })}
              {trailing.map((item, index) => <Delivery key={`trailing-${index}`} body={item.body} sender={item.senderName} />)}
              {!timeline.length && !trailing.length ? <p className="text-xs text-muted-foreground">{t("agentMessage.workflowUI.noContent")}</p> : null}
            </div> : <MessageResponse mode="static" className="text-sm">{(value === "prompt" ? agent.prompt : output) ?? t("agentMessage.workflowUI.noContent")}</MessageResponse>}
          </div>
        </TabsContent>)}
      </Tabs>
    </section>
  )
}

function Delivery({ body, sender }: { body: string; sender?: string }) {
  const { t } = useTranslation()
  return <div className="rounded-md border bg-muted/20 p-2"><div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><MessageSquareIcon className="size-3" />{sender ?? t("agentMessage.peerMessage")}</div><MessageResponse mode="static" className="text-xs">{body}</MessageResponse></div>
}
