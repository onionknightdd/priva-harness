import * as React from "react"
import { Cursor, CursorContainer, CursorProvider, useCursor } from "@animate-ui/react/primitives/cursor"
import { useReducedMotion } from "motion/react"

import { EASE_OUT } from "@/lib/ease"
import { useHoverCapable } from "@/lib/hooks/use-hover-capable"

function LocalPreviewCursor({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const { containerRef } = useCursor()
  const reduceMotion = useReducedMotion()
  const [eligible, setEligible] = React.useState(false)

  React.useEffect(() => {
    // Animate UI scopes its pointer tracking to CursorContainer's parent.
    const parent = containerRef.current?.parentElement
    if (!parent) return
    let current = false
    const update = (next: boolean) => {
      if (current === next) return
      current = next
      setEligible(next)
    }
    const move = (event: PointerEvent) => {
      const target = event.target
      const surface = targetRef.current
      if (event.pointerType !== "mouse" || !(target instanceof Element) || !surface?.contains(target) ||
          target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"]')) {
        update(false)
        return
      }
      const viewport = target.closest<HTMLElement>("[data-xlsx-viewport-input]")
      if (viewport) {
        const bounds = viewport.getBoundingClientRect()
        const x = event.clientX - bounds.left - viewport.clientLeft
        const y = event.clientY - bounds.top - viewport.clientTop
        if (x < 0 || y < 0 || x >= viewport.clientWidth || y >= viewport.clientHeight ||
            ["col-resize", "row-resize"].includes(viewport.style.cursor)) {
          update(false)
          return
        }
      }
      update(true)
    }
    const clear = () => update(false)
    const visibility = () => { if (document.hidden) clear() }
    // Bubble after the viewer has updated its row/column resize cursor.
    parent.addEventListener("pointermove", move, { passive: true })
    parent.addEventListener("pointerleave", clear)
    window.addEventListener("blur", clear)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      parent.removeEventListener("pointermove", move)
      parent.removeEventListener("pointerleave", clear)
      window.removeEventListener("blur", clear)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [containerRef, targetRef])

  return (
    <CursorContainer aria-hidden="true" className="pointer-events-none absolute inset-0 z-40 overflow-hidden" data-preview-cursor-container>
      {eligible && (
        <Cursor
          data-preview-cursor
          style={{ zIndex: 40 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.1, ease: EASE_OUT }}
        >
          <svg className="size-6 text-foreground drop-shadow-sm" viewBox="0 0 40 40" aria-hidden="true">
            <path fill="currentColor" stroke="var(--background)" strokeWidth="2"
              d="M1.8 4.4 7 36.2c.3 1.8 2.6 2.3 3.6.8l3.9-5.7c1.7-2.5 4.5-4.1 7.5-4.3l6.9-.5c1.8-.1 2.5-2.4 1.1-3.5L5 2.5c-1.4-1.1-3.5 0-3.3 1.9Z" />
          </svg>
        </Cursor>
      )}
    </CursorContainer>
  )
}

export function PreviewCursor({ targetRef, enabled = true }: {
  targetRef: React.RefObject<HTMLElement | null>
  enabled?: boolean
}) {
  const canHover = useHoverCapable()
  if (!enabled || !canHover) return null
  return <CursorProvider><LocalPreviewCursor targetRef={targetRef} /></CursorProvider>
}
