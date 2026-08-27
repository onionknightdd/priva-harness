import * as React from "react"
import { motion, useReducedMotion } from "motion/react"

import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

const TAIL_MASK_CLASS =
  "[mask-image:linear-gradient(to_bottom,black_calc(100%-1.25rem),transparent)]"
const TAIL_FADE_CLASS =
  "pointer-events-none absolute inset-x-0 top-full h-8 bg-background [mask-image:linear-gradient(to_bottom,black,transparent)]"

export const StickyFreeze = React.forwardRef<
  HTMLDivElement,
  {
    children: React.ReactNode
    className?: string
    enabled?: boolean
    showTailMask?: boolean
    top?: number
  }
>(function StickyFreeze(
  {
    children,
    className,
    enabled = true,
    showTailMask = true,
    top = 0,
  },
  forwardedRef
) {
  const sentinelRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = React.useState(false)
  const [overflowing, setOverflowing] = React.useState(false)
  const shouldReduceMotion = Boolean(useReducedMotion())
  const frozen = enabled && stuck

  React.useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !enabled) {
      setStuck(false)
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
  }, [enabled])

  React.useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || !frozen) {
      setOverflowing(false)
      return
    }

    const updateOverflowing = () => {
      setOverflowing(content.scrollHeight > content.clientHeight + 1)
    }

    updateOverflowing()
    const observer = new ResizeObserver(updateOverflowing)
    observer.observe(content)
    return () => observer.disconnect()
  }, [children, frozen])

  return (
    <motion.div
      ref={forwardedRef}
      data-slot="sticky-freeze"
      data-stuck={frozen || undefined}
      className={cn(
        "relative w-full min-w-0",
        enabled && "sticky z-10",
        frozen && "bg-background",
        className
      )}
      style={enabled ? { top } : undefined}
      animate={{
        boxShadow: frozen
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
      <div
        ref={contentRef}
        className={cn(
          frozen && "max-h-[40vh] overflow-hidden",
          frozen && overflowing && TAIL_MASK_CLASS
        )}
      >
        {children}
      </div>
      {frozen && showTailMask ? (
        <div aria-hidden className={TAIL_FADE_CLASS} />
      ) : null}
    </motion.div>
  )
})
