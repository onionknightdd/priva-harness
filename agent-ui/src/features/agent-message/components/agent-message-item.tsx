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
import { Marker, MarkerContent } from "@/components/ui/marker"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { writeClipboardText } from "@/lib/clipboard"
import { EASE_OUT } from "@/lib/ease"

import { formatSessionRelativeTime, useSharedNow } from "@/lib/relative-time"

import {
  assistantHasProcess,
  type AgentThreadMessage,
} from "../agent-message-data"
import { PopupsArmedContext } from "@/components/ui/popups-armed-context"
import { useForkAvailability } from "../fork-context"
import { userMessageSurface } from "../slash-command-envelope"
import { AssistantProcess } from "./assistant-process"
import { assistantTimeline } from "../assistant-timeline"
import { TaskNotificationCard } from "./task-notification-card"
import { CompactSessionMarker } from "./compact-session-marker"
import { AssistantMarkdownCode } from "./assistant-markdown-code"
import { QuoteSelectable } from "./quote-selectable"
import { UserMessageAttachments } from "./user-message-attachments"

const MotionMessageActions = motion.create(MessageActions)

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

function AgentMessageSplitAction({ message }: { message: AgentThreadMessage }) {
  const { t } = useTranslation()
  const { forkFrom, disabledReason } = useForkAvailability()
  const enabled = forkFrom !== undefined
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
        forkFrom?.(message)
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

const FRESH_MESSAGE_WINDOW_MS = 2000

/** Decided once at mount: a message the user just sent rises in from the
 * composer; history restored for an existing session appears in place. */
function useIsFreshMessage(createdAt: string) {
  const [fresh] = React.useState(
    () => Date.now() - Date.parse(createdAt) < FRESH_MESSAGE_WINDOW_MS
  )
  return fresh
}

// Subscribes to the shared clock itself, so a tick re-renders only this label
// and not the memoized message around it.
function AgentMessageRelativeTime({ createdAt }: { createdAt: string }) {
  const { t, i18n } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const now = useSharedNow()
  const relativeTime = formatSessionRelativeTime(
    Date.parse(createdAt),
    i18n.resolvedLanguage ?? i18n.language,
    t("agentMessage.justNow"),
    now
  )

  if (!relativeTime) {
    return null
  }

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

// Memoized so that streaming updates and thread-level state changes only
// re-render the messages whose props actually changed.
export const AgentMessageItem = React.memo(function AgentMessageItem({
  message,
  hideProcessHeader = false,
}: {
  message: AgentThreadMessage
  hideProcessHeader?: boolean
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const isFresh = useIsFreshMessage(message.createdAt)
  const isStreaming = message.status === "streaming"
  const isError = message.status === "error"
  // Context menus on inline file references mount once the pointer or focus
  // reaches this message; see PopupsArmedContext.
  const [popupsArmed, setPopupsArmed] = React.useState(false)
  const armPopups = () => setPopupsArmed(true)

  if (message.role === "user" && !message.attachments?.length) {
    const surface = userMessageSurface(message.content, message.compact)
    if (surface === "hidden") {
      return null
    }
    if (surface === "conversation-compacted") {
      return (
        <CompactSessionMarker
          compact={
            message.compact ?? {
              phase: "compacting",
            }
          }
        />
      )
    }
    if (surface === "session-reset") {
      return (
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
        >
          <Marker variant="separator">
            <MarkerContent>{t("agentMessage.sessionReset")}</MarkerContent>
          </Marker>
        </motion.div>
      )
    }
  }

  const body = (
    <PopupsArmedContext.Provider value={popupsArmed}>
    <Message from={message.role} onPointerEnter={armPopups} onFocusCapture={armPopups}>
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
              message.role === "user" ? "whitespace-pre-wrap" : "overflow-visible"
            }
          >
            {message.role === "assistant" ? (
              <AssistantStreamBody
                message={message}
                isStreaming={isStreaming}
                hideProcessHeader={hideProcessHeader}
              />
            ) : (
              <>
                {message.attachments?.length ? <UserMessageAttachments attachments={message.attachments} /> : null}
                {message.content ? <QuoteSelectable>{message.content}</QuoteSelectable> : null}
              </>
            )}
          </MessageContent>
          {message.role === "assistant" && message.status === "complete" ? (
            <MotionMessageActions layout="position" layoutDependency={false}>
              <AgentMessageCopyAction text={message.role === "assistant" ? assistantTimeline(message).map((section) => section.message.content).filter(Boolean).join("\n\n") : message.content} />
              <AgentMessageSplitAction message={message} />
              <AgentMessageRelativeTime createdAt={message.createdAt} />
            </MotionMessageActions>
          ) : null}
        </>
      )}
    </Message>
    </PopupsArmedContext.Provider>
  )

  if (message.role !== "user") {
    return body
  }

  // A freshly sent message rises from the composer below it; the assistant
  // side already fades its process header in, so the two now share a rhythm.
  return (
    <motion.div
      initial={isFresh && !shouldReduceMotion ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
    >
      {body}
    </motion.div>
  )
})

function AssistantStreamBody({
  message,
  isStreaming,
  hideProcessHeader,
}: {
  message: AgentThreadMessage
  isStreaming: boolean
  hideProcessHeader: boolean
}) {
  const sections = assistantTimeline(message)
  return <div className="flex flex-col gap-3">
    {sections.map((section, index) => <motion.div key={section.id} layout="position" layoutDependency={false} className="flex flex-col gap-3">
      {section.notification ? <TaskNotificationCard notification={section.notification} /> : null}
      <AssistantSegment message={section.message} isStreaming={isStreaming && index === sections.length - 1}
        hideProcessHeader={hideProcessHeader || index > 0} />
    </motion.div>)}
  </div>
}

function AssistantSegment({
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
        <motion.div layout="position" layoutDependency={false} className="min-w-0">
          <QuoteSelectable>
            <MessageResponse
              className="[&_p]:[line-height:1.5em] [&_p+p]:mt-[2px]"
              animated={isStreaming && !shouldReduceMotion}
              isAnimating={isStreaming}
              mode={isStreaming ? "streaming" : "static"}
              components={{ code: AssistantMarkdownCode }}
            >
              {text}
            </MessageResponse>
          </QuoteSelectable>
        </motion.div>
      ) : null}
    </div>
  )
}
