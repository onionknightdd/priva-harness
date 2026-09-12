"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MessageCircleQuestionMarkIcon, MessageSquareQuoteIcon, SparklesIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react"
import { useTranslation } from "react-i18next"

import SelectionActions from "@/components/primitives/SelectionActions"
import { EASE_OUT } from "@/lib/ease"

import { readAssistantSelection, selectionActionsPosition } from "../quote-selection"
import type { AssistantSelectionAction, OnAssistantSelectionAction } from "../selection-actions-context"

export function AssistantSelectionActions({ onAction }: { onAction: OnAssistantSelectionAction }) {
  const { t } = useTranslation()
  const reduceMotion = Boolean(useReducedMotionConfig())
  const pointerDown = useRef(false)
  const frame = useRef<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [selection, setSelection] = useState<ReturnType<typeof readAssistantSelection>>(null)
  const [keyboard, setKeyboard] = useState(false)
  const [mounted, setMounted] = useState(false)
  const instant = reduceMotion || keyboard

  useEffect(() => setMounted(true), [])

  const syncSelection = useCallback(() => {
    if (document.querySelector('[data-slot="context-menu-content"]')) {
      setSelection(null)
      return
    }
    // Moving focus into the toolbar can clear the native range. Its captured
    // text remains available until an action or an explicit dismissal.
    if (menuRef.current?.contains(document.activeElement)) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelection(readAssistantSelection())
  }, [])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!selection || !menu) return
    const position = selectionActionsPosition(selection.rect, { width: menu.offsetWidth, height: menu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight })
    menu.style.left = `${position.left}px`
    menu.style.top = `${position.top}px`
    menu.style.transformOrigin = position.placeAbove ? "center bottom" : "center top"
  }, [selection, t])

  useEffect(() => {
    const cancelFrame = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
    const dismiss = () => {
      cancelFrame()
      setSelection(null)
    }
    const onPointerCancel = () => {
      pointerDown.current = false
      dismiss()
    }
    const onPointerDown = (event: PointerEvent) => {
      setKeyboard(false)
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      pointerDown.current = true
      dismiss()
    }
    const onPointerUp = (event: PointerEvent) => {
      pointerDown.current = false
      if (event.button !== 0 || (event.target instanceof Node && menuRef.current?.contains(event.target))) return
      cancelFrame()
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        syncSelection()
      })
    }
    const onSelectionChange = () => {
      if (!pointerDown.current) syncSelection()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      setKeyboard(true)
      const menu = menuRef.current
      if (!menu) return
      if (event.key === "Escape") {
        if (menu.contains(document.activeElement)) returnFocus.current?.focus()
        window.getSelection()?.removeAllRanges()
        dismiss()
      } else if (event.key === "Tab" && !event.shiftKey && !menu.contains(document.activeElement)) {
        event.preventDefault()
        menu.querySelector<HTMLButtonElement>("button")?.focus()
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("pointerup", onPointerUp, true)
    document.addEventListener("pointercancel", onPointerCancel, true)
    document.addEventListener("selectionchange", onSelectionChange)
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("scroll", dismiss, true)
    document.addEventListener("contextmenu", dismiss, true)
    window.addEventListener("resize", dismiss)
    window.addEventListener("blur", onPointerCancel)
    return () => {
      cancelFrame()
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("pointerup", onPointerUp, true)
      document.removeEventListener("pointercancel", onPointerCancel, true)
      document.removeEventListener("selectionchange", onSelectionChange)
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("scroll", dismiss, true)
      document.removeEventListener("contextmenu", dismiss, true)
      window.removeEventListener("resize", dismiss)
      window.removeEventListener("blur", onPointerCancel)
    }
  }, [syncSelection])

  const act = (action: AssistantSelectionAction) => {
    if (!selection) return
    onAction(action, selection.text)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  if (!mounted) return null
  return createPortal(
    <AnimatePresence>
      {selection ? (
        <motion.div
          key="assistant-selection-actions"
          ref={menuRef}
          data-assistant-selection-actions
          className="fixed z-50"
          initial={instant ? false : { opacity: 0, transform: "translateY(4px) scale(0.96)" }}
          animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          exit={{ opacity: 0, transform: "translateY(2px) scale(0.98)", transition: { duration: instant ? 0 : 0.1, ease: EASE_OUT } }}
          transition={{ duration: instant ? 0 : 0.16, ease: EASE_OUT }}
        >
          <SelectionActions label={t("agentMessage.quoteMenuLabel")} instant={instant} actions={[
            { id: "quote", label: t("agentMessage.quoteSelection"), icon: <MessageSquareQuoteIcon aria-hidden="true" />, onSelect: () => act("quote") },
            { id: "explain", label: t("agentMessage.explainSelection"), icon: <MessageCircleQuestionMarkIcon aria-hidden="true" />, onSelect: () => act("explain") },
            { id: "improve", label: t("agentMessage.improveSelection"), icon: <SparklesIcon aria-hidden="true" />, onSelect: () => act("improve") },
          ]} />
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
