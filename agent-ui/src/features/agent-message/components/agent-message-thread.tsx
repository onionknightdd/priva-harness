import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { ArrowDownIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller"
import { useChatSession } from "@/features/chat-session"
import { sessionDisplayTitle } from "@/features/sidebar/content/session-projects"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { formatSessionRelativeTime, useTickingNow } from "@/lib/relative-time"
import { cn } from "@/lib/utils"

import type { AgentThreadMessage } from "../agent-message-data"
import { groupThreadTurns, type ThreadTurn } from "../thread-turns"
import { AgentMessageItem } from "./agent-message-item"
import { AssistantQuoteMenu } from "./assistant-quote-menu"
import { StickyFreeze } from "./sticky-freeze"

export function AgentMessageThread({
  messages,
  onQuote,
}: {
  messages: AgentThreadMessage[]
  onQuote?: (text: string) => void
}) {
  const { t, i18n } = useTranslation()
  const { runHarnessId } = useHarness()
  const {
    activeSession,
    canFork,
    forkFrom,
    forking,
    runSessionId,
  } = useChatSession()
  const now = useTickingNow()
  const untitled = t("sidebar.projects.untitledSession")
  const locale = i18n.resolvedLanguage ?? i18n.language
  const justNow = t("agentMessage.justNow")
  const forkDisabledReason = canFork
    ? undefined
    : runHarnessId !== "claude"
      ? t("agentMessage.forkUnsupported")
      : forking
        ? t("agentMessage.forking")
        : runSessionId
          ? undefined
          : t("agentMessage.forkNeedsSession")
  const stem = activeSession
    ? sessionDisplayTitle(activeSession, untitled)
    : untitled
  const turns = useMemo(() => groupThreadTurns(messages), [messages])

  const renderMessage = (
    message: AgentThreadMessage,
    stickyWorkingTop = 0
  ) => (
    <AgentMessageItem
      key={message.id}
      message={message}
      stickyWorkingTop={stickyWorkingTop}
      relativeTime={formatSessionRelativeTime(
        Date.parse(message.createdAt),
        locale,
        justNow,
        now
      )}
      onFork={
        canFork
          ? () => {
              void forkFrom({ message, messages, stem })
            }
          : undefined
      }
      forkDisabledReason={forkDisabledReason}
    />
  )

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 pt-6">
            {turns.map((turn, index) => (
              <ThreadTurnItem
                key={turn.id}
                isLast={index === turns.length - 1}
                renderMessage={renderMessage}
                turn={turn}
              />
            ))}
            <ThreadEndSpacer />
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <PinLatestAtCenter messages={messages} />
        <MessageScrollerButton>
          <ArrowDownIcon />
          <span className="sr-only">{t("agentMessage.scrollToLatest")}</span>
        </MessageScrollerButton>
      </MessageScroller>
      {onQuote ? <AssistantQuoteMenu onQuote={onQuote} /> : null}
    </MessageScrollerProvider>
  )
}

function ThreadTurnItem({
  isLast,
  renderMessage,
  turn,
}: {
  isLast: boolean
  renderMessage: (
    message: AgentThreadMessage,
    stickyWorkingTop?: number
  ) => ReactNode
  turn: ThreadTurn
}) {
  const userRef = useRef<HTMLDivElement>(null)
  const [userHeight, setUserHeight] = useState(0)
  const freezeUser = turn.user !== null
  const streamingReply = turn.replies.some(
    (message) => message.status === "streaming"
  )

  useLayoutEffect(() => {
    const user = userRef.current
    if (!user) {
      setUserHeight(0)
      return
    }

    const syncHeight = () => {
      setUserHeight(Math.round(user.getBoundingClientRect().height))
    }

    syncHeight()
    const observer = new ResizeObserver(syncHeight)
    observer.observe(user)
    return () => observer.disconnect()
  }, [turn.user?.id])

  return (
    <MessageScrollerItem
      messageId={turn.id}
      scrollAnchor={freezeUser}
      className={cn(
        "flex flex-col gap-6 overflow-visible",
        (isLast || freezeUser) && "[content-visibility:visible]"
      )}
    >
      {turn.user ? (
        <StickyFreeze
          ref={userRef}
          className="z-20"
          showTailMask={!streamingReply}
        >
          {renderMessage(turn.user)}
        </StickyFreeze>
      ) : null}
      {turn.replies.map((message) =>
        renderMessage(message, userHeight)
      )}
    </MessageScrollerItem>
  )
}

function ThreadEndSpacer() {
  const spacerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const spacer = spacerRef.current
    if (!spacer) {
      return
    }

    const viewport = spacer.closest<HTMLElement>(
      '[data-slot="message-scroller-viewport"]'
    )
    if (!viewport) {
      return
    }

    const syncHeight = () => {
      spacer.style.height = `${Math.round(viewport.clientHeight / 2)}px`
    }

    syncHeight()
    const observer = new ResizeObserver(syncHeight)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={spacerRef}
      aria-hidden
      data-slot="thread-end-spacer"
      className="pointer-events-none -mt-6 shrink-0 [overflow-anchor:none]"
    />
  )
}

const END_EDGE_PX = 8

function isScrolledToEnd(viewport: HTMLElement) {
  return (
    viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <=
    END_EDGE_PX
  )
}

function PinLatestAtCenter({
  messages,
}: {
  messages: AgentThreadMessage[]
}) {
  const { scrollToEnd } = useMessageScroller()
  const pinnedRef = useRef(true)
  const programmaticRef = useRef(false)
  const threadKey = messages[0]?.id ?? "empty"

  const followLatest = useCallback(() => {
    if (!pinnedRef.current) {
      return
    }

    programmaticRef.current = true
    scrollToEnd({ behavior: "auto" })
    requestAnimationFrame(() => {
      programmaticRef.current = false
    })
  }, [scrollToEnd])

  useLayoutEffect(() => {
    pinnedRef.current = true
  }, [threadKey])

  useLayoutEffect(() => {
    followLatest()
  }, [followLatest, messages])

  useLayoutEffect(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="message-scroller-viewport"]'
    )
    if (!viewport) {
      return
    }

    const onScroll = () => {
      if (programmaticRef.current) {
        return
      }

      pinnedRef.current = isScrolledToEnd(viewport)
    }

    viewport.addEventListener("scroll", onScroll, { passive: true })

    const content = viewport.querySelector(
      '[data-slot="message-scroller-content"]'
    )
    const observed = new Set<Element>()
    const observer = new ResizeObserver(followLatest)

    const syncObserved = () => {
      const next = new Set<Element>()
      if (content) {
        next.add(content)
      }

      const items = content?.querySelectorAll(
        '[data-slot="message-scroller-item"]'
      )
      const last = items?.[items.length - 1]
      if (last) {
        next.add(last)
      }

      for (const element of observed) {
        if (!next.has(element)) {
          observer.unobserve(element)
          observed.delete(element)
        }
      }

      for (const element of next) {
        if (!observed.has(element)) {
          observer.observe(element)
          observed.add(element)
        }
      }
    }

    syncObserved()
    const mutations = new MutationObserver(syncObserved)
    if (content) {
      mutations.observe(content, { childList: true })
    }

    return () => {
      viewport.removeEventListener("scroll", onScroll)
      observer.disconnect()
      mutations.disconnect()
    }
  }, [followLatest])

  return null
}
