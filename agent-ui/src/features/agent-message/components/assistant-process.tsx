import { isQuestionTool } from "../interaction-data"
import { QuestionSummary } from "./interaction-card"
import { BackgroundTaskCard } from "./background-task-card"
import { agentToolsForMessage, isAgentTool } from "../agent-tool-data"
import { AgentToolItem } from "./agent-tool-item"
import { isWorkflowTool } from "../workflow-data"
import { WorkflowToolItem } from "./workflow-tool-item"
import * as React from "react"
import {
  ChevronDownIcon,
  FilePenLineIcon,
  FilePlusCornerIcon,
  ImageIcon,
  ImagesIcon,
  ScrollTextIcon,
  WrenchIcon,
} from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { AgentDisclosure } from "@/components/agents/agent-disclosure"
import { FileDiff } from "@/components/agents/file-diff"
import { FileRead } from "@/components/agents/file-read"
import {
  ToolResult,
  ToolResultOutput,
  type ToolResultStatus,
} from "@/components/agents/tool-result"
import { MessageResponse } from "@/components/ai-elements/message"
import { Badge } from "@/components/ui/badge"
import { writeClipboardText } from "@/lib/clipboard"
import { FilePathLink } from "@/features/files/file-path-link"
import { useChatSession } from "@/features/chat-session"
import { fileNameFromPath, resolveAgainstCwd } from "@/lib/file-path"
import {
  Collapsible,
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
import { languageFromPath } from "@/lib/language-from-path"
import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"

import {
  isProcessBlock,
  type AgentThreadMessage,
  type StreamBlock,
  type ToolCard,
} from "../agent-message-data"
import {
  fileDiffCopyText,
  fileDiffLinesFromContent,
  fileDiffLinesFromEdit,
  fileDiffLinesFromUnified,
} from "../file-diff-lines"
import { parseFileReadOutput, isImageFilePath } from "../file-read-view"
import { formatProcessStatusText } from "../process-status"
import {
  isStructuredOutputTool,
  isBashTool,
  isEditTool,
  isReadTool,
  isToolRunning,
  isWriteTool,
  toolItemStatusLabel,
} from "../tool-activity"
import { QuoteSelectable } from "./quote-selectable"
import { CanvasToolItem } from "./canvas-tool-item"
import { VisualizeToolItem } from "./visualize-tool-item"
import { isCanvasTool } from "../canvas-html"
import { isVisualizeTool } from "../visualize-jsx"
import { isImageEditTool, isImageGenTool, isImageReadTool } from "../image-tools"
import { ImageGenToolItem, ImageReadToolItem } from "./image-tool-item"

const TEXT_LINE_GAP_CLASS = "[line-height:1.5em]"

export function AssistantProcess({
  message,
  isStreaming,
  hideHeader = false,
}: {
  message: AgentThreadMessage
  isStreaming: boolean
  hideHeader?: boolean
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const hasBackgroundTasks = message.blocks?.some((block) => block.type === "tool_use" && block.tool?.backgroundTask &&
    ["pending", "running", "paused"].includes(block.tool.backgroundTask.status)) ?? false
  const [open, setOpen] = React.useState(isStreaming || hasBackgroundTasks)
  const blocks = [...(message.blocks ?? [])].sort(
    (left, right) => left.index - right.index
  )

  React.useEffect(() => {
    setOpen(isStreaming || hasBackgroundTasks)
  }, [isStreaming, hasBackgroundTasks])

  const rows: React.ReactNode[] = []
  const renderedWorkflows = new Set<string>()
  const agentTools = agentToolsForMessage(message)
  const renderedAgents = new Set<string>()
  for (const block of blocks) {
    if (!isProcessBlock(block, blocks)) {
      continue
    }
    if (block.type === "thinking") {
      rows.push(
        <ThinkingItem
          key={block.blockId}
          text={block.text}
          startedAt={block.startedAt}
          durationMs={block.durationMs}
          running={isStreaming && block.durationMs === undefined}
          defaultOpen={isStreaming}
        />
      )
      continue
    }
    if (block.type === "text") {
      rows.push(<TextItem key={block.blockId} text={block.text} />)
      continue
    }
    if (block.type === "image") {
      rows.push(
        <ImageItem
          key={block.blockId}
          block={block}
          defaultOpen={isStreaming}
        />
      )
      continue
    }
    if (block.type === "tool_use") {
      if (isQuestionTool(block.name)) {
        const resolution = message.interactions?.find((item) => item.request.toolUseId === block.id)
        if (resolution || block.tool?.status === "completed") rows.push(<QuestionSummary key={block.id} resolution={resolution} output={block.tool?.output} skipped={block.tool?.ok === false} />)
        continue
      }
      if (isStructuredOutputTool(block.name)) continue
      if (isAgentTool(block.name)) {
        const agent = agentTools.find((item) => item.id === block.id)
        if (agent) rows.push(<AgentToolItem key={block.id} agent={agent} agents={agentTools} />)
        renderedAgents.add(block.id)
      } else if (isWorkflowTool(block.name)) {
        const workflow = message.workflows?.find((item) => item.workflowToolUseId === block.id) ?? {
          workflowToolUseId: block.id,
          status: block.tool?.ok === false ? "failed" as const : isStreaming ? "running" as const : "unknown" as const,
          phases: [], agents: [],
        }
        rows.push(<WorkflowToolItem key={block.id} workflow={workflow} />)
        renderedWorkflows.add(workflow.workflowToolUseId)
      } else {
        rows.push(<ToolItem key={block.id} block={block} />)
      }
      if (block.tool?.backgroundTask && !isAgentTool(block.name)) rows.push(<BackgroundTaskCard key={`${block.id}:background`} task={block.tool.backgroundTask} />)
    }
  }
  for (const resolution of message.interactions ?? []) {
    if (!blocks.some((block) => block.type === "tool_use" && block.id === resolution.request.toolUseId)) rows.push(<QuestionSummary key={resolution.request.requestId} resolution={resolution} />)
  }
  for (const agent of agentTools) {
    if (!renderedAgents.has(agent.id)) rows.push(<AgentToolItem key={agent.id} agent={agent} agents={agentTools} />)
  }
  for (const workflow of message.workflows ?? []) {
    if (!renderedWorkflows.has(workflow.workflowToolUseId)) {
      rows.push(<WorkflowToolItem key={workflow.workflowToolUseId} workflow={workflow} />)
    }
  }

  if (hideHeader) {
    if (rows.length === 0) {
      return null
    }

    return (
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
      >
        <ProcessItemGroup>{rows}</ProcessItemGroup>
      </motion.div>
    )
  }

  const statusText = formatProcessStatusText(message, isStreaming, t)

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
          className={cn(
            "group/process-trigger flex max-w-full min-w-0 items-center gap-1 rounded-md bg-transparent px-0 py-0.5 text-left text-ui leading-snug font-medium text-muted-foreground/70 hover:text-muted-foreground/70",
            focusRing
          )}
        >
          <span
            className={cn(
              "min-w-0 whitespace-normal",
              isStreaming && "shimmer"
            )}
          >
            {statusText}
          </span>
          <ChevronDownIcon
            className="size-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-200 group-hover/process-trigger:opacity-100 group-focus-visible/process-trigger:opacity-100 group-data-open/process:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <AgentDisclosure open={isStreaming || open} unmountOnClose overflowWhenOpen>
          {rows.length > 0 ? <ProcessItemGroup>{rows}</ProcessItemGroup> : null}
        </AgentDisclosure>
      </Collapsible>
    </motion.div>
  )
}

export function TextItem({ text }: { text: string }) {
  return (
    <div className="w-full min-w-0 px-0 py-0.5 text-sm text-foreground">
      <QuoteSelectable>
        <MessageResponse
          className={cn(
            "text-foreground [&_p]:my-0",
            "[&_p]:[line-height:1.5em] [&_p+p]:mt-[2px]"
          )}
          mode="static"
        >
          {text}
        </MessageResponse>
      </QuoteSelectable>
    </div>
  )
}

export function ThinkingItem({
  text,
  startedAt,
  durationMs,
  running,
  defaultOpen,
}: {
  text: string
  startedAt?: number
  durationMs?: number
  running: boolean
  defaultOpen: boolean
}) {
  const { t } = useTranslation()
  const liveMs = useLiveElapsedMs(startedAt, running)
  const elapsedMs =
    durationMs !== undefined && durationMs > 0 ? durationMs : liveMs
  const elapsed =
    elapsedMs === undefined ? undefined : formatElapsedMs(elapsedMs)
  return (
    <ProcessRow
      title={
        <>
          {running ? (
            <span className="shimmer">{t("agentMessage.thoughtRunning")}</span>
          ) : (
            t("agentMessage.thoughtDone")
          )}
          {elapsed ? (
            <span className="font-normal tabular-nums">
              {elapsed}
            </span>
          ) : null}
        </>
      }
      defaultOpen={defaultOpen}
    >
      <p className={cn("whitespace-pre-wrap text-sm", TEXT_LINE_GAP_CLASS)}>
        {text}
      </p>
    </ProcessRow>
  )
}

export function ImageItem({
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
      icon={<ImageIcon />}
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

export function ToolItem({
  block,
}: {
  block: Extract<StreamBlock, { type: "tool_use" }>
}) {
  if (isBashTool(block.name)) {
    return <BashToolItem block={block} />
  }
  if (isWriteTool(block.name)) {
    return <WriteToolItem block={block} />
  }
  if (isEditTool(block.name)) {
    return <EditToolItem block={block} />
  }
  if (isReadTool(block.name)) {
    return <ReadToolItem block={block} />
  }
  if (isVisualizeTool(block.name)) {
    return <VisualizeToolItem block={block} />
  }
  if (isCanvasTool(block.name)) {
    return <CanvasToolItem block={block} />
  }
  if (isImageGenTool(block.name)) {
    return <ImageGenToolItem block={block} />
  }
  if (isImageReadTool(block.name)) {
    return <SessionImageReadToolItem block={block} />
  }
  if (block.name.trim().toLowerCase() === "skill") {
    return <SkillToolItem block={block} />
  }
  return <GenericToolItem block={block} />
}

function SessionImageReadToolItem({ block }: { block: Extract<StreamBlock, { type: "tool_use" }> }) {
  const { runCwd } = useChatSession()
  return <ImageReadToolItem block={block} cwd={runCwd} />
}

function SkillToolItem({ block }: { block: Extract<StreamBlock, { type: "tool_use" }> }) {
  const { t } = useTranslation()
  const input = usefulToolInput(block.tool?.input) ?? usefulToolInput(block.input)
  const status = toolResultStatus(block.tool)
  const output = block.tool?.output?.trim() ?? ""
  return (
    <ToolResult
      tool={t(status === "running" ? "agentMessage.toolItem.skillRunning" : "agentMessage.toolItem.skillDone")}
      title={stringInput(input, "skill") ?? ""}
      icon={<ScrollTextIcon className="size-[1em]" />}
      status={status}
      defaultOpen={status === "running"}
      maxHeight={280}
      copyText={output || undefined}
      contentClassName="min-w-0"
    >
      {output ? <QuoteSelectable><MessageResponse mode="static" className="min-w-0 break-words text-sm">{output}</MessageResponse></QuoteSelectable> : null}
    </ToolResult>
  )
}

function GenericToolItem({
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
      icon={isImageEditTool(block.name) ? <ImagesIcon /> : <WrenchIcon />}
      title={toolItemStatusLabel(block.name, running, t)}
      badge={label}
      badgeVariant={variant}
      defaultOpen={running}
    >
      {output ? (
        <QuoteSelectable>
          <pre
            className={cn(
              "max-h-40 max-w-full overflow-y-auto whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]",
              TEXT_LINE_GAP_CLASS,
              tool?.ok === false ? "text-destructive" : "text-muted-foreground"
            )}
            role={tool?.ok === false ? "alert" : undefined}
          >
            {output}
          </pre>
        </QuoteSelectable>
      ) : null}
    </ProcessRow>
  )
}

function BashToolItem({
  block,
}: {
  block: Extract<StreamBlock, { type: "tool_use" }>
}) {
  const { t } = useTranslation()
  const input = usefulToolInput(block.tool?.input) ?? usefulToolInput(block.input)
  const command = stringInput(input, "command")
  const description = stringInput(input, "description")
  const output = block.tool?.backgroundTask ? "" : block.tool?.output?.trim() ?? ""
  const status = toolResultStatus(block.tool)
  const shouldReduceMotion = Boolean(useReducedMotion())
  const inputStreaming =
    status === "running" &&
    output === "" &&
    (jsonInputOpen(block.tool?.inputRaw) || command === undefined)
  const { text: typedCommand, caret: commandCaret } = useTypedCommand(
    command ?? "",
    inputStreaming
  )
  const awaitingOutput =
    !block.tool?.backgroundTask && status === "running" && !inputStreaming && !commandCaret
  const copyText = [command, output].filter(Boolean).join("\n")
  const showPrompt =
    inputStreaming || Boolean(command || output) || awaitingOutput
  const showOutput = Boolean(output) || (awaitingOutput && !shouldReduceMotion)
  const body = showPrompt ? (
    <div className="flex flex-col gap-2">
      <BashCommandLine text={typedCommand} caret={commandCaret} />
      {showOutput ? (
        <pre className="m-0 whitespace-pre-wrap break-words font-mono text-sm leading-5 text-muted-foreground">
          {output}
          {awaitingOutput && !shouldReduceMotion ? (
            <CommandCaret className="bg-muted-foreground" />
          ) : null}
        </pre>
      ) : null}
    </div>
  ) : null

  return (
    <div className="w-full min-w-0 px-0 py-0">
      <ToolResult
        tool={toolItemStatusLabel(block.name, status === "running", t)}
        title={description ?? (inputStreaming ? "" : command) ?? ""}
        kind="terminal"
        status={status}
        copyText={copyText || undefined}
        onCopy={
          copyText
            ? () => {
                void writeClipboardText(copyText)
              }
            : undefined
        }
        defaultOpen={status === "running"}
        collapseOnComplete
      >
        {body}
      </ToolResult>
    </div>
  )
}

function BashCommandLine({
  text,
  caret,
}: {
  text: string
  caret: boolean
}) {
  return (
    <div className="flex items-start">
      <span className="shrink-0 select-none whitespace-pre font-mono text-sm leading-none">
        {"$ "}
      </span>
      {caret ? (
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-sm leading-none text-foreground/80">
          {text}
          <CommandCaret />
        </span>
      ) : text ? (
        <ToolResultOutput className="min-w-0 flex-1 leading-none" language="bash">
          {text}
        </ToolResultOutput>
      ) : null}
    </div>
  )
}

function CommandCaret({ className }: { className?: string }) {
  return (
    <motion.span
      aria-hidden="true"
      className={cn(
        "ml-px inline-block h-[0.9em] w-[0.45ch] translate-y-[0.12em] bg-foreground/80",
        className
      )}
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{
        duration: 1,
        repeat: Infinity,
        ease: "linear",
        times: [0, 0.45, 0.55, 1],
      }}
    />
  )
}

function useTypedCommand(target: string, streaming: boolean): {
  text: string
  caret: boolean
} {
  const shouldReduceMotion = Boolean(useReducedMotion())
  const [shown, setShown] = React.useState(() =>
    shouldReduceMotion || !streaming ? target : ""
  )

  React.useEffect(() => {
    if (shouldReduceMotion) {
      setShown(target)
      return
    }
    if (shown === target) {
      return
    }
    if (!target.startsWith(shown)) {
      setShown(target)
      return
    }
    const remaining = target.length - shown.length
    const step = remaining > 32 ? Math.min(8, Math.ceil(remaining / 8)) : 1
    const id = window.setTimeout(() => {
      setShown(target.slice(0, shown.length + step))
    }, 16)
    return () => {
      window.clearTimeout(id)
    }
  }, [shouldReduceMotion, shown, target])

  if (shouldReduceMotion) {
    return { text: target, caret: false }
  }
  return { text: shown, caret: streaming || shown !== target }
}

function ToolFileName({
  path,
  status,
}: {
  path: string | undefined
  status: string
}) {
  const { runCwd } = useChatSession()
  if (path === undefined || path.trim() === "") {
    return ""
  }

  return (
    <FilePathLink
      path={resolveAgainstCwd(path, runCwd)}
      label={fileNameFromPath(path)}
      marquee
      recheckKey={status}
      className="text-muted-foreground/70"
    />
  )
}

function WriteToolItem({
  block,
}: {
  block: Extract<StreamBlock, { type: "tool_use" }>
}) {
  const { t } = useTranslation()
  const input = usefulToolInput(block.tool?.input) ?? usefulToolInput(block.input)
  const filePath =
    stringInput(input, "file_path") ?? stringInput(input, "path")
  const content =
    stringInput(input, "content", { allowBlank: true }) ??
    stringInput(input, "contents", { allowBlank: true })
  const output = block.tool?.output?.trim() ?? ""
  const status = toolResultStatus(block.tool)
  const fromPatch = fileDiffLinesFromUnified(output)
  const lines =
    fromPatch.length > 0
      ? fromPatch
      : content === undefined
        ? []
        : fileDiffLinesFromContent(content)
  const copyText = content ?? output
  const running = status === "running"

  return (
    <FileDiff
      tool={toolItemStatusLabel(block.name, running, t)}
      file={<ToolFileName path={filePath} status={status} />}
      lines={lines}
      status={running ? "streaming" : "complete"}
      language={languageFromPath(filePath)}
      icon={
        <FilePlusCornerIcon
          aria-hidden="true"
          className="block size-[1em] shrink-0 text-muted-foreground/70"
        />
      }
      copyText={copyText || undefined}
      onCopy={
        copyText
          ? () => {
              void writeClipboardText(copyText)
            }
          : undefined
      }
      defaultOpen={running}
      collapseOnComplete
    />
  )
}

function EditToolItem({
  block,
}: {
  block: Extract<StreamBlock, { type: "tool_use" }>
}) {
  const { t } = useTranslation()
  const input = usefulToolInput(block.tool?.input) ?? usefulToolInput(block.input)
  const filePath =
    stringInput(input, "file_path") ?? stringInput(input, "path")
  const oldString = stringInput(input, "old_string", { allowBlank: true })
  const newString = stringInput(input, "new_string", { allowBlank: true })
  const output = block.tool?.output?.trim() ?? ""
  const status = toolResultStatus(block.tool)
  const lines = fileDiffLinesFromEdit(oldString, newString, output)
  const copyText = fileDiffCopyText(lines) || output
  const running = status === "running"

  return (
    <FileDiff
      tool={toolItemStatusLabel(block.name, running, t)}
      file={<ToolFileName path={filePath} status={status} />}
      lines={lines}
      status={running ? "streaming" : "complete"}
      language={languageFromPath(filePath)}
      icon={
        <FilePenLineIcon
          aria-hidden="true"
          className="block size-[1em] shrink-0 text-muted-foreground/70"
        />
      }
      copyText={copyText || undefined}
      onCopy={
        copyText
          ? () => {
              void writeClipboardText(copyText)
            }
          : undefined
      }
      defaultOpen={running}
      collapseOnComplete
    />
  )
}

function ReadToolItem({
  block,
}: {
  block: Extract<StreamBlock, { type: "tool_use" }>
}) {
  const { t } = useTranslation()
  const input = usefulToolInput(block.tool?.input) ?? usefulToolInput(block.input)
  const filePath =
    stringInput(input, "file_path") ?? stringInput(input, "path")
  const status = toolResultStatus(block.tool)
  const running = status === "running"
  const view = running
    ? undefined
    : parseFileReadOutput(block.tool?.output)

  return (
    <FileRead
      tool={toolItemStatusLabel(block.name, running, t)}
      file={<ToolFileName path={filePath} status={status} />}
      imageHint={isImageFilePath(filePath)}
      view={view}
      status={running ? "streaming" : "complete"}
      language={languageFromPath(filePath)}
      defaultOpen={running}
      collapseOnComplete
    />
  )
}

function ProcessItemGroup({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <ItemGroup
      className={cn(
        "gap-1 py-0 text-muted-foreground/70 has-data-[size=sm]:gap-1 has-data-[size=xs]:gap-1",
        className
      )}
    >
      {React.Children.toArray(children).map((child, index) => (
        <motion.div
          key={React.isValidElement(child) ? child.key ?? index : index}
          data-layout-scroll-anchor
          layout="position"
          layoutDependency={false}
          className="flow-root min-w-0"
        >
          {child}
        </motion.div>
      ))}
    </ItemGroup>
  )
}

function ProcessRow({
  icon,
  title,
  badge,
  badgeVariant = "outline",
  defaultOpen = false,
  children,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  badge?: React.ReactNode
  badgeVariant?: "secondary" | "outline" | "destructive"
  defaultOpen?: boolean
  children?: React.ReactNode
}) {
  const hasBody = Boolean(children)
  const showActions = Boolean(badge || hasBody)
  const [open, setOpen] = React.useState(defaultOpen)

  const header = (
    <>
      {icon ? (
        <ItemMedia variant="icon" aria-hidden="true">
          {icon}
        </ItemMedia>
      ) : null}
      <ItemContent className="min-w-0 flex-none">
        <ItemTitle className="text-ui font-normal">{title}</ItemTitle>
      </ItemContent>
      {showActions ? (
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
    return (
      <Item
        size="sm"
        className="w-fit max-w-full bg-transparent px-0 py-0.5 text-ui hover:bg-transparent"
      >
        {header}
      </Item>
    )
  }

  return (
    <Collapsible
      className="group/process-item"
      open={open}
      onOpenChange={setOpen}
    >
      <Item
        size="sm"
        className="w-fit max-w-full cursor-pointer bg-transparent px-0 py-0.5 text-left text-ui hover:bg-transparent aria-expanded:bg-transparent"
        render={<CollapsibleTrigger />}
      >
        {header}
      </Item>
      <AgentDisclosure open={open}>
        <div
          className={cn(
            icon ? "pb-2 pl-6" : "pb-2",
            "text-sm",
            TEXT_LINE_GAP_CLASS
          )}
        >
          {children}
        </div>
      </AgentDisclosure>
    </Collapsible>
  )
}

function useLiveElapsedMs(
  startedAt: number | undefined,
  running: boolean
): number | undefined {
  const shouldReduceMotion = Boolean(useReducedMotion())
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!running || startedAt === undefined) {
      return
    }
    const intervalMs = shouldReduceMotion ? 1000 : 100
    const id = window.setInterval(() => {
      setNow(Date.now())
    }, intervalMs)
    return () => {
      window.clearInterval(id)
    }
  }, [running, startedAt, shouldReduceMotion])

  if (!running || startedAt === undefined) {
    return undefined
  }
  return Math.max(0, now - startedAt)
}

function formatElapsedMs(ms: number): string {
  const elapsed = Math.max(0, ms)
  if (elapsed < 10_000) {
    return `${(elapsed / 1000).toFixed(1)}s`
  }
  const totalSeconds = Math.round(elapsed / 1000)
  if (totalSeconds < 60) {
    return `${String(totalSeconds)}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`
}

function jsonInputOpen(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") {
    return false
  }
  try {
    JSON.parse(raw)
    return false
  } catch {
    return true
  }
}

function usefulToolInput(input: unknown): unknown {
  if (input === undefined || input === null) {
    return undefined
  }
  if (typeof input !== "object") {
    return input
  }
  if (Array.isArray(input)) {
    return input.length > 0 ? input : undefined
  }
  return Object.keys(input).length > 0 ? input : undefined
}

function stringInput(
  input: unknown,
  key: string,
  options?: { allowBlank?: boolean }
): string | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined
  }
  const value = (input as Record<string, unknown>)[key]
  if (typeof value !== "string") {
    return undefined
  }
  if (!options?.allowBlank && value.trim() === "") {
    return undefined
  }
  return value
}

function toolResultStatus(tool: ToolCard | undefined): ToolResultStatus {
  if (tool?.backgroundTask?.status === "failed") return "error"
  if (isToolRunning(tool)) {
    return "running"
  }
  if (tool?.ok === false) {
    return "error"
  }
  return "success"
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
