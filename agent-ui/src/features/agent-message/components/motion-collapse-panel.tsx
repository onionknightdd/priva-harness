import { useLayoutEffect, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

const CLOSE_MS = 200

export function MotionCollapsePanel({
  open,
  children,
}: {
  open: boolean
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)

  useLayoutEffect(() => {
    if (open) {
      setMounted(true)
      const frame = requestAnimationFrame(() => {
        setExpanded(true)
      })
      return () => cancelAnimationFrame(frame)
    }

    setExpanded(false)
    const timeout = window.setTimeout(() => {
      setMounted(false)
    }, CLOSE_MS)
    return () => window.clearTimeout(timeout)
  }, [open])

  if (!mounted) {
    return null
  }

  return (
    <div
      aria-hidden={!expanded}
      inert={!expanded}
      className={cn(
        "grid origin-top overflow-hidden [overflow-anchor:none]",
        "transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className="min-h-0 overflow-hidden [overflow-anchor:none]">
        {children}
      </div>
    </div>
  )
}
