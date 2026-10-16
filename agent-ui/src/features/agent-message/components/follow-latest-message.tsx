import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { ArrowDownIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { MessageScrollerButton } from "@/components/ui/message-scroller"
import { cn } from "@/lib/utils"
import type { AgentThreadMessage } from "../agent-message-data"
import { isExpandScrollLocked, resetExpandAnchor } from "../expand-down-anchor"

const END_EDGE_PX = 8
const FOLLOW_MIN_MS = 480
const FOLLOW_MAX_MS = 860

function followDuration(distance: number) {
  return Math.min(FOLLOW_MAX_MS, Math.max(FOLLOW_MIN_MS, Math.abs(distance) * 0.9))
}

/** Sine in-out. Starts and settles slowly, so the glide doesn't kick off. */
function easeInOutSine(t: number) {
  return (1 - Math.cos(Math.PI * t)) / 2
}

function isScrolledToEnd(viewport: HTMLElement) {
  return (
    viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <=
    END_EDGE_PX
  )
}

export function FollowLatestMessage({
  messages,
  mounted,
}: {
  messages: AgentThreadMessage[]
  /** Turns mount one commit after the messages arrive; re-pin on that commit. */
  mounted: boolean
}) {
  const { t } = useTranslation()
  const [following, setFollowing] = useState(true)
  const pinnedRef = useRef(true)
  const programmaticRef = useRef(false)
  const previousIdsRef = useRef<string[] | null>(null)
  const followFrameRef = useRef(0)
  const instantFollowRef = useRef(true)
  const threadKey = messages[0]?.renderId ?? messages[0]?.id ?? "empty"

  const setPinned = useCallback((pinned: boolean) => {
    pinnedRef.current = pinned
    setFollowing(pinned)
  }, [])

  const followLatest = useCallback(() => {
    if (!mounted || !pinnedRef.current || isExpandScrollLocked()) {
      return
    }
    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="message-scroller-viewport"]'
    )
    if (!viewport) {
      return
    }
    // A glide already in flight reads the live end, so streaming growth does
    // not restart the ease on every resize.
    if (followFrameRef.current) return

    const destination = () => Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    const from = viewport.scrollTop
    const distance = destination() - from
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const instant = instantFollowRef.current
    instantFollowRef.current = false
    if (reduce || Math.abs(distance) < 1 || instant) {
      programmaticRef.current = true
      viewport.scrollTop = destination()
      requestAnimationFrame(() => {
        programmaticRef.current = false
      })
      return
    }

    const duration = followDuration(distance)
    const start = performance.now()
    programmaticRef.current = true
    const step = (now: number) => {
      if (!pinnedRef.current) {
        followFrameRef.current = 0
        programmaticRef.current = false
        return
      }
      const t = Math.min(1, (now - start) / duration)
      const dest = destination()
      viewport.scrollTop = from + (dest - from) * easeInOutSine(t)
      if (t < 1) {
        followFrameRef.current = requestAnimationFrame(step)
        return
      }
      viewport.scrollTop = destination()
      followFrameRef.current = 0
      programmaticRef.current = false
    }
    followFrameRef.current = requestAnimationFrame(step)
  }, [mounted])

  useLayoutEffect(() => {
    setPinned(true)
    previousIdsRef.current = null
    instantFollowRef.current = true
    if (followFrameRef.current) {
      cancelAnimationFrame(followFrameRef.current)
      followFrameRef.current = 0
      programmaticRef.current = false
    }
  }, [setPinned, threadKey])

  useLayoutEffect(() => {
    const ids = messages.map((message) => message.renderId ?? message.id)
    const previous = previousIdsRef.current
    previousIdsRef.current = ids
    // A composer send appends a user message. Re-pin even if reading earlier
    // history had paused follow.
    if (
      previous &&
      ids.length > previous.length &&
      previous.every((id, index) => ids[index] === id) &&
      messages.slice(previous.length).some((message) => message.role === "user")
    ) {
      resetExpandAnchor()
      setPinned(true)
      if (followFrameRef.current) {
        cancelAnimationFrame(followFrameRef.current)
        followFrameRef.current = 0
      }
    }
    followLatest()
  }, [followLatest, messages, mounted, setPinned])

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

      setPinned(isScrolledToEnd(viewport))
    }

    const stopGlide = () => {
      if (!followFrameRef.current) return
      cancelAnimationFrame(followFrameRef.current)
      followFrameRef.current = 0
      programmaticRef.current = false
      setPinned(isScrolledToEnd(viewport))
    }

    viewport.addEventListener("scroll", onScroll, { passive: true })
    viewport.addEventListener("wheel", stopGlide, { passive: true })
    viewport.addEventListener("touchmove", stopGlide, { passive: true })

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
      if (followFrameRef.current) {
        cancelAnimationFrame(followFrameRef.current)
        followFrameRef.current = 0
        programmaticRef.current = false
      }
      viewport.removeEventListener("scroll", onScroll)
      viewport.removeEventListener("wheel", stopGlide)
      viewport.removeEventListener("touchmove", stopGlide)
      observer.disconnect()
      mutations.disconnect()
    }
  }, [followLatest, setPinned])

  return (
    <MessageScrollerButton
      className={cn(
        "relative inset-s-auto translate-x-0 rtl:translate-x-0 data-[direction=end]:bottom-auto data-[direction=end]:data-[active=false]:translate-y-0 data-[active=false]:hidden",
        // The library only knows the distance to the end; keep this control
        // hidden while our glide is already following that changing end.
        following && "hidden"
      )}
      onClick={(event) => {
        // Keep the button on the same glide as streaming updates. The library's
        // native smooth scroll would otherwise compete with the animation.
        event.preventDefault()
        event.currentTarget.blur()
        resetExpandAnchor()
        setPinned(true)
        followLatest()
      }}
    >
      <ArrowDownIcon />
      <span className="sr-only">{t("agentMessage.scrollToLatest")}</span>
    </MessageScrollerButton>
  )
}
