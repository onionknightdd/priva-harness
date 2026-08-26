"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { MessageSquareQuoteIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { EASE_OUT } from "@/lib/ease"

import { readAssistantSelection } from "../quote-selection"

type QuoteMenuState = {
  text: string
  x: number
  y: number
  placeAbove: boolean
}

export function AssistantQuoteMenu({
  onQuote,
}: {
  onQuote: (text: string) => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const pointerDownRef = React.useRef(false)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [menu, setMenu] = React.useState<QuoteMenuState | null>(null)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const syncSelection = React.useCallback(() => {
    const next = readAssistantSelection()
    if (!next) {
      setMenu(null)
      return
    }

    const viewportPadding = 8
    const x = Math.min(
      Math.max(next.rect.left + next.rect.width / 2, viewportPadding + 88),
      window.innerWidth - viewportPadding - 88
    )
    const placeAbove = next.rect.top > 52
    setMenu({
      text: next.text,
      x,
      y: placeAbove ? next.rect.top : next.rect.bottom,
      placeAbove,
    })
  }, [])

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        menuRef.current?.contains(target)
      ) {
        return
      }

      pointerDownRef.current = true
    }

    const onPointerUp = (event: PointerEvent) => {
      pointerDownRef.current = false
      const target = event.target
      if (
        target instanceof Node &&
        menuRef.current?.contains(target)
      ) {
        return
      }

      requestAnimationFrame(syncSelection)
    }

    const onSelectionChange = () => {
      if (pointerDownRef.current) {
        return
      }

      syncSelection()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null)
      }
    }

    const onScroll = () => {
      setMenu(null)
    }

    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("pointerup", onPointerUp, true)
    document.addEventListener("selectionchange", onSelectionChange)
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("scroll", onScroll, true)

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("pointerup", onPointerUp, true)
      document.removeEventListener("selectionchange", onSelectionChange)
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("scroll", onScroll, true)
    }
  }, [syncSelection])

  if (!mounted) {
    return null
  }

  return createPortal(
    <AnimatePresence>
      {menu ? (
        <motion.div
          key="assistant-quote-menu"
          ref={menuRef}
          role="menu"
          aria-label={t("agentMessage.quoteMenuLabel")}
          initial={
            shouldReduceMotion
              ? false
              : {
                  opacity: 0,
                  x: "-50%",
                  y: menu.placeAbove ? -4 : 4,
                  scale: 0.96,
                }
          }
          animate={{
            opacity: 1,
            x: "-50%",
            y: menu.placeAbove ? "calc(-100% - 8px)" : 8,
            scale: 1,
          }}
          exit={
            shouldReduceMotion
              ? { opacity: 0 }
              : {
                  opacity: 0,
                  x: "-50%",
                  y: menu.placeAbove ? -4 : 4,
                  scale: 0.96,
                }
          }
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : { duration: 0.16, ease: EASE_OUT }
          }
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-50 origin-center"
        >
          <div className="min-w-36 rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onClick={() => {
                onQuote(menu.text)
                window.getSelection()?.removeAllRanges()
                setMenu(null)
              }}
            >
              <MessageSquareQuoteIcon
                aria-hidden="true"
                className="size-4 shrink-0"
              />
              {t("agentMessage.quoteSelection")}
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}
