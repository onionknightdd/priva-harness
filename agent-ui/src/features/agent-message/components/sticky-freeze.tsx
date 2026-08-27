import * as React from "react"
import { motion, useReducedMotion } from "motion/react"

import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

export const StickyFreeze = React.forwardRef<
  HTMLDivElement,
  {
    children: React.ReactNode
    className?: string
    onStuckChange?: (stuck: boolean) => void
    showBelowMask?: boolean
    top?: number
  }
>(function StickyFreeze(
  {
    children,
    className,
    onStuckChange,
    showBelowMask = true,
    top = 0,
  },
  forwardedRef
) {
  const sentinelRef = React.useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = React.useState(false)
  const shouldReduceMotion = Boolean(useReducedMotion())
  const showEdge = stuck && showBelowMask

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
        const rootTop = entry?.rootBounds?.top ?? 0
        const next =
          entry !== undefined &&
          entry.boundingClientRect.bottom <= rootTop + top
        setStuck(next)
        onStuckChange?.(next)
      },
      { root, threshold: 0 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onStuckChange, top])

  return (
    <div className="relative w-full min-w-0">
      <div
        ref={sentinelRef}
        aria-hidden
        className="pointer-events-none h-px w-full"
      />
      <motion.div
        ref={forwardedRef}
        data-slot="sticky-freeze"
        data-stuck={stuck || undefined}
        className={cn(
          "relative sticky z-10 w-full min-w-0 bg-background",
          className
        )}
        style={{ top }}
        animate={{
          boxShadow: showEdge
            ? "0 1px 0 0 var(--border)"
            : "0 0 0 0 transparent",
        }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : { duration: 0.2, ease: EASE_OUT }
        }
      >
        {children}
        {showEdge ? (
          <div
            aria-hidden
            data-slot="sticky-freeze-mask"
            className="pointer-events-none absolute inset-x-0 top-full h-8 bg-gradient-to-b from-background to-transparent"
          />
        ) : null}
      </motion.div>
    </div>
  )
})
