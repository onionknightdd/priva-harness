import * as React from "react"
import gsap from "gsap"
import { CheckIcon, ChevronDownIcon, CopyIcon, SplitIcon, TriangleAlertIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { writeClipboardText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

import type { RelativeTimeLabel } from "@/lib/relative-time"

import type {
  AgentThreadMessage,
  NestedAgent,
  StreamBlock,
  WorkflowCard,
} from "../agent-message-data"

function animateControl(control: HTMLButtonElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return
  }

  const target = control.querySelector("svg") ?? control

  gsap.fromTo(
    target,
    { scale: 0.78 },
    {
      scale: 1,
      duration: 0.28,
      ease: "back.out(2.5)",
      clearProps: "transform",
    }
  )
}

function AgentMessageCopyAction({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copyState, setCopyState] = React.useState<
    "idle" | "copied" | "failed"
  >("idle")
  const resetTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  const tooltip =
    copyState === "copied"
      ? t("agentMessage.copied")
      : copyState === "failed"
        ? t("agentMessage.copyFailed")
        : t("agentMessage.copy")

  return (
    <MessageAction
      tooltip={tooltip}
      label={tooltip}
      onClick={(event) => {
        animateControl(event.currentTarget)

        void writeClipboardText(text)
          .then(() => {
            setCopyState("copied")
          })
          .catch(() => {
            setCopyState("failed")
          })
          .finally(() => {
            if (resetTimerRef.current !== null) {
              window.clearTimeout(resetTimerRef.current)
            }

            resetTimerRef.current = window.setTimeout(() => {
              setCopyState("idle")
              resetTimerRef.current = null
            }, 1600)
          })
      }}
    >
      {copyState === "copied" ? (
        <CheckIcon className="size-3.5" aria-hidden="true" />
      ) : (
        <CopyIcon className="size-3.5" aria-hidden="true" />
      )}
    </MessageAction>
  )
}

function AgentMessageSplitAction({
  onFork,
  disabledReason,
}: {
  onFork?: () => void
  disabledReason?: string
}) {
  const { t } = useTranslation()
  const enabled = onFork !== undefined
  const label = enabled
    ? t("agentMessage.forkChat")
    : (disabledReason ?? t("agentMessage.forkChat"))

  const action = (
    <MessageAction
      tooltip={enabled ? label : undefined}
      label={label}
      disabled={!enabled}
      onClick={(event) => {
        if (!enabled) {
          return
        }

        animateControl(event.currentTarget)
        onFork?.()
      }}
    >
      <SplitIcon className="size-3.5" aria-hidden="true" />
    </MessageAction>
  )

  if (enabled) {
    return action
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {action}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function AgentMessageRelativeTime({
  relativeTime,
}: {
  relativeTime: RelativeTimeLabel
}) {
  const shouldReduceMotion = Boolean(useReducedMotion())

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <motion.time
          dateTime={relativeTime.dateTime}
          className="ml-1 px-1 text-sm leading-none text-muted-foreground/50"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
        >
          {relativeTime.label}
        </motion.time>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {relativeTime.absoluteLabel}
      </TooltipContent>
    </Tooltip>
  )
}

export function AgentMessageItem({
  message,
  relativeTime,
  onFork,
  forkDisabledReason,
}: {
  message: AgentThreadMessage
  relativeTime?: RelativeTimeLabel | null
  onFork?: () => void
  forkDisabledReason?: string
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const isStreaming = message.status === "streaming"
  const isError = message.status === "error"
  const thinking = (message.blocks ?? []).find((block) => block.type === "thinking")
  const isThinking =
    isStreaming &&
    message.content.length === 0 &&
    (thinking === undefined || thinking.text.length === 0)

  return (
    <Message from={message.role}>
      {isError ? (
        <motion.div
          className="flex w-fit max-w-full flex-col items-start gap-1"
          initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
        >
          <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <TriangleAlertIcon
              aria-hidden="true"
              className="size-3.5"
              strokeWidth={1.75}
            />
            {t("agentMessage.errorLabel")}
          </div>
          <MessageContent
            className="rounded-xl bg-destructive/10 px-4 py-3 text-destructive"
            role="alert"
          >
            {message.content}
          </MessageContent>
        </motion.div>
      ) : (
        <>
          <MessageContent
            aria-live={message.role === "assistant" ? "polite" : undefined}
            aria-busy={isStreaming || undefined}
            className={
              message.role === "user" ? "whitespace-pre-wrap" : undefined
            }
          >
            {isThinking ? (
              <span className="shimmer">{t("agentMessage.thinking")}</span>
            ) : message.role === "assistant" ? (
              <AssistantStreamBody message={message} isStreaming={isStreaming} />
            ) : (
              message.content
            )}
          </MessageContent>
          {message.role === "assistant" && message.status === "complete" ? (
            <MessageActions>
              <AgentMessageCopyAction text={message.content} />
              <AgentMessageSplitAction
                onFork={onFork}
                disabledReason={forkDisabledReason}
              />
              {relativeTime ? (
                <AgentMessageRelativeTime relativeTime={relativeTime} />
              ) : null}
            </MessageActions>
          ) : null}
        </>
      )}
    </Message>
  )
}

function AssistantStreamBody({
  message,
  isStreaming,
}: {
  message: AgentThreadMessage
  isStreaming: boolean
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const blocks = [...(message.blocks ?? [])].sort((left, right) => left.index - right.index)
  const thinking = blocks.find((block) => block.type === "thinking")
  const text = message.content
  const images = blocks.filter((block) => block.type === "image")
  const tools = blocks.filter((block) => block.type === "tool_use")

  return (
    <div className="flex flex-col gap-3">
      {thinking && thinking.text.trim() !== "" ? (
        <Collapsible className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <CollapsibleTrigger className="flex w-full items-center justify-between text-xs text-muted-foreground">
            {t("agentMessage.thinking")}
            <ChevronDownIcon className="size-3.5" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 whitespace-pre-wrap text-sm text-muted-foreground">
            {thinking.text}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {text.trim() !== "" ? (
        <MessageResponse
          animated={isStreaming && !shouldReduceMotion}
          isAnimating={isStreaming}
          mode={isStreaming ? "streaming" : "static"}
        >
          {text}
        </MessageResponse>
      ) : null}
      {images.map((image) => {
        const src =
          image.url ??
          (image.b64 === undefined
            ? undefined
            : `data:${image.mime ?? "image/png"};base64,${image.b64}`)
        if (src === undefined) {
          return null
        }
        return (
          <img
            key={image.blockId}
            alt={image.alt ?? ""}
            src={src}
            className="max-h-72 max-w-full rounded-lg border border-border/60"
          />
        )
      })}
      {tools.map((tool) => (
        <ToolBlockCard key={tool.id} block={tool} />
      ))}
      {(message.nestedAgents ?? []).map((agent) => (
        <NestedAgentCard key={agent.parentToolUseId} agent={agent} />
      ))}
      {(message.workflows ?? []).map((workflow) => (
        <WorkflowBlockCard key={workflow.workflowToolUseId} workflow={workflow} />
      ))}
    </div>
  )
}

function ToolBlockCard({ block }: { block: Extract<StreamBlock, { type: "tool_use" }> }) {
  const { t } = useTranslation()
  const status = block.tool?.launchStatus === "async_launched"
    ? t("agentMessage.asyncLaunched")
    : block.tool?.status === "completed"
      ? block.tool.ok === false
        ? t("agentMessage.toolFailed")
        : t("agentMessage.toolCompleted")
      : t("agentMessage.toolRunning")

  return (
    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs">{block.name}</span>
        <Badge variant="outline">{status}</Badge>
      </div>
      {block.tool?.output ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
          {block.tool.output}
        </pre>
      ) : null}
    </div>
  )
}

function NestedAgentCard({ agent }: { agent: NestedAgent }) {
  const { t } = useTranslation()
  const text = agent.blocks
    .filter((block) => block.type === "text")
    .sort((left, right) => left.index - right.index)
    .map((block) => block.text)
    .join("")

  return (
    <Collapsible
      defaultOpen={agent.status === "running"}
      className={cn(
        "rounded-lg border border-border/60 bg-muted/20 px-3 py-2",
        "motion-safe:transition-colors"
      )}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-sm">
        <span>{t("agentMessage.nestedAgent")}</span>
        <span className="flex items-center gap-2">
          <Badge variant="secondary">{agent.name ?? agent.agentId ?? agent.parentToolUseId}</Badge>
          <ChevronDownIcon className="size-3.5" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col gap-2 text-sm">
        {text ? <p className="whitespace-pre-wrap">{text}</p> : null}
        {agent.inbox.map((item, index) => (
          <p key={`${item.source}-${index}`} className="text-muted-foreground">
            {item.source === "coordinator"
              ? t("agentMessage.coordinatorMessage")
              : t("agentMessage.peerMessage")}
            {": "}
            {item.body}
          </p>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

function WorkflowBlockCard({ workflow }: { workflow: WorkflowCard }) {
  const { t } = useTranslation()
  return (
    <Collapsible className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-sm">
        <span>{t("agentMessage.workflow")}</span>
        <span className="flex items-center gap-2">
          <Badge variant="outline">{workflow.name ?? workflow.status}</Badge>
          <ChevronDownIcon className="size-3.5" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 text-sm text-muted-foreground">
        {workflow.summary ?? workflow.status}
      </CollapsibleContent>
    </Collapsible>
  )
}
