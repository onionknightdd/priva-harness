import { TriangleAlertIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message"

import type { AgentThreadMessage } from "../agent-message-data"

function StreamingCaret() {
  return (
    <span
      aria-hidden="true"
      className="ml-px inline-block h-[1.05em] w-px translate-y-px bg-foreground align-[-0.15em] motion-safe:animate-pulse"
    />
  )
}

export function AgentMessageItem({
  message,
}: {
  message: AgentThreadMessage
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const align = message.role === "user" ? "end" : "start"
  const isStreaming = message.status === "streaming"
  const isError = message.status === "error"
  const isThinking = isStreaming && message.content.length === 0

  return (
    <Message align={align}>
      <MessageContent>
        {isError ? (
          <motion.div
            className="flex w-fit max-w-full flex-col items-start gap-1"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
          >
            <MessageHeader className="gap-1.5 px-0 text-destructive">
              <TriangleAlertIcon
                aria-hidden="true"
                className="size-3.5"
                strokeWidth={1.75}
              />
              {t("agentMessage.errorLabel")}
            </MessageHeader>
            <Bubble align={align} variant="destructive" className="max-w-full">
              <BubbleContent
                className="whitespace-pre-wrap"
                role="alert"
              >
                {message.content}
              </BubbleContent>
            </Bubble>
          </motion.div>
        ) : (
          <Bubble
            align={align}
            variant={message.role === "user" ? "muted" : "ghost"}
          >
            <BubbleContent
              className="whitespace-pre-wrap"
              aria-live={message.role === "assistant" ? "polite" : undefined}
              aria-busy={isStreaming || undefined}
            >
              {isThinking ? (
                <span className="shimmer">{t("agentMessage.thinking")}</span>
              ) : (
                <>
                  {message.content}
                  {isStreaming ? <StreamingCaret /> : null}
                </>
              )}
            </BubbleContent>
          </Bubble>
        )}
      </MessageContent>
    </Message>
  )
}
