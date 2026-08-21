import * as React from "react"
import { CopyIcon, TriangleAlertIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import { writeClipboardText } from "@/lib/clipboard"

import type { AgentThreadMessage } from "../agent-message-data"

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
      label={t("agentMessage.copy")}
      onClick={() => {
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
      <CopyIcon />
    </MessageAction>
  )
}

export function AgentMessageItem({
  message,
}: {
  message: AgentThreadMessage
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const isStreaming = message.status === "streaming"
  const isError = message.status === "error"
  const isThinking = isStreaming && message.content.length === 0

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
            className="bg-destructive/10 px-4 py-3 text-destructive"
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
              <MessageResponse
                animated={isStreaming && !shouldReduceMotion}
                isAnimating={isStreaming}
                mode={isStreaming ? "streaming" : "static"}
              >
                {message.content}
              </MessageResponse>
            ) : (
              message.content
            )}
          </MessageContent>
          {message.role === "assistant" && message.status === "complete" ? (
            <MessageActions>
              <AgentMessageCopyAction text={message.content} />
            </MessageActions>
          ) : null}
        </>
      )}
    </Message>
  )
}
