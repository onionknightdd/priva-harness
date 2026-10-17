import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  LayoutGroup,
  MotionConfig,
  motion,
  useReducedMotionConfig,
} from "motion/react"
import { flushSync } from "react-dom"
import { useTranslation } from "react-i18next"

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { useActiveSession, useChatSessionActions } from "@/features/chat-session"
import { checkFileExists } from "@/features/files/file-existence"
import { sessionDisplayTitle } from "@/features/sidebar/content/session-projects"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { TickingNowProvider, useTickingNow } from "@/lib/relative-time"
import { cn } from "@/lib/utils"

import type { AgentThreadMessage } from "../agent-message-data"
import { AGENT_CHAT_HEADER_HEIGHT } from "../agent-chat-layout"
import {
  captureExpandTrigger,
  isExpandScrollLocked,
  keepExpandTriggerInPlace,
  releaseThreadFollow,
  resetExpandAnchor,
} from "../expand-down-anchor"
import { ForkContext, type ForkAvailability } from "../fork-context"
import { foldCommandSurfaces } from "../slash-command-envelope"
import { questionSummaryTransition } from "../question-summary-motion"
import { QuoteInChatContext, type OnQuoteInChat } from "../selection-actions-context"
import { collectThreadFilePaths } from "../thread-file-paths"
import {
  groupThreadTurns,
  initialRevealWindow,
  markRevealPrepared,
  nextRevealWindow,
  revealNextBatch,
  reuseThreadTurns,
  turnStickyParts,
  type ThreadTurn,
} from "../thread-turns"
import { isUserMessageBubble, scrollUserMessageTurnIntoView, userMessageRailEntries, type UserMessageRailEntry } from "../user-message-rail"
import { AgentMessageItem } from "./agent-message-item"
import { FollowLatestMessage } from "./follow-latest-message"
import { UserMessageRail } from "./user-message-rail"
import { MessageSelectionActions } from "./message-selection-actions"
import { StickyFreeze } from "./sticky-freeze"
import { ThreadGlass } from "./thread-glass"
import { TaskPlanPopover } from "./task-plan-popover"
import { WorkingStatusLine } from "./working-status-line"

const MotionScrollerViewport = motion.create(MessageScrollerViewport)
const MotionScrollerItem = motion.create(MessageScrollerItem)

// Upper bound on holding a transcript for its file-existence batch; a slow
// server degrades to the per-reference settling instead of a blank thread.
const FILE_PREFETCH_TIMEOUT_MS = 400

export function AgentMessageThread({
  messages,
  onSelectionAction,
}: {
  messages: AgentThreadMessage[]
  onSelectionAction?: OnQuoteInChat
}) {
  const { t } = useTranslation()
  const { runHarnessId } = useHarness()
  const { activeSession, canFork, forking, runCwd, runSessionId } = useActiveSession()
  const { forkFrom } = useChatSessionActions()
  const now = useTickingNow()
  const reduceMotion = Boolean(useReducedMotionConfig())
  const [layoutTransition, setLayoutTransition] = useState(() => questionSummaryTransition(true, false))
  // MotionConfig re-renders every motion element and useReducedMotion caller
  // below it when its value changes, so only rebuild it when the inputs do.
  const motionTransition = useMemo(
    () => ({ layout: reduceMotion ? questionSummaryTransition(true, true) : layoutTransition }),
    [layoutTransition, reduceMotion]
  )
  const untitled = t("sidebar.projects.untitledSession")
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
  // Keep turn objects stable across streaming updates so memoized turns skip.
  const previousTurns = useRef<ThreadTurn[]>([])
  const turns = useMemo(() => {
    const next = reuseThreadTurns(
      previousTurns.current,
      groupThreadTurns(visibleMessages)
    )
    previousTurns.current = next
    return next
  }, [visibleMessages])
  const railEntries = useMemo(
    () => userMessageRailEntries(turns),
    [turns]
  )
  const releaseFollowRef = useRef<(() => void) | null>(null)
  const threadRowRef = useRef<HTMLDivElement>(null)

  // Long transcripts mount in slices; see thread-turns.ts. The window is
  // derived during render so a bulk arrival and its first slice commit together.
  const [reveal, setReveal] = useState(() => initialRevealWindow(turns))
  const revealWindow = nextRevealWindow(reveal, turns)
  if (revealWindow !== reveal) {
    setReveal(revealWindow)
  }
  const revealFrom = revealWindow.from
  const preparing = revealWindow.preparing
  // A freshly arrived transcript first resolves its file references in one
  // batch; otherwise each slice would mount as pending text and reflow when
  // the answers land, nudging the pinned viewport several times.
  useEffect(() => {
    if (!preparing) {
      return
    }
    let cancelled = false
    const paths = collectThreadFilePaths(visibleMessages, runCwd)
    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, FILE_PREFETCH_TIMEOUT_MS)
    })
    void Promise.race([Promise.all(paths.map((path) => checkFileExists(path))), timeout]).then(() => {
      if (!cancelled) setReveal(markRevealPrepared)
    })
    return () => {
      cancelled = true
    }
  }, [preparing, runCwd, visibleMessages])
  useEffect(() => {
    if (preparing || revealFrom === 0) {
      return
    }
    // Let the current slice paint, then build the next one as a transition so
    // React can yield while rendering the older turns.
    const frame = requestAnimationFrame(() => {
      startTransition(() => setReveal(revealNextBatch))
    })
    return () => cancelAnimationFrame(frame)
  }, [preparing, revealFrom])

  // Fork reads the current transcript through a ref so the callback, and with
  // it every message's props, stays stable while messages stream in.
  const forkContext = useRef({ messages, stem })
  useLayoutEffect(() => {
    forkContext.current = { messages, stem }
  })
  const forkFromMessage = useCallback(
    (message: AgentThreadMessage) => {
      void forkFrom({ message, ...forkContext.current })
    },
    [forkFrom]
  )
  const forkAvailability = useMemo<ForkAvailability>(
    () => ({
      forkFrom: canFork ? forkFromMessage : undefined,
      disabledReason: forkDisabledReason,
    }),
    [canFork, forkDisabledReason, forkFromMessage]
  )

  const renderMessage = useCallback(
    (message: AgentThreadMessage, hideProcessHeader = false) => {
      const item = (
        <ThreadMessageColumn key={message.renderId ?? message.id}>
          <AgentMessageItem
            message={message}
            hideProcessHeader={hideProcessHeader}
          />
        </ThreadMessageColumn>
      )
      return message.role === "user" ? item : (
        <motion.div
          key={message.renderId ?? message.id}
          layout="position"
          layoutDependency={false}
          className="min-w-0"
        >
          {item}
        </motion.div>
      )
    },
    []
  )

  const jumpToUserMessage = useCallback((entry: UserMessageRailEntry) => {
    resetExpandAnchor()
    releaseFollowRef.current?.()
    // Mount the destination before scrolling. The scroller's prepend restore
    // runs as a microtask, so the jump itself waits until after that.
    if (preparing || entry.turnIndex < revealFrom) {
      flushSync(() => {
        setReveal((current) => ({
          ...current,
          from: Math.min(current.from, entry.turnIndex),
          preparing: false,
        }))
      })
    }
    const viewport = threadRowRef.current?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')
    if (!viewport) return
    queueMicrotask(() => {
      if (!scrollUserMessageTurnIntoView(viewport, entry.id)) {
        requestAnimationFrame(() => scrollUserMessageTurnIntoView(viewport, entry.id))
      }
    })
  }, [preparing, revealFrom])

  return (
    <QuoteInChatContext.Provider value={onSelectionAction ?? null}>
    <ForkContext.Provider value={forkAvailability}>
    <TickingNowProvider value={now}>
    {/* FollowLatestMessage owns streaming and explicit follow animations. */}
    <MessageScrollerProvider autoScroll={false} scrollMargin={AGENT_CHAT_HEADER_HEIGHT}>
      <div ref={threadRowRef} className="flex h-full min-h-0">
        <UserMessageRail entries={railEntries} onJump={jumpToUserMessage} scrollRootRef={threadRowRef} />
        <div className="min-h-0 min-w-0 flex-1">
      <MessageScroller>
        <MotionConfig transition={motionTransition}>
          <LayoutGroup inherit={false}>
            <MotionScrollerViewport layoutScroll style={{ scrollPaddingTop: AGENT_CHAT_HEADER_HEIGHT }}>
              <ThreadGlass />
              <MessageScrollerContent
                className="w-full gap-6"
                style={{ paddingTop: `calc(${AGENT_CHAT_HEADER_HEIGHT}px + var(--spacing) * 6)` }}
                onClickCapture={(event) => {
                  const trigger = event.target instanceof Element
                    ? event.target.closest('[data-question-summary] [data-slot="collapsible-trigger"], [data-user-message-toggle]')
                    : null
                  if (trigger) {
                    const closing = trigger.getAttribute("aria-expanded") === "true"
                    setLayoutTransition(questionSummaryTransition(!closing, event.detail === 0))
                  }
                }}
              >
                {/* Fixed layout dependencies keep streaming updates immediate;
                    the disclosure's LayoutGroup coordinates position changes. */}
                {turns.map((turn, index) =>
                  preparing || index < revealFrom ? null : (
                    <ThreadTurnItem
                      key={turn.id}
                      isLast={index === turns.length - 1}
                      renderMessage={renderMessage}
                      turn={turn}
                    />
                  )
                )}
                <ThreadEndSpacer />
              </MessageScrollerContent>
            </MotionScrollerViewport>
          </LayoutGroup>
        </MotionConfig>
        <KeepExpandAnchor />
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2">
            <TaskPlanPopover messages={messages} />
            <FollowLatestMessage messages={messages} mounted={!preparing} releaseRef={releaseFollowRef} />
          </div>
        </div>
      </MessageScroller>
        </div>
      </div>
      {onSelectionAction ? <MessageSelectionActions onAction={onSelectionAction} /> : null}
    </MessageScrollerProvider>
    </TickingNowProvider>
    </ForkContext.Provider>
    </QuoteInChatContext.Provider>
  )
}

// Keep the reading column's gutters inside full-width turn surfaces so sticky
// glass also covers the empty space on both sides of a wide conversation.
function ThreadMessageColumn({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 pl-4 pr-5">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </div>
  )
}

const ThreadTurnItem = memo(function ThreadTurnItem({
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
  const userRenderId = user?.renderId ?? user?.id
  const freezeTurn = user !== null || working !== null
  const userRef = useRef<HTMLDivElement>(null)
  const [userHeight, setUserHeight] = useState(0)
  const hasWorking = working !== null

  // The user bar height only positions the working line below it, so measure
  // only while a reply is streaming. Reading it for every historical turn
  // forced layout of each content-visibility:auto item and queued a second
  // render per turn when a long transcript mounted.
  useLayoutEffect(() => {
    const userBar = userRef.current
    if (!userBar || !hasWorking) {
      setUserHeight(0)
      return
    }

    const syncHeight = () => {
      // Preserve fractional pixels so the stacked sticky backgrounds meet.
      setUserHeight(userBar.getBoundingClientRect().height)
    }

    syncHeight()
    const observer = new ResizeObserver(syncHeight)
    observer.observe(userBar)
    return () => observer.disconnect()
  }, [hasWorking, userRenderId])

  return (
    <MotionScrollerItem
      layout="position"
      layoutDependency={false}
      messageId={turn.id}
      data-user-message-turn={user && isUserMessageBubble(user) ? turn.id : undefined}
      className={cn(
        "flex flex-col overflow-visible",
        working ? "gap-2" : "gap-6",
        (isLast || freezeTurn) && "[content-visibility:visible]"
      )}
    >
      {user ? (
        <StickyFreeze
          ref={userRef}
          className={working ? "mt-2" : "mt-6"}
          top={AGENT_CHAT_HEADER_HEIGHT}
        >
          {renderMessage(user)}
        </StickyFreeze>
      ) : null}
      {working ? (
        <StickyFreeze
          className="mt-2"
          top={AGENT_CHAT_HEADER_HEIGHT + (user ? userHeight : 0)}
        >
          <ThreadMessageColumn>
            <WorkingStatusLine message={working} />
          </ThreadMessageColumn>
        </StickyFreeze>
      ) : null}
      {turn.replies.map((message) =>
        renderMessage(message, message.status === "streaming")
      )}
    </MotionScrollerItem>
  )
})

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
      spacer.style.height = `${Math.round(Math.max(0, viewport.clientHeight - AGENT_CHAT_HEADER_HEIGHT) * 0.3)}px`
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

function KeepExpandAnchor() {
  useLayoutEffect(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="message-scroller-viewport"]'
    )
    if (!viewport) {
      return
    }

    const start = (target: EventTarget | null) => {
      captureExpandTrigger(target)
      if (!isExpandScrollLocked()) {
        return
      }
      releaseThreadFollow(viewport)
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
      viewport.removeEventListener("pointerdown", onPointerDown, true)
      viewport.removeEventListener("keydown", onKeyDown, true)
      observer.disconnect()
    }
  }, [])

  return null
}
