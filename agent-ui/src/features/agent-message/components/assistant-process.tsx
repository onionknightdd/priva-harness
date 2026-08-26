import * as React from "react"
import {
  BotIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  FilePlusCornerIcon,
  ImageIcon,
  WorkflowIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

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
import { languageFromPath } from "@/lib/language-from-path"
import { cn } from "@/lib/utils"

import {
  isProcessBlock,
  type AgentThreadMessage,
  type NestedAgent,
  type StreamBlock,
  type ToolCard,
  type WorkflowCard,
} from "../agent-message-data"
import {
  fileDiffCopyText,
  fileDiffLinesFromContent,
  fileDiffLinesFromEdit,
  fileDiffLinesFromUnified,
} from "../file-diff-lines"
import { parseFileReadOutput, isImageFilePath } from "../file-read-view"
import {
  formatToolActivitySummary,
  isBashTool,
  isEditTool,
  isReadTool,
  isToolRunning,
  isWriteTool,
  toolItemStatusLabel,
} from "../tool-activity"

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
  const summary = formatToolActivitySummary(blocks, t)
  const statusLabel = isStreaming
    ? t("agentMessage.thinking")
    : t("agentMessage.chainOfThought")
  const statusText =
    summary === "" ? statusLabel : `${statusLabel} ${summary}`

  React.useEffect(() => {
    setOpen(isStreaming)
  }, [isStreaming])

  const rows: React.ReactNode[] = []
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
      rows.push(<ToolItem key={block.id} block={block} />)
    }
  }
  for (const agent of message.nestedAgents ?? []) {
    rows.push(<NestedAgentItem key={agent.parentToolUseId} agent={agent} />)
  }
  for (const workflow of message.workflows ?? []) {
    rows.push(
      <WorkflowItem key={workflow.workflowToolUseId} workflow={workflow} />
    )
  }

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
        <CollapsibleTrigger className="group/process-trigger flex max-w-full min-w-0 items-center gap-1 rounded-md bg-transparent px-0 py-0.5 text-left text-sm leading-snug font-medium text-muted-foreground/70 outline-none hover:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring">
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
        <CollapsibleContent className={PANEL_CLASS}>
          {rows.length > 0 ? <ProcessItemGroup>{rows}</ProcessItemGroup> : null}
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  )
}

function TextItem({ text }: { text: string }) {
  return (
    <div className="w-full min-w-0 px-0 py-0.5 text-sm text-foreground">
      <MessageResponse className="text-foreground [&_p]:my-0" mode="static">
        {text}
      </MessageResponse>
    </div>
  )
}

function ThinkingItem({
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
      <p className="whitespace-pre-wrap text-sm">{text}</p>
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
  return <GenericToolItem block={block} />
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
      icon={WrenchIcon}
      title={toolItemStatusLabel(block.name, running, t)}
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

function BashToolItem({
  block,
}: {
  block: Extract<StreamBlock, { type: "tool_use" }>
}) {
  const { t } = useTranslation()
  const input = usefulToolInput(block.tool?.input) ?? usefulToolInput(block.input)
  const command = stringInput(input, "command")
  const description = stringInput(input, "description")
  const output = block.tool?.output?.trim() ?? ""
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
    status === "running" && !inputStreaming && !commandCaret
  const copyText = [command, output].filter(Boolean).join("\n")
  const showPrompt =
    inputStreaming || Boolean(command || output) || awaitingOutput
  const showOutput = Boolean(output) || (awaitingOutput && !shouldReduceMotion)
  const body = showPrompt ? (
    <div className="flex flex-col gap-2">
      <BashCommandLine text={typedCommand} caret={commandCaret} />
      {showOutput ? (
        <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-none text-muted-foreground">
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
      <span className="shrink-0 select-none whitespace-pre font-mono text-xs leading-none">
        {"$ "}
      </span>
      {caret ? (
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-none text-foreground/80">
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
      file={fileNameFromPath(filePath)}
      lines={lines}
      status={running ? "streaming" : "complete"}
      language={languageFromPath(filePath)}
      icon={
        <FilePlusCornerIcon
          aria-hidden="true"
          className="size-[1em] shrink-0 text-muted-foreground/70"
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
      file={fileNameFromPath(filePath)}
      lines={lines}
      status={running ? "streaming" : "complete"}
      language={languageFromPath(filePath)}
      icon={
        <FilePenLineIcon
          aria-hidden="true"
          className="size-[1em] shrink-0 text-muted-foreground/70"
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
      file={fileNameFromPath(filePath)}
      imageHint={isImageFilePath(filePath)}
      view={view}
      status={running ? "streaming" : "complete"}
      language={languageFromPath(filePath)}
      defaultOpen={running}
      collapseOnComplete
    />
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
            <ItemGroup className="gap-1 text-muted-foreground">
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
            <ProcessItemGroup className="py-0">
              {tools.map((block) => (
                <ToolItem key={block.id} block={block} />
              ))}
            </ProcessItemGroup>
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
        "gap-0.5 py-0 text-muted-foreground/70 has-data-[size=sm]:gap-0.5 has-data-[size=xs]:gap-0.5",
        className
      )}
    >
      {children}
    </ItemGroup>
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
  icon?: LucideIcon
  title: React.ReactNode
  badge?: React.ReactNode
  badgeVariant?: "secondary" | "outline" | "destructive"
  defaultOpen?: boolean
  children?: React.ReactNode
}) {
  const hasBody = Boolean(children)
  const showActions = Boolean(badge || hasBody)

  const header = (
    <>
      {Icon ? (
        <ItemMedia variant="icon">
          <Icon />
        </ItemMedia>
      ) : null}
      <ItemContent className="min-w-0 flex-none">
        <ItemTitle>{title}</ItemTitle>
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
        className="w-fit max-w-full bg-transparent px-0 py-0.5 hover:bg-transparent"
      >
        {header}
      </Item>
    )
  }

  return (
    <Collapsible className="group/process-item" defaultOpen={defaultOpen}>
      <Item
        size="sm"
        className="w-fit max-w-full cursor-pointer bg-transparent px-0 py-0.5 text-left hover:bg-transparent aria-expanded:bg-transparent"
        render={<CollapsibleTrigger />}
      >
        {header}
      </Item>
      <CollapsibleContent className={PANEL_CLASS}>
        <div className={Icon ? "pb-2 pl-6" : "pb-2"}>{children}</div>
      </CollapsibleContent>
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

function fileNameFromPath(path: string | undefined): string {
  if (path === undefined || path.trim() === "") {
    return ""
  }
  const trimmed = path.trim().replaceAll("\\", "/")
  const parts = trimmed.split("/")
  return parts.at(-1) || trimmed
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
  if (tool?.launchStatus === "async_launched" || isToolRunning(tool)) {
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
