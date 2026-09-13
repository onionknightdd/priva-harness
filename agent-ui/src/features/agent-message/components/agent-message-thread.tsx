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
import { flushSync } from "react-dom"
import { ArrowDownIcon } from "lucide-react"
import {
  LayoutGroup,
  MotionConfig,
  motion,
  useReducedMotionConfig,
} from "motion/react"
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
import { useActiveSession, useChatSessionActions } from "@/features/chat-session"
import { checkFileExists } from "@/features/files/file-existence"
import { sessionDisplayTitle } from "@/features/sidebar/content/session-projects"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { TickingNowProvider, useTickingNow } from "@/lib/relative-time"
import { cn } from "@/lib/utils"

import type { AgentThreadMessage } from "../agent-message-data"
import {
  EXPAND_LOCK_MS,
  captureExpandTrigger,
  isExpandScrollLocked,
  keepExpandTriggerInPlace,
  releaseThreadFollow,
} from "../expand-down-anchor"
import { ForkContext, type ForkAvailability } from "../fork-context"
import { foldCommandSurfaces } from "../slash-command-envelope"
import { questionSummaryTransition } from "../question-summary-motion"
import { AssistantSelectionActionContext, type OnAssistantSelectionAction } from "../selection-actions-context"
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
import { AgentMessageItem } from "./agent-message-item"
import { AssistantSelectionActions } from "./assistant-selection-actions"
import { StickyFreeze } from "./sticky-freeze"
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
  onSelectionAction?: OnAssistantSelectionAction
}) {
  const { t } = useTranslation()
  const { runHarnessId } = useHarness()
  const { activeSession, canFork, forking, runCwd, runSessionId } = useActiveSession()
  const { forkFrom } = useChatSessionActions()
  const now = useTickingNow()
  const [followPaused, setFollowPaused] = useState(false)
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
        <AgentMessageItem
          key={message.id}
          message={message}
          hideProcessHeader={hideProcessHeader}
        />
      )
      return message.role === "user" ? item : (
        <motion.div
          key={message.id}
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

  return (
    <AssistantSelectionActionContext.Provider value={onSelectionAction ?? null}>
    <ForkContext.Provider value={forkAvailability}>
    <TickingNowProvider value={now}>
    <MessageScrollerProvider autoScroll={!followPaused}>
      <MessageScroller>
        <MotionConfig transition={motionTransition}>
          <LayoutGroup inherit={false}>
            <MotionScrollerViewport layoutScroll>
              <MessageScrollerContent
                className="mx-auto w-full max-w-3xl gap-6 pt-6"
                onClickCapture={(event) => {
                  const trigger = event.target instanceof Element
                    ? event.target.closest('[data-question-summary] [data-slot="collapsible-trigger"]')
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
        <KeepExpandAnchor onFollowPausedChange={setFollowPaused} />
        <PinLatestAtCenter messages={messages} mounted={!preparing} />
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
      {onSelectionAction ? <AssistantSelectionActions onAction={onSelectionAction} /> : null}
    </MessageScrollerProvider>
    </TickingNowProvider>
    </ForkContext.Provider>
    </AssistantSelectionActionContext.Provider>
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
  const freezeTurn = user !== null || working !== null
  const userRef = useRef<HTMLDivElement>(null)
  const [userHeight, setUserHeight] = useState(0)
  const [workingStuck, setWorkingStuck] = useState(false)
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
  }, [hasWorking, user?.id])

  useLayoutEffect(() => {
    if (working === null) {
      setWorkingStuck(false)
    }
  }, [working])

  return (
    <MotionScrollerItem
      layout="position"
      layoutDependency={false}
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
  mounted,
}: {
  messages: AgentThreadMessage[]
  /** Turns mount one commit after the messages arrive; re-pin on that commit. */
  mounted: boolean
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
  }, [followLatest, messages, mounted])

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
