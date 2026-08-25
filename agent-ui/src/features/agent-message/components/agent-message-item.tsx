import * as React from "react"
import gsap from "gsap"
import {
  BotIcon,
  BrainIcon,
  CheckIcon,
  CopyIcon,
  ImageIcon,
  SplitIcon,
  TriangleAlertIcon,
  WorkflowIcon,
  WrenchIcon,
} from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtImage,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { writeClipboardText } from "@/lib/clipboard"

import type { RelativeTimeLabel } from "@/lib/relative-time"

import type {
  AgentThreadMessage,
  NestedAgent,
  StreamBlock,
  ToolCard,
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
  const showPlaceholder =
    isStreaming &&
    message.content.length === 0 &&
    !assistantHasProcess(message)

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
            {showPlaceholder ? (
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
  const [open, setOpen] = React.useState(isStreaming)
  const blocks = [...(message.blocks ?? [])].sort((left, right) => left.index - right.index)
  const thinking = blocks.find((block) => block.type === "thinking")
  const text = message.content
  const images = blocks.filter((block) => block.type === "image")
  const tools = blocks.filter((block) => block.type === "tool_use")
  const nestedAgents = message.nestedAgents ?? []
  const workflows = message.workflows ?? []
  const hasProcess =
    (thinking !== undefined && thinking.text.trim() !== "") ||
    images.length > 0 ||
    tools.length > 0 ||
    nestedAgents.length > 0 ||
    workflows.length > 0
  const stepCount =
    (thinking !== undefined && thinking.text.trim() !== "" ? 1 : 0) +
    images.length +
    tools.length +
    nestedAgents.length +
    workflows.length

  React.useEffect(() => {
    setOpen(isStreaming)
  }, [isStreaming])

  return (
    <div className="flex flex-col gap-3">
      {hasProcess ? (
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
        >
          <ChainOfThought open={open} onOpenChange={setOpen}>
            <ChainOfThoughtHeader>
              {isStreaming
                ? t("agentMessage.thinking")
                : stepCount > 1
                  ? t("agentMessage.chainOfThoughtSteps", { count: stepCount })
                  : t("agentMessage.chainOfThought")}
            </ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              {thinking && thinking.text.trim() !== "" ? (
                <ChainOfThoughtStep
                  icon={BrainIcon}
                  label={t("agentMessage.thinking")}
                  status={isStreaming && text.trim() === "" ? "active" : "complete"}
                >
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {thinking.text}
                  </p>
                </ChainOfThoughtStep>
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
                  <ChainOfThoughtStep
                    key={image.blockId}
                    icon={ImageIcon}
                    label={image.alt || t("agentMessage.generatedImage")}
                    status="complete"
                  >
                    <ChainOfThoughtImage caption={image.alt}>
                      <img
                        alt={image.alt ?? ""}
                        src={src}
                        className="max-h-72 max-w-full"
                      />
                    </ChainOfThoughtImage>
                  </ChainOfThoughtStep>
                )
              })}
              {tools.map((tool) => (
                <ToolStep key={tool.id} block={tool} />
              ))}
              {nestedAgents.map((agent) => (
                <NestedAgentStep key={agent.parentToolUseId} agent={agent} />
              ))}
              {workflows.map((workflow) => (
                <WorkflowStep key={workflow.workflowToolUseId} workflow={workflow} />
              ))}
            </ChainOfThoughtContent>
          </ChainOfThought>
        </motion.div>
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
    </div>
  )
}

function assistantHasProcess(message: AgentThreadMessage): boolean {
  if ((message.nestedAgents?.length ?? 0) > 0) {
    return true
  }
  if ((message.workflows?.length ?? 0) > 0) {
    return true
  }
  return (message.blocks ?? []).some((block) => {
    if (block.type === "tool_use" || block.type === "image") {
      return true
    }
    return block.type === "thinking" && block.text.trim() !== ""
  })
}

function toolStepStatus(tool: ToolCard | undefined): "active" | "complete" {
  if (tool?.launchStatus === "async_launched") {
    return "active"
  }
  if (tool?.status === "completed") {
    return "complete"
  }
  return "active"
}

function ToolStep({ block }: { block: Extract<StreamBlock, { type: "tool_use" }> }) {
  const { t } = useTranslation()
  const tool = block.tool
  const description =
    tool?.launchStatus === "async_launched"
      ? t("agentMessage.runInBackground")
      : tool?.status === "completed"
        ? tool.ok === false
          ? t("agentMessage.toolFailed")
          : t("agentMessage.toolCompleted")
        : t("agentMessage.toolRunning")

  return (
    <ChainOfThoughtStep
      icon={WrenchIcon}
      label={block.name}
      description={description}
      status={toolStepStatus(tool)}
    >
      {tool?.output ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
          {tool.output}
        </pre>
      ) : null}
    </ChainOfThoughtStep>
  )
}

function NestedAgentStep({ agent }: { agent: NestedAgent }) {
  const { t } = useTranslation()
  const text = agent.blocks
    .filter((block) => block.type === "text")
    .sort((left, right) => left.index - right.index)
    .map((block) => block.text)
    .join("")
  const tools = agent.blocks.filter((block) => block.type === "tool_use")
  const background = agent.status === "running"

  return (
    <ChainOfThoughtStep
      icon={BotIcon}
      label={t("agentMessage.nestedAgent")}
      description={
        background
          ? t("agentMessage.runInBackground")
          : (agent.name ?? agent.agentId ?? agent.parentToolUseId)
      }
      status={background ? "active" : "complete"}
    >
      {text ? <p className="whitespace-pre-wrap">{text}</p> : null}
      {agent.inbox.length > 0 ? (
        <ChainOfThoughtSearchResults>
          {agent.inbox.map((item, index) => (
            <ChainOfThoughtSearchResult key={`${item.source}-${index}`}>
              {item.source === "coordinator"
                ? t("agentMessage.coordinatorMessage")
                : t("agentMessage.peerMessage")}
              {": "}
              {item.body}
            </ChainOfThoughtSearchResult>
          ))}
        </ChainOfThoughtSearchResults>
      ) : null}
      {tools.map((tool) => (
        <ToolStep key={tool.id} block={tool} />
      ))}
    </ChainOfThoughtStep>
  )
}

function WorkflowStep({ workflow }: { workflow: WorkflowCard }) {
  const { t } = useTranslation()
  const running =
    workflow.status !== "completed" &&
    workflow.status !== "complete" &&
    workflow.status !== "failed" &&
    workflow.status !== "error"
  return (
    <ChainOfThoughtStep
      icon={WorkflowIcon}
      label={workflow.name ?? t("agentMessage.workflow")}
      description={workflow.summary ?? workflow.status}
      status={running ? "active" : "complete"}
    />
  )
}
