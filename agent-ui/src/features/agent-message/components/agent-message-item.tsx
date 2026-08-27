import * as React from "react"
import gsap from "gsap"
import {
  CheckIcon,
  CopyIcon,
  SplitIcon,
  TriangleAlertIcon,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { writeClipboardText } from "@/lib/clipboard"

import type { RelativeTimeLabel } from "@/lib/relative-time"

import {
  assistantHasProcess,
  type AgentThreadMessage,
} from "../agent-message-data"
import { AssistantProcess } from "./assistant-process"
import { AssistantMarkdownCode } from "./assistant-markdown-code"
import { QuoteSelectable } from "./quote-selectable"

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
  hideProcessHeader = false,
}: {
  message: AgentThreadMessage
  relativeTime?: RelativeTimeLabel | null
  onFork?: () => void
  forkDisabledReason?: string
  hideProcessHeader?: boolean
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const isStreaming = message.status === "streaming"
  const isError = message.status === "error"

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
            <QuoteSelectable>{message.content}</QuoteSelectable>
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
            {message.role === "assistant" ? (
              <AssistantStreamBody
                message={message}
                isStreaming={isStreaming}
                hideProcessHeader={hideProcessHeader}
              />
            ) : (
              <QuoteSelectable>{message.content}</QuoteSelectable>
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
  hideProcessHeader,
}: {
  message: AgentThreadMessage
  isStreaming: boolean
  hideProcessHeader: boolean
}) {
  const shouldReduceMotion = Boolean(useReducedMotion())
  const text = message.content
  const hasProcess = assistantHasProcess(message)
  const showProcess = hasProcess || (isStreaming && !hideProcessHeader)

  return (
    <div className="flex flex-col gap-3">
      {showProcess ? (
        <AssistantProcess
          message={message}
          isStreaming={isStreaming}
          hideHeader={hideProcessHeader}
        />
      ) : null}
      {text.trim() !== "" ? (
        <QuoteSelectable>
          <MessageResponse
            animated={isStreaming && !shouldReduceMotion}
            isAnimating={isStreaming}
            mode={isStreaming ? "streaming" : "static"}
            components={{ code: AssistantMarkdownCode }}
          >
            {text}
          </MessageResponse>
        </QuoteSelectable>
      ) : null}
    </div>
  )
}
