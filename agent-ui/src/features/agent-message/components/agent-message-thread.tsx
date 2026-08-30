import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { flushSync } from "react-dom"
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
import {
  EXPAND_LOCK_MS,
  captureExpandTrigger,
  isExpandScrollLocked,
  keepExpandTriggerInPlace,
  releaseThreadFollow,
} from "../expand-down-anchor"
import { foldCommandSurfaces } from "../slash-command-envelope"
import {
  groupThreadTurns,
  turnStickyParts,
  type ThreadTurn,
} from "../thread-turns"
import { AgentMessageItem } from "./agent-message-item"
import { AssistantQuoteMenu } from "./assistant-quote-menu"
import { StickyFreeze } from "./sticky-freeze"
import { TaskPlanPopover } from "./task-plan-popover"
import { WorkingStatusLine } from "./working-status-line"

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
  const [followPaused, setFollowPaused] = useState(false)
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
  const visibleMessages = useMemo(
    () => foldCommandSurfaces(messages),
    [messages]
  )
  const turns = useMemo(
    () => groupThreadTurns(visibleMessages),
    [visibleMessages]
  )

  const renderMessage = (
    message: AgentThreadMessage,
    hideProcessHeader = false
  ) => (
    <AgentMessageItem
      key={message.id}
      message={message}
      hideProcessHeader={hideProcessHeader}
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
    <MessageScrollerProvider autoScroll={!followPaused}>
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
        <KeepExpandAnchor onFollowPausedChange={setFollowPaused} />
        <PinLatestAtCenter messages={messages} />
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2">
            <TaskPlanPopover messages={messages} />
            <MessageScrollerButton className="relative inset-s-auto translate-x-0 rtl:translate-x-0 data-[direction=end]:bottom-auto data-[direction=end]:data-[active=false]:translate-y-0 data-[active=false]:hidden">
              <ArrowDownIcon />
              <span className="sr-only">{t("agentMessage.scrollToLatest")}</span>
            </MessageScrollerButton>
          </div>
        </div>
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
    hideProcessHeader?: boolean
  ) => ReactNode
  turn: ThreadTurn
}) {
  const { user, working } = turnStickyParts(turn)
  const freezeTurn = user !== null || working !== null
  const userRef = useRef<HTMLDivElement>(null)
  const [userHeight, setUserHeight] = useState(0)
  const [workingStuck, setWorkingStuck] = useState(false)

  useLayoutEffect(() => {
    const userBar = userRef.current
    if (!userBar) {
      setUserHeight(0)
      return
    }

    const syncHeight = () => {
      setUserHeight(Math.round(userBar.getBoundingClientRect().height))
    }

    syncHeight()
    const observer = new ResizeObserver(syncHeight)
    observer.observe(userBar)
    return () => observer.disconnect()
  }, [user?.id])

  useLayoutEffect(() => {
    if (working === null) {
      setWorkingStuck(false)
    }
  }, [working])

  return (
    <MessageScrollerItem
      messageId={turn.id}
      scrollAnchor={freezeTurn}
      className={cn(
        "flex flex-col overflow-visible",
        working ? "gap-2" : "gap-6",
        (isLast || freezeTurn) && "[content-visibility:visible]"
      )}
    >
      {user ? (
        <StickyFreeze
          ref={userRef}
          className="z-20"
          showBelowMask={!workingStuck}
        >
          {renderMessage(user)}
        </StickyFreeze>
      ) : null}
      {working ? (
        <StickyFreeze
          className="z-10"
          onStuckChange={setWorkingStuck}
          top={user ? userHeight : 0}
        >
          <WorkingStatusLine message={working} />
        </StickyFreeze>
      ) : null}
      {turn.replies.map((message) =>
        renderMessage(message, message.status === "streaming")
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

function KeepExpandAnchor({
  onFollowPausedChange,
}: {
  onFollowPausedChange: (paused: boolean) => void
}) {
  useLayoutEffect(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="message-scroller-viewport"]'
    )
    if (!viewport) {
      return
    }

    let resumeTimer = 0
    const start = (target: EventTarget | null) => {
      captureExpandTrigger(target)
      if (!isExpandScrollLocked()) {
        return
      }
      flushSync(() => {
        onFollowPausedChange(true)
      })
      captureExpandTrigger(target)
      releaseThreadFollow(viewport)
      window.clearTimeout(resumeTimer)
      resumeTimer = window.setTimeout(() => {
        onFollowPausedChange(false)
      }, EXPAND_LOCK_MS)
    }
    const restore = () => {
      if (!keepExpandTriggerInPlace(viewport)) {
        return
      }
      requestAnimationFrame(() => {
        keepExpandTriggerInPlace(viewport)
      })
    }

    const onPointerDown = (event: PointerEvent) => {
      start(event.target)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        start(event.target)
      }
    }

    viewport.addEventListener("pointerdown", onPointerDown, true)
    viewport.addEventListener("keydown", onKeyDown, true)

    const content = viewport.querySelector(
      '[data-slot="message-scroller-content"]'
    )
    const observer = new ResizeObserver(restore)
    if (content) {
      observer.observe(content)
    }

    return () => {
      window.clearTimeout(resumeTimer)
      viewport.removeEventListener("pointerdown", onPointerDown, true)
      viewport.removeEventListener("keydown", onKeyDown, true)
      observer.disconnect()
    }
  }, [onFollowPausedChange])

  return null
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
    if (!pinnedRef.current || isExpandScrollLocked()) {
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
