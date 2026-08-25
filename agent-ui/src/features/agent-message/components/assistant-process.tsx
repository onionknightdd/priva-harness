import * as React from "react"
import {
  BotIcon,
  BrainIcon,
  ChevronDownIcon,
  ImageIcon,
  WorkflowIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"

import type {
  AgentThreadMessage,
  NestedAgent,
  StreamBlock,
  ToolCard,
  WorkflowCard,
} from "../agent-message-data"

const PANEL_CLASS =
  "h-[var(--collapsible-panel-height)] overflow-hidden transition-[height,opacity] duration-200 ease-out data-[ending-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:h-0 data-[starting-style]:opacity-0 motion-reduce:transition-none"

export function AssistantProcess({
  message,
  isStreaming,
}: {
  message: AgentThreadMessage
  isStreaming: boolean
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const [open, setOpen] = React.useState(isStreaming)
  const blocks = [...(message.blocks ?? [])].sort(
    (left, right) => left.index - right.index
  )

  React.useEffect(() => {
    setOpen(isStreaming)
  }, [isStreaming])

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
    >
      <Collapsible
        className="group/process"
        open={isStreaming || open}
        onOpenChange={(next) => {
          if (!isStreaming) {
            setOpen(next)
          }
        }}
      >
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 justify-start px-0 text-muted-foreground has-data-[icon=inline-end]:pr-0 hover:bg-transparent hover:text-foreground"
            />
          }
        >
          {isStreaming ? (
            <span className="shimmer">{t("agentMessage.thinking")}</span>
          ) : (
            t("agentMessage.chainOfThought")
          )}
          <ChevronDownIcon
            data-icon="inline-end"
            className="opacity-0 transition-[opacity,transform] duration-200 group-hover/button:opacity-100 group-focus-visible/button:opacity-100 group-data-open/process:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className={PANEL_CLASS}>
          <ItemGroup className="gap-1 py-1">
            {blocks.map((block) => {
              if (block.type === "thinking" && block.text.trim() !== "") {
                return (
                  <ThinkingItem
                    key={block.blockId}
                    text={block.text}
                    defaultOpen={isStreaming}
                  />
                )
              }
              if (block.type === "image") {
                return (
                  <ImageItem
                    key={block.blockId}
                    block={block}
                    defaultOpen={isStreaming}
                  />
                )
              }
              if (block.type === "tool_use") {
                return <ToolItem key={block.id} block={block} />
              }
              return null
            })}
            {(message.nestedAgents ?? []).map((agent) => (
              <NestedAgentItem key={agent.parentToolUseId} agent={agent} />
            ))}
            {(message.workflows ?? []).map((workflow) => (
              <WorkflowItem
                key={workflow.workflowToolUseId}
                workflow={workflow}
              />
            ))}
          </ItemGroup>
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  )
}

function ThinkingItem({
  text,
  defaultOpen,
}: {
  text: string
  defaultOpen: boolean
}) {
  const { t } = useTranslation()
  return (
    <ProcessRow
      icon={BrainIcon}
      title={t("agentMessage.thought")}
      defaultOpen={defaultOpen}
    >
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{text}</p>
    </ProcessRow>
  )
}

function ImageItem({
  block,
  defaultOpen,
}: {
  block: Extract<StreamBlock, { type: "image" }>
  defaultOpen: boolean
}) {
  const { t } = useTranslation()
  const src =
    block.url ??
    (block.b64 === undefined
      ? undefined
      : `data:${block.mime ?? "image/png"};base64,${block.b64}`)
  if (src === undefined) {
    return null
  }

  return (
    <ProcessRow
      icon={ImageIcon}
      title={block.alt || t("agentMessage.generatedImage")}
      defaultOpen={defaultOpen}
    >
      <img
        alt={block.alt ?? ""}
        src={src}
        className="max-h-72 max-w-full rounded-lg border border-border/60"
      />
    </ProcessRow>
  )
}

function ToolItem({
  block,
}: {
  block: Extract<StreamBlock, { type: "tool_use" }>
}) {
  const { t } = useTranslation()
  const tool = block.tool
  const running = isToolRunning(tool)
  const { label, variant } = toolBadge(tool, t)
  const output = tool?.output

  return (
    <ProcessRow
      icon={WrenchIcon}
      title={block.name}
      badge={label}
      badgeVariant={variant}
      defaultOpen={running}
    >
      {output ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
          {output}
        </pre>
      ) : null}
    </ProcessRow>
  )
}

function NestedAgentItem({ agent }: { agent: NestedAgent }) {
  const { t } = useTranslation()
  const running = agent.status === "running"
  const text = agent.blocks
    .filter((block) => block.type === "text")
    .sort((left, right) => left.index - right.index)
    .map((block) => block.text)
    .join("")
  const tools = agent.blocks
    .filter(
      (block): block is Extract<StreamBlock, { type: "tool_use" }> =>
        block.type === "tool_use"
    )
    .sort((left, right) => left.index - right.index)
  const hasBody =
    text.length > 0 || agent.inbox.length > 0 || tools.length > 0

  return (
    <ProcessRow
      icon={BotIcon}
      title={t("agentMessage.nestedAgent")}
      badge={
        running
          ? t("agentMessage.runInBackground")
          : (agent.name ?? agent.agentId)
      }
      badgeVariant={running ? "secondary" : "outline"}
      defaultOpen={running}
    >
      {hasBody ? (
        <div className="flex flex-col gap-2">
          {text ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {text}
            </p>
          ) : null}
          {agent.inbox.length > 0 ? (
            <ItemGroup className="gap-1">
              {agent.inbox.map((item, index) => (
                <Item key={`${item.source}-${index}`} size="xs">
                  <ItemContent>
                    <ItemTitle>
                      {item.source === "coordinator"
                        ? t("agentMessage.coordinatorMessage")
                        : t("agentMessage.peerMessage")}
                    </ItemTitle>
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {item.body}
                    </p>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          ) : null}
          {tools.length > 0 ? (
            <ItemGroup className="gap-1">
              {tools.map((block) => (
                <ToolItem key={block.id} block={block} />
              ))}
            </ItemGroup>
          ) : null}
        </div>
      ) : null}
    </ProcessRow>
  )
}

function WorkflowItem({ workflow }: { workflow: WorkflowCard }) {
  const { t } = useTranslation()
  const running =
    workflow.status !== "completed" &&
    workflow.status !== "complete" &&
    workflow.status !== "failed" &&
    workflow.status !== "error"

  return (
    <ProcessRow
      icon={WorkflowIcon}
      title={workflow.name ?? t("agentMessage.workflow")}
      badge={workflow.summary ?? workflow.status}
      badgeVariant={running ? "secondary" : "outline"}
    />
  )
}

function ProcessRow({
  icon: Icon,
  title,
  badge,
  badgeVariant = "outline",
  defaultOpen = false,
  children,
}: {
  icon: LucideIcon
  title: React.ReactNode
  badge?: React.ReactNode
  badgeVariant?: "secondary" | "outline" | "destructive"
  defaultOpen?: boolean
  children?: React.ReactNode
}) {
  const hasBody = Boolean(children)

  const header = (
    <>
      <ItemMedia variant="icon">
        <Icon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
      </ItemContent>
      {badge || hasBody ? (
        <ItemActions>
          {badge ? <Badge variant={badgeVariant}>{badge}</Badge> : null}
          {hasBody ? (
            <ChevronDownIcon className="size-3.5 opacity-0 transition-[opacity,transform] duration-200 group-hover/item:opacity-100 group-focus-visible/item:opacity-100 group-data-open/process-item:rotate-180 motion-reduce:transition-none" />
          ) : null}
        </ItemActions>
      ) : null}
    </>
  )

  if (!hasBody) {
    return <Item size="sm">{header}</Item>
  }

  return (
    <Collapsible className="group/process-item" defaultOpen={defaultOpen}>
      <Item
        size="sm"
        className="w-full cursor-pointer text-left"
        render={<CollapsibleTrigger />}
      >
        {header}
      </Item>
      <CollapsibleContent className={PANEL_CLASS}>
        <div className="px-3 pb-2 pl-9">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function isToolRunning(tool: ToolCard | undefined): boolean {
  if (tool?.launchStatus === "async_launched") {
    return true
  }
  return tool?.status !== "completed"
}

function toolBadge(
  tool: ToolCard | undefined,
  t: (key: string) => string
): { label: string; variant: "secondary" | "outline" | "destructive" } {
  if (tool?.launchStatus === "async_launched") {
    return { label: t("agentMessage.runInBackground"), variant: "outline" }
  }
  if (tool?.status === "completed") {
    if (tool.ok === false) {
      return { label: t("agentMessage.toolFailed"), variant: "destructive" }
    }
    return { label: t("agentMessage.toolCompleted"), variant: "outline" }
  }
  return { label: t("agentMessage.toolRunning"), variant: "secondary" }
}
