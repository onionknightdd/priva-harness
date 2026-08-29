import * as React from "react"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

export function OverflowMarquee({
  active,
  children,
  className,
  playback = "loop",
}: {
  active: boolean
  children: string
  className?: string
  playback?: "loop" | "once"
}) {
  const viewportRef = React.useRef<HTMLSpanElement>(null)
  const contentRef = React.useRef<HTMLSpanElement>(null)
  const [overflowDistance, setOverflowDistance] = React.useState(0)
  const [completed, setCompleted] = React.useState(false)
  const shouldReduceMotion = Boolean(useReducedMotion())

  React.useEffect(() => {
    setCompleted(false)
  }, [children])

  React.useEffect(() => {
    if (!active) {
      setCompleted(false)
    }
  }, [active])

  React.useLayoutEffect(() => {
    if (!active) {
      setOverflowDistance(0)
      return
    }

    const viewport = viewportRef.current
    const content = contentRef.current

    if (!viewport || !content) {
      return
    }

    const updateOverflowDistance = () => {
      setOverflowDistance(
        Math.max(0, content.scrollWidth - viewport.clientWidth)
      )
    }

    updateOverflowDistance()

    const resizeObserver = new ResizeObserver(updateOverflowDistance)
    resizeObserver.observe(viewport)
    resizeObserver.observe(content)

    return () => resizeObserver.disconnect()
  }, [active, children])

  const shouldAnimate =
    active &&
    overflowDistance > 0 &&
    !shouldReduceMotion &&
    (playback === "loop" || !completed)
  const duration = Math.max(1.2, overflowDistance / 32)

  return (
    <span
      ref={viewportRef}
      data-overflowing={overflowDistance > 0 || undefined}
      className={cn(
        "block min-w-0 overflow-hidden whitespace-nowrap",
        className
      )}
    >
      <motion.span
        ref={contentRef}
        aria-label={children}
        className={cn(
          "block",
          shouldAnimate
            ? "w-max"
            : "max-w-full overflow-hidden text-ellipsis"
        )}
        initial={false}
        animate={
          shouldAnimate
            ? { x: [0, -overflowDistance] }
            : { x: 0 }
        }
        transition={
          shouldAnimate
            ? playback === "loop"
              ? {
                  duration,
                  ease: "linear",
                  repeat: Infinity,
                  repeatDelay: 0.45,
                  repeatType: "reverse",
                }
              : { duration, ease: "linear" }
            : { duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }
        }
        onAnimationComplete={() => {
          if (playback === "once" && shouldAnimate) {
            setCompleted(true)
          }
        }}
      >
        {children}
      </motion.span>
    </span>
  )
}
