import type { ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"

import { EASE_OUT } from "@/lib/ease"

const collapseTransition = { duration: 0.28, ease: EASE_OUT } as const

export function CollapsingInline({
  open,
  children,
}: {
  open: boolean
  children: ReactNode
}) {
  const shouldReduceMotion = Boolean(useReducedMotion())

  return (
    <motion.span
      aria-hidden={!open}
      className="inline-grid min-w-0 max-w-full overflow-hidden align-middle"
      initial={false}
      animate={{
        gridTemplateColumns: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
      }}
      transition={shouldReduceMotion ? { duration: 0 } : collapseTransition}
    >
      <span className="flex min-w-0 overflow-hidden">
        <span className="flex w-max max-w-full items-center gap-1 pl-1">
          {children}
        </span>
      </span>
    </motion.span>
  )
}
