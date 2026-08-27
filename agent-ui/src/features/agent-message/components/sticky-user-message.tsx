import * as React from "react"
import { motion, useReducedMotion } from "motion/react"

import { EASE_OUT } from "@/lib/ease"

export function StickyUserMessage({
  children,
}: {
  children: React.ReactNode
}) {
  const sentinelRef = React.useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = React.useState(false)
  const shouldReduceMotion = Boolean(useReducedMotion())

  React.useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) {
      return
    }

    const root = sentinel.closest<HTMLElement>(
      '[data-slot="message-scroller-viewport"]'
    )
    const observer = new IntersectionObserver(
      ([entry]) => {
        setStuck(!entry?.isIntersecting)
      },
      { root, threshold: 0 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  return (
    <motion.div
      className="relative sticky top-0 z-10 bg-background"
      animate={{
        boxShadow: stuck
          ? "0 1px 0 0 var(--border)"
          : "0 0 0 0 transparent",
      }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { duration: 0.2, ease: EASE_OUT }
      }
    >
      <div
        ref={sentinelRef}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px -translate-y-full"
      />
      {children}
      {stuck ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-full h-3 bg-gradient-to-b from-background to-transparent"
        />
      ) : null}
    </motion.div>
  )
}
