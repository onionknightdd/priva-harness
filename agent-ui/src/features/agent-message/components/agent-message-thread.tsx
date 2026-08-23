import { useCallback, useLayoutEffect, useRef } from "react"
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

import type { AgentThreadMessage } from "../agent-message-data"
import { AgentMessageItem } from "./agent-message-item"

export function AgentMessageThread({
  messages,
}: {
  messages: AgentThreadMessage[]
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

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 pt-6">
            {messages.map((message, index) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
                className={
                  index === messages.length - 1
                    ? "[content-visibility:visible]"
                    : undefined
                }
              >
                <AgentMessageItem
                  message={message}
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
              </MessageScrollerItem>
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
    </MessageScrollerProvider>
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
