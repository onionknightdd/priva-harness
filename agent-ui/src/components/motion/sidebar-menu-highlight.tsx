"use client"

import * as React from "react"
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react"

import { cn } from "@/lib/utils"
import { menuHighlightTransition } from "./menu-highlight-transition"

type HighlightBounds = {
  top: number
  left: number
  width: number
  height: number
  borderRadius: string
}

function getHighlightTarget(
  target: EventTarget | null,
  container: HTMLElement | null,
  itemSelector: string
) {
  if (!(target instanceof Element) || !container) {
    return null
  }

  const menuItem = target.closest<HTMLElement>(itemSelector)

  if (
    !menuItem ||
    !container.contains(menuItem) ||
    menuItem.matches(':disabled, [aria-disabled="true"], [data-disabled]')
  ) {
    return null
  }

  return menuItem
}

function MenuItemHighlight({
  className,
  children,
  highlightClassName,
  highlightSlot = "menu-item-highlight",
  itemSelector,
  onPointerMove,
  onPointerLeave,
  onFocusCapture,
  onBlurCapture,
  resolveHighlightElement,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  highlightClassName?: string
  highlightSlot?: string
  itemSelector: string
  resolveHighlightElement?: (
    item: HTMLElement
  ) => HTMLElement | null
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [activeElement, setActiveElement] =
    React.useState<HTMLElement | null>(null)
  const [bounds, setBounds] = React.useState<HighlightBounds | null>(null)
  const shouldReduceMotion = useReducedMotion()

  const updateBounds = React.useCallback(
    (item: HTMLElement) => {
      const container = containerRef.current
      const element = resolveHighlightElement?.(item) ?? item

      if (!container || !container.contains(element)) {
        setActiveElement(null)
        setBounds(null)
        return
      }

      const containerRect = container.getBoundingClientRect()
      const elementRect = element.getBoundingClientRect()
      const nextBounds = {
        top: elementRect.top - containerRect.top,
        left: elementRect.left - containerRect.left,
        width: elementRect.width,
        height: elementRect.height,
        borderRadius: window.getComputedStyle(element).borderRadius,
      }

      setBounds((previousBounds) => {
        if (
          previousBounds?.top === nextBounds.top &&
          previousBounds.left === nextBounds.left &&
          previousBounds.width === nextBounds.width &&
          previousBounds.height === nextBounds.height &&
          previousBounds.borderRadius === nextBounds.borderRadius
        ) {
          return previousBounds
        }

        return nextBounds
      })
    },
    [resolveHighlightElement]
  )

  React.useLayoutEffect(() => {
    if (!activeElement) {
      setBounds(null)
      return
    }

    let animationFrame = 0

    const trackActiveElement = () => {
      updateBounds(activeElement)
      animationFrame = window.requestAnimationFrame(trackActiveElement)
    }

    trackActiveElement()

    return () => window.cancelAnimationFrame(animationFrame)
  }, [activeElement, updateBounds])

  const activateFromTarget = React.useCallback(
    (target: EventTarget | null) => {
      const menuItem = getHighlightTarget(
        target,
        containerRef.current,
        itemSelector
      )
      setActiveElement((current) =>
        current === menuItem ? current : menuItem
      )
    },
    [itemSelector]
  )

  const transition: Transition = shouldReduceMotion
    ? { duration: 0 }
    : menuHighlightTransition

  return (
    <div
      ref={containerRef}
      className={cn("relative z-[1]", className)}
      style={style}
      onPointerMove={(event) => {
        activateFromTarget(event.target)
        onPointerMove?.(event)
      }}
      onPointerLeave={(event) => {
        setActiveElement(null)
        onPointerLeave?.(event)
      }}
      onFocusCapture={(event) => {
        activateFromTarget(event.target)
        onFocusCapture?.(event)
      }}
      onBlurCapture={(event) => {
        activateFromTarget(event.relatedTarget)
        onBlurCapture?.(event)
      }}
      {...props}
    >
      <AnimatePresence initial={false} mode="wait">
        {bounds && (
          <motion.div
            data-slot={highlightSlot}
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute z-0",
              highlightClassName
            )}
            initial={{ ...bounds, opacity: 0 }}
            animate={{ ...bounds, opacity: 1 }}
            exit={{
              opacity: 0,
              transition: shouldReduceMotion
                ? { duration: 0 }
                : { ...menuHighlightTransition, delay: 0.2 },
            }}
            transition={transition}
          />
        )}
      </AnimatePresence>
      {children}
    </div>
  )
}

function SidebarMenuHighlight(props: React.ComponentProps<"div">) {
  return (
    <MenuItemHighlight
      {...props}
      highlightClassName="bg-sidebar-accent"
      highlightSlot="sidebar-menu-highlight"
      itemSelector='[data-sidebar="menu-button"], [data-sidebar="menu-sub-button"]'
    />
  )
}

export { MenuItemHighlight, SidebarMenuHighlight }
